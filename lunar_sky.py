"""Azimuth/elevation of the Sun and Earth as seen from a point on the lunar surface.

Subcommands:
  sites     List the built-in landing sites
  compute   Compute locally with Skyfield                -> data/skyfield_<site>.csv
  horizons  Fetch the same table from the JPL Horizons API -> data/horizons_<site>.csv
  compare   Compare the two tables and print difference statistics
  events    Check rise/set times against one-minute Horizons
            tables (--terrain: with the terrain horizon) -> data/events_<site>.json
  metrics   Rise/set events, visibility windows and summary numbers
            from the Skyfield table                     -> data/metrics_<site>.json
            (--terrain: use the terrain horizon          -> data/metrics_<site>_terrain.json)
  horizon   Terrain horizon and surface properties from
            the LOLA DEM                                -> data/horizon_<site>.json
  dsn       Moon elevation at the three DSN complexes   -> data/dsn_moon.csv
  risk      Mission-window indicators, risk score and
            landing-date scan                           -> data/risk_<site>.json
  mast      Sensitivity to observer (mast) height       -> data/mast_<site>.json
  rank      Compare all sites for one landing date      -> data/ranking.json
  nearby    Search alternative landing points around a
            site (rings out to 10 km; needs the LOLA DEM) -> data/nearby_<site>.json
  vectors   Sun and Earth position vectors from the Moon's
            center, valid for any site                  -> data/ephemeris_vectors.csv
  grid      Terrain horizon and slope for a square of
            points around a site (needs the LOLA DEM)   -> data/grid_<site>.json
  patch     Nested terrain height windows around a site
            for the 3D surface view (needs the LOLA DEM) -> data/terrain_<site>.json, .bin

Example:
  python lunar_sky.py compute  --site malapert_a --start 2026-12-01 --days 30
  python lunar_sky.py horizons --site malapert_a --start 2026-12-01 --days 30
  python lunar_sky.py compare  --site malapert_a
  python lunar_sky.py events   --site mons_mouton --terrain
  python lunar_sky.py metrics  --site malapert_a --at 2026-12-10T12:00
  python lunar_sky.py horizon  --site malapert_a
  python lunar_sky.py metrics  --site malapert_a --terrain
  python lunar_sky.py dsn      --start 2026-12-01 --days 365
  python lunar_sky.py risk     --site malapert_a --landing 2026-12-16 --duration 14
  python lunar_sky.py mast     --site malapert_a --masts 2,5,10
  python lunar_sky.py rank     --landing 2026-12-16
  python lunar_sky.py nearby   --site malapert_a --landing 2026-12-16
  python lunar_sky.py vectors  --start 2026-12-01 --days 1491
  python lunar_sky.py grid     --site malapert_a --grid 9 --grid-step 125
  python lunar_sky.py patch    --site malapert_a

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


def compute_points(points, times, kernel_dir, height_m=0.0):
    """Sun/Earth angles for several (lat, lon) points; kernels are loaded once.

    Returns one dict per point with arrays sun_az, sun_alt, earth_az, earth_alt (deg).
    """
    ts, eph, pc, frame = load_skyfield(kernel_dir)
    t = ts.from_datetimes(times)
    results = []
    for lat, lon in points:
        place = pc.build_latlon_degrees(frame, lat, lon, elevation_m=height_m)
        observer = (eph["moon"] + place).at(t)
        out = {}
        for body in ("sun", "earth"):
            alt, az, _ = observer.observe(eph[body]).apparent().altaz()
            out[body + "_az"], out[body + "_alt"] = az.degrees, alt.degrees
        results.append(out)
    return results


def compute(lat, lon, height_m, times, kernel_dir):
    """Return [(utc, sun_az, sun_alt, earth_az, earth_alt), ...]."""
    out = compute_points([(lat, lon)], times, kernel_dir, height_m)[0]
    return [
        (times[i], out["sun_az"][i], out["sun_alt"][i], out["earth_az"][i], out["earth_alt"][i])
        for i in range(len(times))
    ]


def moon_centered_vectors(times, kernel_dir):
    """Apparent position of the Sun and Earth centers from the Moon's center.

    Vectors are in the Moon-fixed frame MOON_ME_DE421, in km. One table
    serves every site: subtract the site vector and project on the local
    horizontal frame (`vectors_to_altaz`). Returns {"sun": (3, n), "earth": (3, n)}.
    """
    ts, eph, _, frame = load_skyfield(kernel_dir)
    t = ts.from_datetimes(times)
    center = eph["moon"].at(t)
    return {body: center.observe(eph[body]).apparent().frame_xyz(frame).km
            for body in ("sun", "earth")}


def vectors_to_altaz(vector_km, lat, lon, height_m=0.0):
    """Azimuth and elevation (deg) of Moon-centered vectors seen from a site.

    This is the computation the web client does for a custom coordinate;
    `vector_km` has shape (3, n). Azimuth is clockwise from north.
    """
    import numpy as np

    la, lo = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(up, east)
    rel = np.asarray(vector_km) - (MOON_RADIUS_KM + height_m / 1000.0) * up[:, None]
    e, n, u = east @ rel, north @ rel, up @ rel
    return np.degrees(np.arctan2(e, n)) % 360.0, np.degrees(np.arctan2(u, np.hypot(e, n)))


VECTOR_HEADER = ["utc", "sun_x_km", "sun_y_km", "sun_z_km", "earth_x_km", "earth_y_km", "earth_z_km"]


def run_vectors(a):
    """Write the site-independent vectors table and check it against the per-site tables."""
    import numpy as np

    times = time_grid(a.start, a.days, a.step)
    os.makedirs(a.kernels, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    vectors = moon_centered_vectors(times, a.kernels)
    path = os.path.join(a.out, "ephemeris_vectors.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(VECTOR_HEADER)
        sun, earth = vectors["sun"], vectors["earth"]
        for i, t in enumerate(times):
            w.writerow([t.strftime("%Y-%m-%dT%H:%MZ")]
                       + [f"{sun[k][i]:.1f}" for k in range(3)]
                       + [f"{earth[k][i]:.3f}" for k in range(3)])
    print("wrote:", path, f"({len(times)} rows, {times[0]:%Y-%m-%d} .. {times[-1]:%Y-%m-%d})")

    # Read the file back, so the check covers the rounding of the written values.
    with open(path) as f:
        rows = list(csv.DictReader(f))
    index = {r["utc"]: i for i, r in enumerate(rows)}
    table = {body: np.array([[float(r[f"{body}_{k}_km"]) for r in rows] for k in "xyz"])
             for body in ("sun", "earth")}
    print("  Check against the per-site tables (max |difference|, deg):")
    for key, (_, lat, lon) in SITES.items():
        site_path = os.path.join(a.out, f"skyfield_{key}.csv")
        if not os.path.exists(site_path):
            continue
        site = read_csv(site_path)
        common = [u for u in site if u in index]
        if not common:
            print(f"    {key:17s} no common timestamps")
            continue
        pick = [index[u] for u in common]
        ref = np.array([site[u] for u in common])
        worst = []
        for col, body in ((0, "sun"), (2, "earth")):
            az, alt = vectors_to_altaz(table[body][:, pick], lat, lon)
            # Azimuth differences are scaled to great-circle size (cos of elevation).
            d_az = np.abs((az - ref[:, col] + 180.0) % 360.0 - 180.0) * np.cos(np.radians(alt))
            worst += [d_az.max(), np.abs(alt - ref[:, col + 1]).max()]
        print(f"    {key:17s} sun az {worst[0]:.5f} alt {worst[1]:.5f}   "
              f"earth az {worst[2]:.5f} alt {worst[3]:.5f}   ({len(common)} samples)")


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
def horizons_table(body_id, lat, lon, height_m, start, stop, step_min, quantities="4"):
    """Azimuth and elevation from Horizons as {utc: (az, alt)}; with
    quantities "4,13" the angular diameter (arcsec) follows as a third value."""
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
        "QUANTITIES": f"'{quantities}'",
        "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }
    r = requests.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=120)
    r.raise_for_status()
    return parse_horizons(r.text, 3 if quantities == "4,13" else 2)


def parse_horizons(text, columns=2):
    """Extract {utc: (az, alt)} from the rows between $$SOE and $$EOE
    (the last `columns` numbers of each row)."""
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
        rows[when] = tuple(nums[-columns:])   # azimuth, elevation[, angular diameter]
    return rows


# ------------------------------------------------------------------- CSV I/O
HEADER = ["utc", "sun_az_deg", "sun_alt_deg", "earth_az_deg", "earth_alt_deg"]


def write_csv(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
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
    p.add_argument("cmd", choices=["compute", "horizons", "compare", "metrics", "horizon", "dsn", "risk", "mast",
                                  "rank", "nearby", "vectors", "grid", "patch", "backtest", "events", "sites"])
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
    p.add_argument("--profile", default="generic", choices=["generic", "solar_lander", "battery_rover"],
                   help="risk: named mission profile (lunar_risk.PROFILE_PRESETS); other options override it")
    p.add_argument("--battery-hours", type=float, help="risk: longest survivable darkness (h)")
    p.add_argument("--max-outage-hours", type=float, help="risk: longest tolerable comm outage (h)")
    p.add_argument("--min-contact-hours", type=float, help="risk: required contact in every 24 h (h)")
    p.add_argument("--max-slope", type=float, help="risk: slope limit (deg)")
    p.add_argument("--sphere", action="store_true",
                   help="risk: ignore the terrain horizon even if one is available")
    p.add_argument("--radii", default="1,2,5,10",
                   help="nearby: ring radii around the site (km, comma-separated)")
    p.add_argument("--grid", type=int, default=9,
                   help="grid: points per side of the square around the site (odd number)")
    p.add_argument("--grid-step", type=float, default=125.0,
                   help="grid: distance between neighbouring points (m)")
    p.add_argument("--precision", type=float,
                   help="grid/risk profile: landing precision, the radius in which slope is judged (m)")
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
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["utc"] + [f"{name}_alt_deg" for name in DSN_STATIONS])
            for i, t in enumerate(times):
                w.writerow([t.strftime("%Y-%m-%dT%H:%MZ")] + [f"{alt[n][i]:.3f}" for n in DSN_STATIONS])
        print("wrote:", path, f"({len(times)} rows)")
        return

    if a.cmd == "rank":
        run_rank(a)
        return

    if a.cmd == "vectors":
        run_vectors(a)
        return

    if a.cmd == "backtest":
        run_backtest(a)
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

    elif a.cmd == "nearby":
        run_nearby(a, key, label, lat, lon, sky_path)

    elif a.cmd == "grid":
        run_grid(a, key, label, lat, lon, sky_path)

    elif a.cmd == "patch":
        run_patch(a, key, label, lat, lon)

    elif a.cmd == "events":
        run_events(a, key, label, lat, lon, sky_path)


def parse_instant(text):
    fmt = "%Y-%m-%dT%H:%M" if "T" in text else "%Y-%m-%d"
    return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)


def build_profile(a):
    """Risk profile: defaults overridden by command-line options."""
    import lunar_risk as lr

    profile = lr.preset_profile(a.profile)
    for name, value in (("duration_days", a.duration), ("battery_survival_h", a.battery_hours),
                        ("max_comm_outage_h", a.max_outage_hours),
                        ("min_daily_contact_h", a.min_contact_hours), ("max_slope_deg", a.max_slope),
                        ("landing_precision_m", a.precision), ("mask_deg", a.mask or None)):
        if value is not None:
            profile[name] = value
    return profile


def load_stations(a):
    import lunar_risk as lr

    path = os.path.join(a.out, "dsn_moon.csv")
    return lr.load_station_table(path) if os.path.exists(path) else None


def load_site_series(a, key, profile, stations):
    """Risk time series for a precomputed site. Returns (series, surface)."""
    import json

    import lunar_metrics as lm
    import lunar_risk as lr

    times, sun_alt, earth_alt, sun_az, earth_az = lm.load_series(
        os.path.join(a.out, f"skyfield_{key}.csv"))
    horizon, surface = None, None
    hor_path = os.path.join(a.out, f"horizon_{key}.json")
    if os.path.exists(hor_path) and not a.sphere:
        import lunar_terrain as lt

        horizon = lt.load_horizon(hor_path)
        with open(hor_path) as f:
            surface = json.load(f).get("surface")
    series = lr.build_series(times, sun_alt, earth_alt, sun_az, earth_az,
                             horizon=horizon, stations=stations, profile=profile)
    return series, surface


def describe_dates(dates):
    """Lines describing the date alternatives block of `lunar_risk.date_alternatives`."""
    import lunar_metrics as lm

    def day(t):
        return "none" if t is None else lm.format_time(t)[:10]

    if dates["low_risk_now"]:
        first = f"low risk; the landing can slip {dates['slip_tolerance_days']} more day(s) and stay low"
    else:
        first = "NOT low risk on the requested date"
    return [
        f"Requested date: {first}",
        f"Nearest low-risk landing dates: earlier {day(dates['nearest_earlier'])}, "
        f"later {day(dates['nearest_later'])}",
        f"Low-risk landing windows ({dates['low_risk_dates']} dates): " + (", ".join(
            f"{day(w['start'])}..{day(w['end'])}" for w in dates["windows"][:8])
            + (" ..." if len(dates["windows"]) > 8 else "") if dates["windows"] else "none"),
    ]


def run_rank(a):
    """Compare every precomputed site for the same landing date and profile."""
    import lunar_metrics as lm
    import lunar_risk as lr

    profile, stations = build_profile(a), load_stations(a)
    rows, landing = [], None
    for key, (label, lat, lon) in SITES.items():
        if not os.path.exists(os.path.join(a.out, f"skyfield_{key}.csv")):
            continue
        series, surface = load_site_series(a, key, profile, stations)
        landing = parse_instant(a.landing) if a.landing else series["times"][0]
        ev = lr.evaluate(series, surface, landing)
        rows.append({"key": key, "name": label, "lat": lat, "lon": lon,
                     "horizon_model": "terrain" if series["terrain"] else "sphere",
                     "window": ev["window"], "score": ev["score"], "dates": ev["dates"]})
    rows.sort(key=lambda r: (r["score"]["overall"], -r["dates"]["slip_tolerance_days"]))
    path = os.path.join(a.out, "ranking.json")
    with open(path, "w") as f:
        f.write(lr.to_json({"landing": landing, "profile": profile, "sites": rows}) + "\n")
    print("wrote:", path)
    print(f"Landing {lm.format_time(landing)}, {profile['duration_days']:g}-day mission")
    print(f"  {'site':17s} {'risk':>5s} {'level':>7s} {'driver':>8s} {'sunlit':>7s} {'dark max':>9s} "
          f"{'comm':>6s} {'outage':>8s} {'slip tol.':>10s} {'next low-risk date':>19s}")
    for r in rows:
        w, sc, d = r["window"], r["score"], r["dates"]
        nxt = "now" if d["low_risk_now"] else (
            lm.format_time(d["nearest_later"])[:10] if d["nearest_later"] else "none")
        print(f"  {r['key']:17s} {sc['overall']:5.0f} {sc['level']:>7s} {sc['driver']:>8s} "
              f"{w['power']['sunlit_pct']:6.1f}% {lm.format_duration(w['power']['longest_darkness_h']):>9s} "
              f"{w['comm']['available_pct']:5.1f}% {lm.format_duration(w['comm']['longest_outage_h']):>8s} "
              f"{d['slip_tolerance_days']:8d} d {nxt:>19s}")


def run_nearby(a, key, label, lat, lon, sky_path):
    """Evaluate alternative landing points on rings around a site (needs the LOLA DEM)."""
    import lunar_metrics as lm
    import lunar_risk as lr
    import lunar_terrain as lt

    profile, stations = build_profile(a), load_stations(a)
    times = lm.load_series(sky_path)[0]
    landing = parse_instant(a.landing) if a.landing else times[0]
    radii_km = [float(v) for v in a.radii.split(",")]

    candidates = [{"distance_km": 0.0, "bearing_deg": 0.0, "lat": lat, "lon": lon}]
    for radius in radii_km:
        for bearing in range(0, 360, 45):
            lat2, lon2 = lt.destination(lat, lon, float(bearing), radius * 1000.0)
            candidates.append({"distance_km": radius, "bearing_deg": float(bearing),
                               "lat": float(lat2), "lon": float((lon2 + 180.0) % 360.0 - 180.0)})

    reach = max(radii_km) * 1000.0
    x, y = lt.latlon_to_xy(lat, lon)
    near = lt.read_window("height_m", x, y, lt.NEAR_RADIUS_M + reach)
    far = lt.read_window("height_m", x, y, lt.FAR_RADIUS_M + reach, lt.FAR_DECIMATION)
    angles = compute_points([(c["lat"], c["lon"]) for c in candidates], times, a.kernels)

    for c, ang in zip(candidates, angles):
        horizon = lt.compute_horizon(c["lat"], c["lon"], mast_m=a.mast, near=near, far=far)
        cx, cy = lt.latlon_to_xy(c["lat"], c["lon"])
        slope = lt._slope_stats(lt._disk_values(near, lt.slope_from_heights(near),
                                                float(cx), float(cy), a.ellipse))
        surface = {"slope_derived_deg": slope}
        series = lr.build_series(times, ang["sun_alt"], ang["earth_alt"], ang["sun_az"],
                                 ang["earth_az"], horizon=horizon, stations=stations, profile=profile)
        ev = lr.evaluate(series, surface, landing)
        w, sc, d = ev["window"], ev["score"], ev["dates"]
        c.update({
            "ground_height_m": horizon["ground_height_m"],
            "slope_p95_deg": slope["p95"],
            "sunlit_pct": w["power"]["sunlit_pct"],
            "longest_darkness_h": w["power"]["longest_darkness_h"],
            "comm_pct": w["comm"]["available_pct"],
            "longest_comm_outage_h": w["comm"]["longest_outage_h"],
            "risk_power": sc["power"], "risk_comm": sc["comm"], "risk_surface": sc["surface"],
            "risk_overall": sc["overall"], "level": sc["level"], "driver": sc["driver"],
            "slip_tolerance_days": d["slip_tolerance_days"],
            "low_risk_dates": d["low_risk_dates"],
            "nearest_later_low_risk": d["nearest_later"],
        })

    base = candidates[0]
    best = min(candidates, key=lambda c: (c["risk_overall"], -c["slip_tolerance_days"], c["distance_km"]))
    robust = max(candidates, key=lambda c: (c["slip_tolerance_days"], c["low_risk_dates"], -c["distance_km"]))
    flexible = max(candidates, key=lambda c: (c["low_risk_dates"], -c["distance_km"]))
    path = os.path.join(a.out, f"nearby_{key}.json")
    with open(path, "w") as f:
        f.write(lr.to_json({
            "site": {"key": key, "name": label, "lat": lat, "lon": lon},
            "landing": landing, "profile": profile, "mast_m": a.mast, "ellipse_m": a.ellipse,
            "slope_source": "derived from the 60 m LOLA DEM",
            "best_for_date": best, "most_slip_tolerant": robust, "most_low_risk_dates": flexible,
            "candidates": candidates,
        }) + "\n")
    print("wrote:", path)

    compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

    def where(c):
        if c["distance_km"] == 0:
            return "site itself"
        return f"{c['distance_km']:g} km {compass[int(c['bearing_deg'] // 45)]}"

    print(f"{label}  ({lat}, {lon}); landing {lm.format_time(landing)}, "
          f"{profile['duration_days']:g}-day mission, slope within {a.ellipse:.0f} m")
    print(f"  {'point':>12s} {'lat':>8s} {'lon':>8s} {'height':>7s} {'slope95':>8s} {'sunlit':>7s} "
          f"{'dark max':>9s} {'comm':>6s} {'risk':>5s} {'driver':>8s} {'slip tol.':>10s} {'low-risk dates':>15s}")
    for c in sorted(candidates, key=lambda c: (c["risk_overall"], -c["slip_tolerance_days"],
                                               -c["low_risk_dates"], c["distance_km"])):
        print(f"  {where(c):>12s} {c['lat']:8.3f} {c['lon']:8.2f} {c['ground_height_m']:+7.0f} "
              f"{c['slope_p95_deg']:7.1f}d {c['sunlit_pct']:6.1f}% "
              f"{lm.format_duration(c['longest_darkness_h']):>9s} {c['comm_pct']:5.1f}% "
              f"{c['risk_overall']:5.0f} {c['driver']:>8s} {c['slip_tolerance_days']:8d} d "
              f"{c['low_risk_dates']:15d}")
    print(f"  Requested site      : risk {base['risk_overall']:.0f} ({base['level']}), "
          f"{base['low_risk_dates']} low-risk landing dates in the year")
    print(f"  Best for this date  : {where(best)} -> risk {best['risk_overall']:.0f} ({best['level']}), "
          f"slip tolerance {best['slip_tolerance_days']} d")
    print(f"  Most slip-tolerant  : {where(robust)} -> {robust['slip_tolerance_days']} d "
          f"(risk {robust['risk_overall']:.0f})")
    print(f"  Most low-risk dates : {where(flexible)} -> {flexible['low_risk_dates']} dates in the year")


def run_grid(a, key, label, lat, lon, sky_path):
    """Horizon and slope for a square of points around a site (needs the LOLA DEM).

    The file has the shape of the terrain service's `/horizon` response. If
    the site's Sun/Earth table exists, every point is also scored for the
    landing date and the best neighbour is printed (the file is not affected).
    """
    import numpy as np

    import lunar_metrics as lm
    import lunar_risk as lr
    import lunar_terrain as lt

    profile, stations = build_profile(a), load_stations(a)
    doc = lt.compute_grid(lat, lon, n=a.grid, step_m=a.grid_step, mast_m=a.mast,
                          precision_m=profile["landing_precision_m"])
    doc = {"site": {"key": key, "name": label, "lat": lat, "lon": lon}, **doc}
    path = os.path.join(a.out, f"grid_{key}.json")
    os.makedirs(a.out, exist_ok=True)
    with open(path, "w") as f:
        f.write(lt.grid_to_json(doc) + "\n")
    points = doc["points"]
    print("wrote:", path, f"({len(points)} points)")
    print(f"{label}  ({lat}, {lon}); {a.grid} x {a.grid} points every {a.grid_step:g} m, "
          f"slope within {doc['precision_m']:g} m from the {doc['slope_source']}")
    if not doc["horizon_coverage_complete"]:
        print("  Note: terrain beyond the edge of the map is missing from these horizons")
    if not os.path.exists(sky_path):
        return

    times = lm.load_series(sky_path)[0]
    landing = parse_instant(a.landing) if a.landing else times[0]
    angles = compute_points([(pt["lat"], pt["lon"]) for pt in points], times, a.kernels)
    rows = []
    for pt, ang in zip(points, angles):
        horizon = {"azimuth_deg": pt["azimuth_step_deg"] * np.arange(len(pt["horizon_deg"])),
                   "horizon_deg": pt["horizon_deg"]}
        series = lr.build_series(times, ang["sun_alt"], ang["earth_alt"], ang["sun_az"],
                                 ang["earth_az"], horizon=horizon, stations=stations, profile=profile)
        window = lr.analyze_window(series, landing)
        score = lr.score_window(window, profile, {"slope_lola_deg": {"p95": pt["slope_deg"]}})
        rows.append((pt, window, score))

    def where(pt):
        if pt["east_m"] == 0 and pt["north_m"] == 0:
            return "site itself"
        parts = [f"{abs(v):g} m {pos if v > 0 else neg}"
                 for v, pos, neg in ((pt["north_m"], "N", "S"), (pt["east_m"], "E", "W")) if v]
        return ", ".join(parts)

    def line(title, row):
        pt, w, sc = row
        return (f"  {title:14s}: {where(pt):>16s}  usable Sun {w['power']['sunlit_pct']:5.1f}%  "
                f"dark max {lm.format_duration(w['power']['longest_darkness_h']):>7s}  "
                f"link {w['comm']['available_pct']:5.1f}%  slope {pt['slope_deg']:4.1f} deg  "
                f"risk {sc['overall']:3.0f} ({sc['level']}, {sc['driver']})")

    best = min(rows, key=lambda r: (r[2]["overall"], -r[1]["power"]["sunlit_pct"],
                                    math.hypot(r[0]["east_m"], r[0]["north_m"])))
    scores = [r[2]["overall"] for r in rows]
    sun = [r[1]["power"]["sunlit_pct"] for r in rows]
    print(f"  Landing {lm.format_time(landing)}, {profile['duration_days']:g}-day mission")
    print(line("Requested site", rows[0]))
    print(line("Best neighbour", best))
    print(f"  Over the grid : risk {min(scores):.0f} .. {max(scores):.0f}, "
          f"usable Sun {min(sun):.1f} .. {max(sun):.1f}%, "
          f"{sum(1 for v in scores if v < 33)} of {len(rows)} points low-risk")


def run_risk(a, key, label, lat, lon, sky_path):
    """Mission-window indicators, risk score, slip table and landing-date scan."""
    import lunar_metrics as lm
    import lunar_risk as lr

    profile, stations = build_profile(a), load_stations(a)
    series, surface = load_site_series(a, key, profile, stations)
    horizon = series["terrain"] or None
    times = series["times"]
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
    dates = lr.date_alternatives(scan, landing)

    # Same mission with the horizon raised by what the map's height error allows.
    uncertainty = None
    height_error = ((surface or {}).get("height_error_m") or {}).get("max")
    if horizon is not None and height_error is not None:
        import numpy as np

        import lunar_terrain as lt

        raised, margin = lr.raised_horizon(lt.load_horizon(os.path.join(a.out, f"horizon_{key}.json")),
                                           height_error)
        sky = lm.load_series(sky_path)
        worse = lr.build_series(sky[0], sky[1], sky[2], sky[3], sky[4],
                                horizon=raised, stations=stations, profile=profile)
        worse_window = lr.analyze_window(worse, landing)
        uncertainty = {
            "height_error_m": height_error,
            "basis": "largest LOLA height error inside the landing ellipse, applied at the distance "
                     "of the obstruction that sets the horizon in each direction",
            "margin_deg": {"median": float(np.median(margin)), "max": float(np.max(margin))},
            "window": worse_window,
            "score": lr.score_window(worse_window, profile, surface),
            "low_risk_dates": sum(1 for r in lr.scan_landing_dates(worse, surface) if r["level"] == "low"),
        }

    result = {
        "site": {"key": key, "name": label, "lat": lat, "lon": lon},
        "horizon_model": "terrain" if horizon is not None else "sphere",
        "ground_stations": "dsn" if stations is not None else "always available (no table)",
        "profile": profile,
        "window": window,
        "score": score,
        "slips": slips,
        "dates": dates,
        "scan": scan,
    }
    if uncertainty is not None:
        result["horizon_uncertainty"] = uncertainty
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
    print(f"    contact on the worst day      : {cm['worst_day_contact_h']:g} h"
          f"  (required {profile['min_daily_contact_h']:g} h in every 24 h)")
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
    if uncertainty is not None:
        u, us = uncertainty, uncertainty["score"]
        low_now = sum(1 for r in scan if r["level"] == "low")
        print(f"  With the map's height error ({u['height_error_m']:.2f} m -> horizon up to "
              f"{u['margin_deg']['max']:.2f} deg higher, median {u['margin_deg']['median']:.3f}): "
              f"power {fmt(us['power'])}  comm {fmt(us['comm'])}  ->  overall {us['overall']:.0f} ({us['level']}); "
              f"low-risk landing dates {low_now} -> {u['low_risk_dates']}")
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
    for line in describe_dates(dates):
        print("  " + line)


# Flown mission used to check the model against what happened. Dates from ISRO statements
# as reported in the press (see CLAUDE.md, "Validation").
BACKTEST = {
    "site": "chandrayaan3",
    "mission": "Chandrayaan-3 (Vikram lander, Pragyan rover)",
    "landing": "2023-08-23T12:33",
    "duration_days": 12.0,
    "start": "2023-07-15",
    "days": 120,
    "observed": {
        "rover_put_to_sleep": "2023-09-02",
        "lander_put_to_sleep": "2023-09-04",
        "wake_up_attempt_at_next_sunrise": "2023-09-22",
        "outcome": "operated from landing to local sunset; never woke up after the night",
    },
}


def run_backtest(a):
    """Run the model on a mission that has flown and compare with what happened.

    Chandrayaan-3 landed shortly after local sunrise and worked until sunset. The model
    passes when it rates the real landing date low risk, the same mission two weeks later
    high risk, and puts the sunset on the days the vehicles were put to sleep. Sky and
    station tables for 2023 are computed in memory; the terrain horizon is the site's
    existing data/horizon_<site>.json (terrain does not depend on the date).
    """
    import json

    import lunar_metrics as lm
    import lunar_risk as lr
    import lunar_terrain as lt

    bt = BACKTEST
    key = bt["site"]
    label, lat, lon = SITES[key]
    times = time_grid(bt["start"], bt["days"], 60)
    os.makedirs(a.kernels, exist_ok=True)
    sky = compute_points([(lat, lon)], times, a.kernels)[0]
    alt = station_moon_elevation(times, a.kernels)
    stations = {t.strftime("%Y-%m-%dT%H:%MZ"): [float(alt[n][i]) for n in DSN_STATIONS]
                for i, t in enumerate(times)}
    hor_path = os.path.join(a.out, f"horizon_{key}.json")
    horizon = lt.load_horizon(hor_path)
    with open(hor_path) as f:
        surface = json.load(f).get("surface")

    profile = build_profile(a)
    profile["duration_days"] = a.duration or bt["duration_days"]
    series = lr.build_series(times, sky["sun_alt"], sky["earth_alt"], sky["sun_az"], sky["earth_az"],
                             horizon=horizon, stations=stations, profile=profile)
    landing = parse_instant(bt["landing"])
    slips = []
    for days in (0, 7, 14, 21, 28):
        w = lr.analyze_window(series, landing + timedelta(days=days))
        slips.append({"slip_days": days, "window": w, "score": lr.score_window(w, profile, surface)})
    scan = lr.scan_landing_dates(series, surface)
    dates = lr.date_alternatives(scan, landing)

    track = lm.analyze(times, sky["sun_alt"], sky["earth_alt"],
                       sun_horizon=lt.horizon_at(horizon, sky["sun_az"]).tolist(),
                       earth_horizon=lt.horizon_at(horizon, sky["earth_az"]).tolist())
    sun_events = track["sun"]["events"]
    sunset = next(e["utc"] for e in sun_events if e["type"] == "sunset" and e["utc"] > landing)
    sunrise = next(e["utc"] for e in sun_events if e["type"] == "sunrise" and e["utc"] > sunset)
    obs = bt["observed"]
    sleep = parse_instant(obs["lander_put_to_sleep"])
    wake = parse_instant(obs["wake_up_attempt_at_next_sunrise"])
    checks = {
        "landing_date_is_low_risk": slips[0]["score"]["level"] == "low",
        "two_weeks_later_is_high_risk": slips[2]["score"]["level"] == "high",
        "sunset_on_the_day_the_lander_was_put_to_sleep": sunset.date() == sleep.date(),
        "sunrise_before_the_wake_up_attempt": sunrise <= wake + timedelta(days=1),
    }
    result = {
        "mission": bt["mission"],
        "site": {"key": key, "name": label, "lat": lat, "lon": lon},
        "profile": profile,
        "landing": landing,
        "observed": obs,
        "model": {
            "sunset_after_landing": sunset,
            "next_sunrise": sunrise,
            "sunlit_days_after_landing": round((sunset - landing).total_seconds() / 86400, 2),
            "sunrise_to_wake_up_attempt_days": round((wake - sunrise).total_seconds() / 86400, 2),
        },
        "checks": checks,
        "passed": all(checks.values()),
        "slips": slips,
        "dates": dates,
    }
    path = os.path.join(a.out, f"backtest_{key}.json")
    with open(path, "w") as f:
        f.write(lr.to_json(result) + "\n")
    print("wrote:", path)

    print(f"{bt['mission']}: land {lm.format_time(landing)}, {profile['duration_days']:g}-day mission, "
          f"profile '{a.profile}'")
    print(f"  {'slip':>6s} {'landing':>18s} {'sunlit':>7s} {'dark max':>9s} {'comm':>6s}  risk")
    for row in slips:
        w, sc = row["window"], row["score"]
        print(f"  {row['slip_days']:+5d}d {lm.format_time(w['landing']):>18s} {w['power']['sunlit_pct']:6.1f}% "
              f"{lm.format_duration(w['power']['longest_darkness_h']):>9s} {w['comm']['available_pct']:5.1f}%"
              f"  {sc['overall']:.0f} ({sc['level']})")
    print(f"  Model sunset after landing : {lm.format_time(sunset)}"
          f"  (rover put to sleep {obs['rover_put_to_sleep']}, lander {obs['lander_put_to_sleep']})")
    print(f"  Model next sunrise         : {lm.format_time(sunrise)}"
          f"  (wake-up attempt {obs['wake_up_attempt_at_next_sunrise']})")
    for line in describe_dates(dates):
        print("  " + line)
    for name, ok in checks.items():
        print(f"  [{'pass' if ok else 'FAIL'}] {name.replace('_', ' ')}")
    print("  Result:", "PASS" if result["passed"] else "FAIL")


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


def run_events(a, key, label, lat, lon, sky_path):
    """Check the rise/set times of `metrics` against JPL Horizons.

    `metrics` finds each event by linear interpolation in the hourly Skyfield
    table. Here every event is located again in a one-minute Horizons table
    around it, with the same visibility rule (upper limb against the sphere
    or, with --terrain, against the terrain horizon in the body's direction).
    A second time uses the disk radius Horizons reports for that instant
    instead of the fixed 0.27 / 0.95 deg, to show what the fixed radius costs.
    """
    import time

    import lunar_metrics as lm

    times, sun_alt, earth_alt, sun_az, earth_az = lm.load_series(sky_path)
    horizon, sun_horizon, earth_horizon = None, None, None
    if a.terrain:
        import lunar_terrain as lt

        horizon = lt.load_horizon(os.path.join(a.out, f"horizon_{key}.json"))
        sun_horizon = lt.horizon_at(horizon, sun_az).tolist()
        earth_horizon = lt.horizon_at(horizon, earth_az).tolist()
    result = lm.analyze(times, sun_alt, earth_alt, sun_horizon=sun_horizon, earth_horizon=earth_horizon)
    events = sorted(result["sun"]["events"] + result["earth"]["events"], key=lambda e: e["utc"])
    # An event on the first or last hour of the table has no room for a search window.
    events = [e for e in events if times[0] + timedelta(hours=6) < e["utc"] < times[-1] - timedelta(hours=6)]

    def crossings(table, radius_of, rising):
        """Instants where the upper limb crosses the horizon in the wanted direction."""
        when = sorted(table)
        margin = []
        for t in when:
            az, alt, diameter = table[t]
            ground = float(lt.horizon_at(horizon, az)) if horizon is not None else 0.0
            margin.append(alt + radius_of(diameter) - ground)
        return [t for t, up in lm.find_events(when, margin) if up == rising]

    rows = []
    for index, event in enumerate(events):
        sun = event["type"].startswith("sun")
        rising = event["type"].endswith("rise")
        fixed = lm.SUN_RADIUS_DEG if sun else lm.EARTH_RADIUS_DEG
        row = {"utc": event["utc"], "type": event["type"]}
        for half_h in (2, 12):
            start = (event["utc"] - timedelta(hours=half_h)).replace(second=0, microsecond=0)
            for attempt in range(4):
                try:
                    table = horizons_table(10 if sun else 399, lat, lon, a.height,
                                           start, start + timedelta(hours=2 * half_h), 1, "4,13")
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(5 * (attempt + 1))
            found = crossings(table, lambda d: fixed, rising)
            if found:
                break
        if found:
            nearest = min(found, key=lambda t: abs(t - event["utc"]))
            row["horizons_utc"] = nearest
            row["difference_min"] = (event["utc"] - nearest).total_seconds() / 60.0
            true_disk = crossings(table, lambda d: d / 7200.0, rising)
            if true_disk:
                best = min(true_disk, key=lambda t: abs(t - event["utc"]))
                row["horizons_true_disk_utc"] = best
                row["difference_true_disk_min"] = (event["utc"] - best).total_seconds() / 60.0
            middle = table[sorted(table)[len(table) // 2]]
            row["disk_radius_deg"] = middle[2] / 7200.0
        rows.append(row)
        print(f"  {index + 1:3d}/{len(events)} {lm.format_time(event['utc'])} {event['type']:10s} "
              + (f"{row['difference_min']:+7.1f} min" if found else "no crossing within 12 h in Horizons"),
              flush=True)

    def stats(name, field, body):
        values = sorted(abs(r[field]) for r in rows if field in r and r["type"].startswith(body))
        if not values:
            return None
        out = {"events": len(values), "median_min": values[len(values) // 2],
               "p95_min": values[min(len(values) - 1, int(0.95 * len(values)))], "max_min": values[-1]}
        print(f"  {name:34s} {out['events']:4d} events: median {out['median_min']:.1f}, "
              f"95th pct {out['p95_min']:.1f}, max {out['max_min']:.1f} min")
        return out

    model = "terrain" if a.terrain else "sphere"
    print(f"{label}  ({lat}, {lon}), {model} horizon: |metrics - Horizons| over {len(rows)} events")
    summary = {
        "sun_same_radius": stats("Sun, same disk radius", "difference_min", "sun"),
        "earth_same_radius": stats("Earth, same disk radius", "difference_min", "earth"),
        "sun_true_disk": stats("Sun, Horizons disk radius", "difference_true_disk_min", "sun"),
        "earth_true_disk": stats("Earth, Horizons disk radius", "difference_true_disk_min", "earth"),
        "unmatched": sum(1 for r in rows if "difference_min" not in r),
    }
    print(f"  Events without a crossing in Horizons within 12 h: {summary['unmatched']}")
    path = os.path.join(a.out, f"events_{key}{'_terrain' if a.terrain else ''}.json")
    with open(path, "w") as f:
        f.write(lm.to_json({"site": {"key": key, "name": label, "lat": lat, "lon": lon},
                            "horizon_model": model,
                            "method": "each rise/set of the hourly Skyfield table (linear interpolation) "
                                      "against the same rule on a one-minute JPL Horizons table",
                            "summary": summary, "events": rows}) + "\n")
    print("wrote:", path)


def run_patch(a, key, label, lat, lon):
    """Nested terrain height windows for the 3D surface view (needs the LOLA DEM)."""
    import lunar_terrain as lt

    try:
        patch = lt.compute_patch(lat, lon)
    except ValueError as error:
        sys.exit(f"{label}: {error}")
    os.makedirs(a.out, exist_ok=True)
    json_path = os.path.join(a.out, f"terrain_{key}.json")
    bin_path = os.path.join(a.out, f"terrain_{key}.bin")
    lt.save_patch(json_path, bin_path, {"key": key, "name": label, "lat": lat, "lon": lon}, patch)
    print("wrote:", json_path)
    print("wrote:", bin_path, f"({os.path.getsize(bin_path)} bytes)")
    print(f"{label}  ({lat}, {lon}), ground height {patch['ground_height_m']:+.0f} m")
    for index, grid in enumerate(patch["levels"]):
        size = grid.data.shape[0]
        print(f"  Level {index}: {size} x {size} pixels of {grid.pixel_m:g} m "
              f"({size * grid.pixel_m / 1000:.1f} km wide), "
              f"height {grid.data.min():+.0f} .. {grid.data.max():+.0f} m")


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
