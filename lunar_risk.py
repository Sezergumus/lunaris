"""Mission risk indicators for a landing site, landing date and mission length.

Builds on the other modules:
- `lunar_sky.py compute`  -> Sun/Earth azimuth and elevation time series
- `lunar_sky.py horizon`  -> terrain horizon and surface slope (optional)
- `lunar_sky.py dsn`      -> Moon elevation at the DSN ground stations (optional)

Indicators, all evaluated per time sample and then summarized over the
mission window [landing, landing + duration]:

Power
- terrain eclipse: the Sun's disk hidden (fully or partly) by terrain;
- eclipse by the Earth: the Earth's disk covering part of the Sun's disk;
- available solar fraction = visible fraction of the solar disk;
- longest continuous darkness, compared with the battery survival time;
- grazing Sun: time with the disk only partly visible.

Communication (direct-to-Earth)
- Earth occultation by terrain;
- ground-station gap: no DSN complex has the Moon above its elevation mask;
- solar conjunction: Sun too close to the Earth as seen from the lander, so
  the Earth-pointing antenna picks up solar radio noise;
- low elevation: Earth close to the local horizon (multipath-prone); counted
  as degraded, not as an outage.

Surface
- slope inside the landing ellipse versus the lander's tip-over limit.

The risk score is a transparent 0-100 number per category (0 = at most half
of a mission limit is used, 100 = the limit is reached or exceeded; below
33 is "low", below 66 "medium"); the overall score is the worst category,
because any single one can end the mission. Limits live in `DEFAULT_PROFILE`
and are assumptions to be replaced by real mission requirements.
"""
import json
from datetime import timedelta

import numpy as np

import lunar_metrics as lm

DEFAULT_PROFILE = {
    "duration_days": 14.0,          # surface mission length
    "battery_survival_h": 50.0,     # longest darkness the lander survives
    "min_sunlit_pct": 50.0,         # required share of the mission with usable Sun
    "min_solar_fraction": 0.5,      # disk fraction that counts as usable Sun
    "max_comm_outage_h": 24.0,      # longest tolerable loss of contact
    "min_comm_pct": 50.0,           # required share of the mission with contact
    "station_min_elevation_deg": 10.0,
    "conjunction_deg": 2.0,         # Sun-Earth separation that jams the link
    "low_elevation_deg": 2.0,       # Earth center this close to terrain = degraded
    "max_slope_deg": 10.0,          # tip-over / landing limit
    "mask_deg": 0.0,                # extra elevation margin on every horizon
}

STATIONS = ("goldstone", "madrid", "canberra")


# ------------------------------------------------------------- geometry
def angular_separation_deg(az1, alt1, az2, alt2):
    a1, a2 = np.radians(alt1), np.radians(alt2)
    cos_sep = (np.sin(a1) * np.sin(a2)
               + np.cos(a1) * np.cos(a2) * np.cos(np.radians(np.asarray(az1) - np.asarray(az2))))
    return np.degrees(np.arccos(np.clip(cos_sep, -1.0, 1.0)))


def covered_fraction(separation_deg, r_small=lm.SUN_RADIUS_DEG, r_big=lm.EARTH_RADIUS_DEG):
    """Fraction of the small disk's area covered by the big disk."""
    d = np.asarray(separation_deg, dtype=float)
    out = np.zeros_like(d)
    out[d <= r_big - r_small] = 1.0
    partial = (d > r_big - r_small) & (d < r_big + r_small)
    dp = d[partial]
    a1 = r_small ** 2 * np.arccos((dp ** 2 + r_small ** 2 - r_big ** 2) / (2 * dp * r_small))
    a2 = r_big ** 2 * np.arccos((dp ** 2 + r_big ** 2 - r_small ** 2) / (2 * dp * r_big))
    a3 = 0.5 * np.sqrt((-dp + r_small + r_big) * (dp + r_small - r_big)
                       * (dp - r_small + r_big) * (dp + r_small + r_big))
    out[partial] = (a1 + a2 - a3) / (np.pi * r_small ** 2)
    return out


def terrain_disk_fraction(center_alt, horizon, radius):
    """Vectorized `lunar_metrics.disk_fraction`."""
    x = np.clip((np.asarray(center_alt) - np.asarray(horizon)) / radius, -1.0, 1.0)
    return 0.5 + (x * np.sqrt(1.0 - x * x) + np.arcsin(x)) / np.pi


# --------------------------------------------------------------- series
def load_station_table(path):
    """Read the `dsn` CSV. Returns {utc string: [elevations per station]}."""
    import csv

    with open(path) as f:
        return {r["utc"]: [float(r[f"{s}_alt_deg"]) for s in STATIONS]
                for r in csv.DictReader(f)}


def build_series(times, sun_alt, earth_alt, sun_az, earth_az,
                 horizon=None, stations=None, profile=None):
    """Per-sample state of power and communication.

    `horizon` is a dict from `lunar_terrain.load_horizon` (None = ideal
    sphere); `stations` is the table from `load_station_table` (None = a
    ground station is assumed to be always available).
    """
    p = {**DEFAULT_PROFILE, **(profile or {})}
    sun_alt, earth_alt = np.asarray(sun_alt), np.asarray(earth_alt)
    sun_az, earth_az = np.asarray(sun_az), np.asarray(earth_az)
    if horizon is not None:
        import lunar_terrain as lt

        sun_hor = lt.horizon_at(horizon, sun_az) + p["mask_deg"]
        earth_hor = lt.horizon_at(horizon, earth_az) + p["mask_deg"]
    else:
        sun_hor = np.full(sun_alt.shape, p["mask_deg"])
        earth_hor = np.full(earth_alt.shape, p["mask_deg"])

    separation = angular_separation_deg(sun_az, sun_alt, earth_az, earth_alt)
    terrain_fraction = terrain_disk_fraction(sun_alt, sun_hor, lm.SUN_RADIUS_DEG)
    earth_cover = covered_fraction(separation)
    # The Earth only blocks sunlight if it is itself above the terrain.
    earth_cover = np.where(earth_alt + lm.EARTH_RADIUS_DEG > earth_hor, earth_cover, 0.0)
    solar_fraction = terrain_fraction * (1.0 - earth_cover)

    earth_visible = earth_alt + lm.EARTH_RADIUS_DEG > earth_hor
    if stations is not None:
        key = [lm.format_time(t) for t in times]
        missing = [k for k in key if k not in stations]
        if missing:
            raise RuntimeError(f"station table has no row for {missing[0]}; rerun "
                               "`lunar_sky.py dsn` with the same --start/--days/--step")
        station_alt = np.array([stations[k] for k in key])
        station_ok = (station_alt > p["station_min_elevation_deg"]).any(axis=1)
    else:
        station_ok = np.ones(sun_alt.shape, dtype=bool)
    conjunction = earth_visible & (separation < p["conjunction_deg"])
    comm = earth_visible & station_ok & ~conjunction
    low_elevation = comm & (earth_alt - earth_hor < p["low_elevation_deg"])

    step_h = (times[1] - times[0]).total_seconds() / 3600.0
    return {
        "times": times,
        "step_h": step_h,
        "profile": p,
        "terrain": horizon is not None,
        "stations": stations is not None,
        "sun_above_terrain_deg": sun_alt - sun_hor,
        "earth_above_terrain_deg": earth_alt - earth_hor,
        "sun_earth_separation_deg": separation,
        "terrain_fraction": terrain_fraction,
        "earth_cover": earth_cover,
        "solar_fraction": solar_fraction,
        "sunlit": solar_fraction >= p["min_solar_fraction"],
        "dark": solar_fraction <= 0.0,
        "earth_visible": earth_visible,
        "station_ok": station_ok,
        "conjunction": conjunction,
        "comm": comm,
        "low_elevation": low_elevation,
    }


# --------------------------------------------------------------- window
def _longest_run_h(flags, step_h):
    """Longest run of True samples, in hours."""
    longest = run = 0
    for f in flags:
        run = run + 1 if f else 0
        longest = max(longest, run)
    return longest * step_h


def _hours(flags, step_h):
    return float(np.count_nonzero(flags)) * step_h


def analyze_window(series, landing, duration_days=None):
    """Indicators over the mission window starting at `landing`."""
    p = series["profile"]
    duration = p["duration_days"] if duration_days is None else duration_days
    times, step_h = series["times"], series["step_h"]
    i0 = int(round((landing - times[0]).total_seconds() / 3600.0 / step_h))
    n = int(round(duration * 24.0 / step_h))
    if i0 < 0 or i0 + n > len(times):
        raise ValueError(f"mission window {lm.format_time(landing)} + {duration:g} d "
                         f"is outside the data ({lm.format_time(times[0])} .. "
                         f"{lm.format_time(times[-1])})")
    w = slice(i0, i0 + n)
    s = {k: v[w] for k, v in series.items() if isinstance(v, np.ndarray)}
    total_h = n * step_h
    partial = (s["terrain_fraction"] > 0.0) & (s["terrain_fraction"] < 1.0)
    return {
        "landing": landing,
        "end": landing + timedelta(days=duration),
        "duration_days": duration,
        "power": {
            "sunlit_pct": 100.0 * _hours(s["sunlit"], step_h) / total_h,
            "mean_solar_fraction_pct": 100.0 * float(s["solar_fraction"].mean()),
            "longest_darkness_h": _longest_run_h(s["dark"], step_h),
            "dark_at_landing": bool(s["dark"][0]),
            "partial_disk_h": _hours(partial, step_h),
            "earth_eclipse_h": _hours(s["earth_cover"] > 0.0, step_h),
            "max_earth_cover_pct": 100.0 * float(s["earth_cover"].max()),
            "sun_above_terrain_deg": [float(s["sun_above_terrain_deg"].min()),
                                      float(s["sun_above_terrain_deg"].max())],
        },
        "comm": {
            "available_pct": 100.0 * _hours(s["comm"], step_h) / total_h,
            "longest_outage_h": _longest_run_h(~s["comm"], step_h),
            "terrain_occultation_h": _hours(~s["earth_visible"], step_h),
            "station_gap_h": _hours(s["earth_visible"] & ~s["station_ok"], step_h),
            "conjunction_h": _hours(s["conjunction"], step_h),
            "low_elevation_h": _hours(s["low_elevation"], step_h),
            "earth_above_terrain_deg": [float(s["earth_above_terrain_deg"].min()),
                                        float(s["earth_above_terrain_deg"].max())],
        },
    }


# ---------------------------------------------------------------- score
COMFORT_FRACTION = 0.5   # up to this share of a limit counts as no risk


def _limit_risk(value, limit):
    """0 up to half the limit, rising linearly to 100 at the limit or beyond."""
    used = value / limit
    return 100.0 * min(1.0, max(0.0, (used - COMFORT_FRACTION) / (1.0 - COMFORT_FRACTION)))


def _shortfall_risk(value, required):
    """0 when the requirement is met, 100 when nothing of it is delivered."""
    return 100.0 * min(1.0, max(0.0, (required - value) / required))


def risk_level(score):
    if score is None:
        return "unknown"
    return "low" if score < 33.0 else "medium" if score < 66.0 else "high"


def score_window(window, profile, surface=None):
    """Risk scores (0-100) for a window from `analyze_window`.

    Each category is the worse of its two tests. `surface` is the surface
    block of a horizon file; without it the surface score is None.
    """
    pw, cm = window["power"], window["comm"]
    power = max(_limit_risk(pw["longest_darkness_h"], profile["battery_survival_h"]),
                _shortfall_risk(pw["sunlit_pct"], profile["min_sunlit_pct"]))
    comm = max(_limit_risk(cm["longest_outage_h"], profile["max_comm_outage_h"]),
               _shortfall_risk(cm["available_pct"], profile["min_comm_pct"]))
    slope = None
    if surface is not None:
        slope = _limit_risk(surface["slope_lola_deg"]["p95"], profile["max_slope_deg"])
    present = [v for v in (power, comm, slope) if v is not None]
    overall = max(present)
    driver = ("power", "comm", "surface")[[power, comm, slope].index(overall)]
    return {
        "power": power, "comm": comm, "surface": slope,
        "overall": overall, "level": risk_level(overall), "driver": driver,
    }


def scan_landing_dates(series, surface=None, step_days=1.0, duration_days=None):
    """Score every possible landing date in the data. Returns a list of rows."""
    p = series["profile"]
    duration = p["duration_days"] if duration_days is None else duration_days
    times = series["times"]
    rows, landing = [], times[0]
    while landing + timedelta(days=duration) <= times[-1]:
        window = analyze_window(series, landing, duration)
        score = score_window(window, p, surface)
        rows.append({
            "landing": landing,
            "sunlit_pct": window["power"]["sunlit_pct"],
            "longest_darkness_h": window["power"]["longest_darkness_h"],
            "comm_pct": window["comm"]["available_pct"],
            "longest_comm_outage_h": window["comm"]["longest_outage_h"],
            "risk_power": score["power"], "risk_comm": score["comm"],
            "risk_overall": score["overall"], "level": score["level"],
        })
        landing += timedelta(days=step_days)
    return rows


def to_json(obj):
    """Serialize results (datetimes -> ISO strings, floats rounded)."""
    def convert(o):
        if hasattr(o, "strftime"):
            return lm.format_time(o)
        if isinstance(o, (bool, np.bool_)):
            return bool(o)
        if isinstance(o, (float, np.floating)):
            return round(float(o), 3)
        if isinstance(o, (int, np.integer)):
            return int(o)
        if isinstance(o, dict):
            return {k: convert(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [convert(v) for v in o]
        return o
    return json.dumps(convert(obj), indent=1)
