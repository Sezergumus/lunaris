"""Azimuth/elevation of the Sun and Earth as seen from a point on the lunar surface.

Subcommands:
  sites     List the built-in landing sites
  compute   Compute locally with Skyfield                -> data/skyfield_<site>.csv
  horizons  Fetch the same table from the JPL Horizons API -> data/horizons_<site>.csv
  compare   Compare the two tables and print difference statistics
  metrics   Rise/set events, visibility windows and summary numbers
            from the Skyfield table                     -> data/metrics_<site>.json
            (--terrain: use the terrain horizon          -> data/metrics_<site>_terrain.json)
  horizon   Terrain horizon and surface properties from
            the LOLA DEM                                -> data/horizon_<site>.json
  dsn       Moon elevation at the three DSN complexes   -> data/dsn_moon.csv
  risk      Mission-window indicators, risk score and
            landing-date scan                           -> data/risk_<site>.json
  mast      Sensitivity to observer (mast) height       -> data/mast_<site>.json

Example:
  python lunar_sky.py compute  --site malapert_a --start 2026-12-01 --days 30
  python lunar_sky.py horizons --site malapert_a --start 2026-12-01 --days 30
  python lunar_sky.py compare  --site malapert_a
  python lunar_sky.py metrics  --site malapert_a --at 2026-12-10T12:00
  python lunar_sky.py horizon  --site malapert_a
  python lunar_sky.py metrics  --site malapert_a --terrain
  python lunar_sky.py dsn      --start 2026-12-01 --days 365
  python lunar_sky.py risk     --site malapert_a --landing 2026-12-16 --duration 14
  python lunar_sky.py mast     --site malapert_a --masts 2,5,10

Notes:
- compute/horizons angles are relative to the local horizontal plane of an
  ideal sphere (radius 1737.4 km plus the given height). Terrain (mountains,
  crater rims) enters through the `horizon` subcommand and `metrics --terrain`.
- Elevation refers to the CENTER of the disk. Seen from the Moon, the Sun's
  angular radius is ~0.27 deg and the Earth's is ~0.95 deg.
- Longitude is east-positive, time is UTC.
- Azimuth is measured clockwise from north (same convention as Horizons).
"""
import argparse
import csv
import math
import os
import sys
from datetime import datetime, timedelta, timezone

MOON_RADIUS_KM = 1737.4

# Coordinates are approximate; confirm exact values against mission sources.
SITES = {
    "shackleton":    ("Shackleton crater (center)",       -89.67, 129.78),
    "connecting_ridge": ("Shackleton-de Gerlache ridge",  -89.45, 222.69),
    "malapert_a":    ("Malapert A / IM-1 Odysseus",       -80.13,   1.44),
    "mons_mouton":   ("Mons Mouton / IM-2 region",        -84.79,  29.20),
    "chandrayaan3":  ("Chandrayaan-3 (Shiv Shakti)",      -69.37,  32.32),
    "apollo11":      ("Apollo 11 (for contrast)",           0.674, 23.473),
}

# DSN complexes: (latitude, east longitude, height m). Approximate.
DSN_STATIONS = {
    "goldstone": (35.4267, -116.8900, 1000.0),
    "madrid":    (40.4314,   -4.2481,  840.0),
    "canberra":  (-35.4014, 148.9817,  690.0),
}

KERNELS = ("moon_080317.tf", "pck00008.tpc", "moon_pa_de421_1900-2050.bpc")


def horizon_dip_deg(height_m):
    """Horizon dip caused by observer height above the sphere (degrees)."""
    h = max(height_m, 0.0) / 1000.0
    return math.degrees(math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + h)))


def time_grid(start, days, step_min):
    t0 = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    n = int(days * 24 * 60 / step_min) + 1
    return [t0 + timedelta(minutes=step_min * i) for i in range(n)]


def resolve_site(args):
    if args.lat is not None and args.lon is not None:
        return args.site or "custom", "Custom coordinates", args.lat, args.lon
    if args.site not in SITES:
        sys.exit("Unknown site. Options: " + ", ".join(SITES))
    label, lat, lon = SITES[args.site]
    return args.site, label, lat, lon


# ----------------------------------------------------------------- Skyfield
def load_skyfield(kernel_dir):
    from skyfield.api import Loader, PlanetaryConstants

    load = Loader(kernel_dir)          # downloads missing files from NAIF
    ts = load.timescale()
    # The Loader resolves file names relative to its own directory;
    # do not pass a full path.
    eph = load("de421.bsp")
    pc = PlanetaryConstants()
    for name in KERNELS:
        if name.endswith(".bpc"):
            pc.read_binary(load(name))
        else:
            pc.read_text(load(name))
    frame = pc.build_frame_named("MOON_ME_DE421")
    return ts, eph, pc, frame


def compute(lat, lon, height_m, times, kernel_dir):
    """Return [(utc, sun_az, sun_alt, earth_az, earth_alt), ...]."""
    ts, eph, pc, frame = load_skyfield(kernel_dir)
    place = pc.build_latlon_degrees(frame, lat, lon, elevation_m=height_m)
    observer = eph["moon"] + place
    t = ts.from_datetimes(times)
    out = {}
    for body in ("sun", "earth"):
        alt, az, _ = observer.at(t).observe(eph[body]).apparent().altaz()
        out[body] = (az.degrees, alt.degrees)
    return [
        (times[i], out["sun"][0][i], out["sun"][1][i], out["earth"][0][i], out["earth"][1][i])
        for i in range(len(times))
    ]


def station_moon_elevation(times, kernel_dir):
    """Elevation of the Moon's center at each DSN complex (no refraction).

    Returns {station: [elevation_deg per time]}.
    """
    from skyfield.api import wgs84

    ts, eph, _, _ = load_skyfield(kernel_dir)
    t = ts.from_datetimes(times)
    out = {}
    for name, (lat, lon, height) in DSN_STATIONS.items():
        station = eph["earth"] + wgs84.latlon(lat, lon, elevation_m=height)
        alt, _, _ = station.at(t).observe(eph["moon"]).apparent().altaz()
        out[name] = alt.degrees
    return out


# ------------------------------------------------------------------ Horizons
def horizons_table(body_id, lat, lon, height_m, start, stop, step_min):
    import requests

    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon % 360},{lat},{height_m / 1000.0}'",
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{step_min}m'",
        "QUANTITIES": "'4'",
        "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }
    r = requests.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=120)
    r.raise_for_status()
    return parse_horizons(r.text)


def parse_horizons(text):
    """Extract {utc: (az, alt)} from the rows between $$SOE and $$EOE."""
    if "$$SOE" not in text:
        raise RuntimeError("Horizons returned no table:\n" + text[-1500:])
    body = text.split("$$SOE")[1].split("$$EOE")[0]
    rows = {}
    for line in body.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        when = datetime.strptime(parts[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        nums = []
        for p in parts[1:]:
            try:
                nums.append(float(p))
            except ValueError:
                pass
        rows[when] = (nums[-2], nums[-1])     # azimuth, elevation
    return rows


# ------------------------------------------------------------------- CSV I/O
HEADER = ["utc", "sun_az_deg", "sun_alt_deg", "earth_az_deg", "earth_alt_deg"]


def write_csv(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        for t, saz, salt, eaz, ealt in rows:
            w.writerow([t.strftime("%Y-%m-%dT%H:%MZ")] + [f"{v:.5f}" for v in (saz, salt, eaz, ealt)])
    print("wrote:", path, f"({len(rows)} rows)")


def read_csv(path):
    with open(path) as f:
        return {r["utc"]: [float(r[k]) for k in HEADER[1:]] for r in csv.DictReader(f)}


def ang_diff(a, b):
    """Signed angular difference a - b, wrapped to [-180, 180)."""
    return (a - b + 180.0) % 360.0 - 180.0


def compare(sky, hor):
    """|difference| statistics over common timestamps: {column: (mean, max)}."""
    common = sorted(set(sky) & set(hor))
    if not common:
        raise RuntimeError("No common timestamps; do --start/--days/--step match?")
    stats = {}
    for i, name in enumerate(HEADER[1:]):
        if "az" in name:
            d = [abs(ang_diff(sky[k][i], hor[k][i])) for k in common]
        else:
            d = [abs(sky[k][i] - hor[k][i]) for k in common]
        stats[name] = (sum(d) / len(d), max(d))
    return len(common), stats


# ---------------------------------------------------------------------- CLI
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cmd", choices=["compute", "horizons", "compare", "metrics", "horizon", "dsn", "risk", "mast", "sites"])
    p.add_argument("--site", default="malapert_a", help="built-in site key, or a name for custom coordinates")
    p.add_argument("--lat", type=float, help="custom latitude (degrees, north positive)")
    p.add_argument("--lon", type=float, help="custom longitude (degrees, east positive)")
    p.add_argument("--height", type=float, default=0.0, help="height above the reference sphere (m)")
    p.add_argument("--start", default="2026-12-01", help="start date, YYYY-MM-DD (UTC)")
    p.add_argument("--days", type=float, default=30, help="duration (days)")
    p.add_argument("--step", type=int, default=60, help="time step (minutes)")
    p.add_argument("--kernels", default="kernels", help="kernel directory")
    p.add_argument("--out", default="data", help="output directory")
    p.add_argument("--mask", type=float, default=0.0,
                   help="metrics: minimum elevation mask (deg), e.g. terrain or antenna margin")
    p.add_argument("--terrain", action="store_true",
                   help="metrics: use the terrain horizon from data/horizon_<site>.json")
    p.add_argument("--mast", type=float, default=2.0,
                   help="horizon: observer height above the local surface (m)")
    p.add_argument("--ellipse", type=float, default=1000.0,
                   help="horizon: radius for surface statistics around the site (m)")
    p.add_argument("--landing", help="risk: landing instant, YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC)")
    p.add_argument("--duration", type=float, help="risk: surface mission length (days)")
    p.add_argument("--battery-hours", type=float, help="risk: longest survivable darkness (h)")
    p.add_argument("--max-outage-hours", type=float, help="risk: longest tolerable comm outage (h)")
    p.add_argument("--max-slope", type=float, help="risk: slope limit (deg)")
    p.add_argument("--sphere", action="store_true",
                   help="risk: ignore the terrain horizon even if one is available")
    p.add_argument("--masts", default="2,5,10", help="mast: heights to compare (m, comma-separated)")
    p.add_argument("--at", help="metrics: report the status at this UTC instant, YYYY-MM-DDTHH:MM")
    a = p.parse_args()

    if a.cmd == "sites":
        for key, (label, lat, lon) in SITES.items():
            print(f"{key:17s} {lat:8.3f} {lon:8.3f}  {label}")
        return

    if a.cmd == "dsn":
        times = time_grid(a.start, a.days, a.step)
        os.makedirs(a.kernels, exist_ok=True)
        alt = station_moon_elevation(times, a.kernels)
        path = os.path.join(a.out, "dsn_moon.csv")
        os.makedirs(a.out, exist_ok=True)
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["utc"] + [f"{name}_alt_deg" for name in DSN_STATIONS])
            for i, t in enumerate(times):
                w.writerow([t.strftime("%Y-%m-%dT%H:%MZ")] + [f"{alt[n][i]:.3f}" for n in DSN_STATIONS])
        print("wrote:", path, f"({len(times)} rows)")
        return

    key, label, lat, lon = resolve_site(a)
    sky_path = os.path.join(a.out, f"skyfield_{key}.csv")
    hor_path = os.path.join(a.out, f"horizons_{key}.csv")
    times = time_grid(a.start, a.days, a.step)

    if a.cmd == "compute":
        os.makedirs(a.kernels, exist_ok=True)
        rows = compute(lat, lon, a.height, times, a.kernels)
        write_csv(sky_path, rows)
        salt = [r[2] for r in rows]
        ealt = [r[4] for r in rows]
        print(f"{label}  ({lat}, {lon}), height {a.height} m")
        print(f"  Sun elevation   : {min(salt):+.2f} .. {max(salt):+.2f} deg")
        print(f"  Earth elevation : {min(ealt):+.2f} .. {max(ealt):+.2f} deg")
        print(f"  Horizon dip     : {horizon_dip_deg(a.height):.2f} deg")

    elif a.cmd == "horizons":
        sun = horizons_table(10, lat, lon, a.height, times[0], times[-1], a.step)
        earth = horizons_table(399, lat, lon, a.height, times[0], times[-1], a.step)
        rows = [(t, *sun[t], *earth[t]) for t in sorted(sun) if t in earth]
        write_csv(hor_path, rows)

    elif a.cmd == "compare":
        n, stats = compare(read_csv(sky_path), read_csv(hor_path))
        print(f"{label}: {n} common timestamps")
        print(f"  {'quantity':16s} {'mean |diff|':>12s} {'max |diff|':>12s}  (deg)")
        for name, (mean, mx) in stats.items():
            print(f"  {name:16s} {mean:12.5f} {mx:12.5f}")

    elif a.cmd == "metrics":
        run_metrics(a, key, label, lat, lon, sky_path)

    elif a.cmd == "horizon":
        run_horizon(a, key, label, lat, lon)

    elif a.cmd == "risk":
        run_risk(a, key, label, lat, lon, sky_path)

    elif a.cmd == "mast":
        run_mast(a, key, label, lat, lon, sky_path)


def parse_instant(text):
    fmt = "%Y-%m-%dT%H:%M" if "T" in text else "%Y-%m-%d"
    return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)


def run_risk(a, key, label, lat, lon, sky_path):
    """Mission-window indicators, risk score, slip table and landing-date scan."""
    import json

    import lunar_metrics as lm
    import lunar_risk as lr

    profile = dict(lr.DEFAULT_PROFILE)
    for name, value in (("duration_days", a.duration), ("battery_survival_h", a.battery_hours),
                        ("max_comm_outage_h", a.max_outage_hours), ("max_slope_deg", a.max_slope),
                        ("mask_deg", a.mask or None)):
        if value is not None:
            profile[name] = value

    times, sun_alt, earth_alt, sun_az, earth_az = lm.load_series(sky_path)
    horizon, surface = None, None
    hor_path = os.path.join(a.out, f"horizon_{key}.json")
    if os.path.exists(hor_path) and not a.sphere:
        import lunar_terrain as lt

        horizon = lt.load_horizon(hor_path)
        with open(hor_path) as f:
            surface = json.load(f).get("surface")
    dsn_path = os.path.join(a.out, "dsn_moon.csv")
    stations = lr.load_station_table(dsn_path) if os.path.exists(dsn_path) else None

    series = lr.build_series(times, sun_alt, earth_alt, sun_az, earth_az,
                             horizon=horizon, stations=stations, profile=profile)
    landing = parse_instant(a.landing) if a.landing else times[0]
    window = lr.analyze_window(series, landing)
    score = lr.score_window(window, profile, surface)

    slips = []
    for days in (0, 7, 14, 21, 28):
        try:
            w = lr.analyze_window(series, landing + timedelta(days=days))
        except ValueError:
            continue
        slips.append({"slip_days": days, "window": w, "score": lr.score_window(w, profile, surface)})
    scan = lr.scan_landing_dates(series, surface)

    result = {
        "site": {"key": key, "name": label, "lat": lat, "lon": lon},
        "horizon_model": "terrain" if horizon is not None else "sphere",
        "ground_stations": "dsn" if stations is not None else "always available (no table)",
        "profile": profile,
        "window": window,
        "score": score,
        "slips": slips,
        "scan": scan,
    }
    path = os.path.join(a.out, f"risk_{key}.json")
    with open(path, "w") as f:
        f.write(lr.to_json(result) + "\n")
    print("wrote:", path)

    pw, cm = window["power"], window["comm"]
    print(f"{label}  ({lat}, {lon})")
    print(f"  Horizon: {result['horizon_model']};  ground stations: {result['ground_stations']}")
    print(f"  Mission: land {lm.format_time(landing)}, {window['duration_days']:g} days")
    print("  Power")
    print(f"    usable Sun (>= {100 * profile['min_solar_fraction']:.0f}% of disk) : {pw['sunlit_pct']:.1f}% of the mission")
    print(f"    mean visible solar disk       : {pw['mean_solar_fraction_pct']:.1f}%")
    print(f"    longest darkness              : {lm.format_duration(pw['longest_darkness_h'])}"
          f"  (battery limit {profile['battery_survival_h']:g} h)")
    print(f"    grazing Sun (partial disk)    : {lm.format_duration(pw['partial_disk_h'])}")
    print(f"    eclipse by the Earth          : {lm.format_duration(pw['earth_eclipse_h'])}"
          f"  (max {pw['max_earth_cover_pct']:.0f}% of the disk)")
    print(f"    Sun above terrain             : {pw['sun_above_terrain_deg'][0]:+.1f} .. {pw['sun_above_terrain_deg'][1]:+.1f} deg")
    print("  Communication")
    print(f"    link available                : {cm['available_pct']:.1f}% of the mission")
    print(f"    longest outage                : {lm.format_duration(cm['longest_outage_h'])}"
          f"  (limit {profile['max_comm_outage_h']:g} h)")
    print(f"    Earth hidden by terrain       : {lm.format_duration(cm['terrain_occultation_h'])}")
    print(f"    no ground station in view     : {lm.format_duration(cm['station_gap_h'])}")
    print(f"    solar conjunction (< {profile['conjunction_deg']:g} deg)  : {lm.format_duration(cm['conjunction_h'])}")
    print(f"    low elevation (< {profile['low_elevation_deg']:g} deg)      : {lm.format_duration(cm['low_elevation_h'])}")
    if surface is not None:
        sl = surface["slope_lola_deg"]
        print(f"  Surface: slope within {surface['radius_m']:.0f} m: median {sl['median']:.1f}, "
              f"95th pct {sl['p95']:.1f} deg (limit {profile['max_slope_deg']:g})")
        if "psr" in surface:
            print("  " + describe_psr(surface["psr"]))

    def fmt(v):
        return "   -" if v is None else f"{v:4.0f}"

    print(f"  Risk (0-100): power {fmt(score['power'])}  comm {fmt(score['comm'])}  "
          f"surface {fmt(score['surface'])}  ->  overall {score['overall']:.0f} "
          f"({score['level']}, driven by {score['driver']})")
    print("  If the landing slips:")
    print(f"    {'slip':>6s} {'landing':>18s} {'sunlit':>7s} {'dark max':>9s} {'comm':>6s} {'outage':>8s} {'risk':>5s}")
    for s in slips:
        w, sc = s["window"], s["score"]
        print(f"    {s['slip_days']:+5d}d {lm.format_time(w['landing']):>18s} "
              f"{w['power']['sunlit_pct']:6.1f}% {lm.format_duration(w['power']['longest_darkness_h']):>9s} "
              f"{w['comm']['available_pct']:5.1f}% {lm.format_duration(w['comm']['longest_outage_h']):>8s} "
              f"{sc['overall']:5.0f}")
    if scan:
        best = min(scan, key=lambda r: r["risk_overall"])
        worst = max(scan, key=lambda r: r["risk_overall"])
        low = sum(1 for r in scan if r["level"] == "low")
        print(f"  Landing-date scan ({len(scan)} dates): {low} low-risk; "
              f"best {lm.format_time(best['landing'])} (risk {best['risk_overall']:.0f}), "
              f"worst {lm.format_time(worst['landing'])} (risk {worst['risk_overall']:.0f})")


def run_mast(a, key, label, lat, lon, sky_path):
    """Recompute the terrain horizon for several observer heights (needs the LOLA DEM)."""
    import lunar_metrics as lm
    import lunar_risk as lr
    import lunar_terrain as lt

    x, y = lt.latlon_to_xy(lat, lon)
    near = lt.read_window("height_m", x, y, lt.NEAR_RADIUS_M)
    far = lt.read_window("height_m", x, y, lt.FAR_RADIUS_M, lt.FAR_DECIMATION)
    times, sun_alt, earth_alt, sun_az, earth_az = lm.load_series(sky_path)
    rows = []
    for mast in [float(v) for v in a.masts.split(",")]:
        horizon = lt.compute_horizon(lat, lon, mast_m=mast, near=near, far=far)
        m = lm.analyze(times, sun_alt, earth_alt,
                       sun_horizon=lt.horizon_at(horizon, sun_az).tolist(),
                       earth_horizon=lt.horizon_at(horizon, earth_az).tolist())
        rows.append({
            "mast_m": mast,
            "mean_horizon_deg": float(horizon["horizon_deg"].mean()),
            "sun_visible_pct": m["sun"]["summary"]["visible_pct"],
            "longest_darkness_h": m["sun"]["summary"]["longest_outage_h"],
            "earth_visible_pct": m["earth"]["summary"]["visible_pct"],
            "longest_earth_outage_h": m["earth"]["summary"]["longest_outage_h"],
        })
    path = os.path.join(a.out, f"mast_{key}.json")
    with open(path, "w") as f:
        f.write(lr.to_json({"site": {"key": key, "name": label, "lat": lat, "lon": lon},
                            "period": [times[0], times[-1]], "rows": rows}) + "\n")
    print("wrote:", path)
    print(f"{label}  ({lat}, {lon}), {lm.format_time(times[0])} .. {lm.format_time(times[-1])}")
    print(f"  {'mast':>6s} {'mean horizon':>13s} {'Sun visible':>12s} {'longest dark':>13s} {'Earth visible':>14s} {'longest outage':>15s}")
    for r in rows:
        print(f"  {r['mast_m']:5.0f}m {r['mean_horizon_deg']:+12.2f}d {r['sun_visible_pct']:11.1f}% "
              f"{lm.format_duration(r['longest_darkness_h']):>13s} {r['earth_visible_pct']:13.1f}% "
              f"{lm.format_duration(r['longest_earth_outage_h']):>15s}")


def run_horizon(a, key, label, lat, lon):
    """Terrain horizon + surface statistics for a site (needs the LOLA DEM)."""
    import lunar_terrain as lt

    horizon = lt.compute_horizon(lat, lon, mast_m=a.mast)
    surface = lt.surface_properties(lat, lon, radius_m=a.ellipse)
    surface["psr"] = lt.psr_access(lat, lon)
    path = os.path.join(a.out, f"horizon_{key}.json")
    os.makedirs(a.out, exist_ok=True)
    lt.save_horizon(path, {"key": key, "name": label, "lat": lat, "lon": lon}, horizon, surface)
    print("wrote:", path)

    h = horizon["horizon_deg"]
    print(f"{label}  ({lat}, {lon}), observer {a.mast} m above the surface")
    print(f"  Ground height     : {horizon['ground_height_m']:+.0f} m (relative to the 1737.4 km sphere)")
    print(f"  Terrain horizon   : min {h.min():+.2f}, mean {h.mean():+.2f}, max {h.max():+.2f} deg")
    print("  By direction (deg):", "  ".join(
        f"{name} {h[int(az / 360 * len(h))]:+.1f}"
        for name, az in (("N", 0), ("NE", 45), ("E", 90), ("SE", 135),
                         ("S", 180), ("SW", 225), ("W", 270), ("NW", 315))))
    for title, s in (("LOLA slope map", surface["slope_lola_deg"]),
                     ("derived from DEM", surface["slope_derived_deg"])):
        print(f"  Slope within {a.ellipse:.0f} m ({title}): median {s['median']:.1f}, "
              f"95th pct {s['p95']:.1f}, max {s['max']:.1f} deg; "
              f"{s['pct_below_10deg']:.0f}% below 10 deg")
    print(f"  DEM height error  : {surface['height_error_m']['site']:.2f} m at site, "
          f"max {surface['height_error_m']['max']:.2f} m")
    print(f"  DEM effective res.: {surface['effective_resolution_m']['site']:.0f} m at site, "
          f"max {surface['effective_resolution_m']['max']:.0f} m")
    print("  " + describe_psr(surface["psr"]))


def describe_psr(psr):
    """One-line summary of the permanently-shadowed-region access block."""
    if psr is None:
        return "Permanent shadow  : outside the PSR map (north of ~80S)"
    if psr["site_in_psr"]:
        return "Permanent shadow  : the site itself is inside a PSR"
    if psr["nearest_distance_m"] is None:
        return f"Permanent shadow  : none within {psr['search_radius_m'] / 1000:.0f} km"
    return (f"Permanent shadow  : nearest at {psr['nearest_distance_m'] / 1000:.2f} km, bearing "
            f"{psr['bearing_deg']:.0f} deg; slope on the way mean {psr['path_slope_deg']['mean']:.1f}, "
            f"max {psr['path_slope_deg']['max']:.1f} deg; "
            f"{psr['psr_area_pct_within_5km']:.1f}% of the area within 5 km is PSR")


def run_metrics(a, key, label, lat, lon, sky_path):
    """Analyze the Skyfield table; uses the whole CSV (--start/--days are ignored).

    --height must match the value used for `compute`, since it sets the horizon dip.
    """
    import lunar_metrics as lm

    times, sun_alt, earth_alt, sun_az, earth_az = lm.load_series(sky_path)
    suffix, sun_horizon, earth_horizon = "", None, None
    if a.terrain:
        import lunar_terrain as lt

        horizon = lt.load_horizon(os.path.join(a.out, f"horizon_{key}.json"))
        sun_horizon = lt.horizon_at(horizon, sun_az).tolist()
        earth_horizon = lt.horizon_at(horizon, earth_az).tolist()
        suffix = "_terrain"
    result = lm.analyze(times, sun_alt, earth_alt,
                        dip_deg=horizon_dip_deg(a.height), mask_deg=a.mask,
                        sun_horizon=sun_horizon, earth_horizon=earth_horizon)
    result = {"site": {"key": key, "name": label, "lat": lat, "lon": lon,
                       "height_m": a.height}, **result}
    if a.at:
        when = datetime.strptime(a.at, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
        result["status"] = {"utc": when, **lm.status_at(result, when)}

    path = os.path.join(a.out, f"metrics_{key}{suffix}.json")
    with open(path, "w") as f:
        f.write(lm.to_json(result) + "\n")
    print("wrote:", path)

    per = result["period"]
    thr = result["thresholds_deg"]
    print(f"{label}  ({lat}, {lon}), height {a.height} m")
    print(f"  Period: {lm.format_time(per['start'])} .. {lm.format_time(per['end'])} ({per['days']:.1f} d)")
    if a.terrain:
        print("  Horizon: LOLA terrain (upper limb must clear the terrain in the body's direction)")
    else:
        print(f"  Horizon: ideal sphere (upper limb above {a.mask - thr['horizon_dip']:+.2f} deg)")
    rows = (("sun", "Sun (power)"), ("earth", "Earth (comm)"), ("both", "Sun + Earth"))
    print(f"  {'':14s} {'visible':>8s} {'windows':>8s} {'longest window':>15s} {'longest outage':>15s}")
    for name, title in rows:
        s = result[name]["summary"]
        win = lm.format_duration(s["longest_window_h"]) + ("*" if s["longest_window_truncated"] else "")
        gap = lm.format_duration(s["longest_outage_h"]) + ("*" if s["longest_outage_truncated"] else "")
        print(f"  {title:14s} {s['visible_pct']:7.1f}% {s['window_count']:8d} {win:>15s} {gap:>15s}")
    print("  (* touches the edge of the data; the real duration is longer)")
    print(f"  Mean visible fraction of the solar disk: {result['sun']['summary']['mean_disk_fraction_pct']:.1f}%")

    events = sorted(result["sun"]["events"] + result["earth"]["events"], key=lambda e: e["utc"])
    print(f"  Events ({len(events)}):")
    for e in events:
        print(f"    {lm.format_time(e['utc'])}  {e['type']}")

    if a.at:
        print(f"  Status at {lm.format_time(result['status']['utc'])}:")
        for name, title in rows:
            st = result["status"][name]
            state = "visible" if st["visible"] else "not visible"
            if st["next_change"] is None:
                nxt = "no change before the end of the data"
            else:
                verb = "ends" if st["visible"] else "starts"
                nxt = (f"{verb} in {lm.format_duration(st['hours_until_change'])} "
                       f"({lm.format_time(st['next_change'])})")
            print(f"    {title:14s} {state:12s} {nxt}")


if __name__ == "__main__":
    main()
