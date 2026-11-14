"""Visibility metrics derived from a Sun/Earth elevation time series.

Input is the table written by `lunar_sky.py compute` (utc, sun_alt_deg,
earth_alt_deg, ...). From it this module extracts:

- rise/set events (sunrise, sunset, earthrise, earthset), interpolated
  linearly between samples;
- visibility windows for the Sun (power), the Earth (direct-to-Earth
  communication) and both at once;
- summary numbers: visible percentage, longest uninterrupted window,
  longest outage, mean visible fraction of the solar disk;
- the status at a given instant: visible or not, and time until the next change.

Visibility rule: a body counts as visible while its UPPER LIMB is above the
horizon, i.e. while

    center elevation > mask - disk radius - horizon dip

`dip` is the geometric horizon dip due to observer height; `mask` is an
optional minimum elevation (antenna or safety margin).

When a terrain horizon is supplied (see `lunar_terrain.py`), the rule becomes

    center elevation > mask - disk radius + terrain horizon(azimuth)

i.e. the upper limb must clear the terrain in the direction of the body.
"""
import csv
import json
import math
from datetime import datetime, timedelta, timezone

SUN_RADIUS_DEG = 0.27      # angular radius seen from the Moon
EARTH_RADIUS_DEG = 0.95

TIME_FMT = "%Y-%m-%dT%H:%MZ"


def parse_time(text):
    return datetime.strptime(text, TIME_FMT).replace(tzinfo=timezone.utc)


def format_time(t):
    return (t + timedelta(seconds=30)).strftime(TIME_FMT)   # round to the minute


def load_series(path):
    """Read a compute CSV. Returns (times, sun_alt, earth_alt, sun_az, earth_az)."""
    times, sun, earth, sun_az, earth_az = [], [], [], [], []
    with open(path) as f:
        for row in csv.DictReader(f):
            times.append(parse_time(row["utc"]))
            sun.append(float(row["sun_alt_deg"]))
            earth.append(float(row["earth_alt_deg"]))
            sun_az.append(float(row["sun_az_deg"]))
            earth_az.append(float(row["earth_az_deg"]))
    if len(times) < 2:
        raise RuntimeError(f"{path}: need at least two samples")
    return times, sun, earth, sun_az, earth_az


def disk_fraction(center_alt_deg, radius_deg, horizon_deg=0.0):
    """Fraction of a disk's area above a straight horizon (0..1)."""
    x = (center_alt_deg - horizon_deg) / radius_deg
    if x >= 1.0:
        return 1.0
    if x <= -1.0:
        return 0.0
    return 0.5 + (x * math.sqrt(1.0 - x * x) + math.asin(x)) / math.pi


def find_events(times, margin):
    """Zero crossings of `margin` (visible while margin > 0).

    Returns [(time, rising), ...] with linearly interpolated times.
    """
    events = []
    for i in range(1, len(times)):
        m0, m1 = margin[i - 1], margin[i]
        if (m0 > 0) == (m1 > 0):
            continue
        frac = m0 / (m0 - m1)
        events.append((times[i - 1] + (times[i] - times[i - 1]) * frac, m1 > 0))
    return events


def build_windows(times, margin, events, positive=True):
    """Intervals where margin > 0 (or <= 0 if positive=False).

    Each window is a dict with start, end, hours and `truncated`, which is
    True when the window touches the edge of the data (its real extent is
    unknown).
    """
    windows = []
    inside = (margin[0] > 0) == positive
    start, open_start = (times[0], True) if inside else (None, False)
    for when, rising in events:
        if rising == positive:
            start, open_start = when, False
        else:
            windows.append(_window(start, when, open_start))
            start = None
    if start is not None:
        windows.append(_window(start, times[-1], True))
    return windows


def _window(start, end, truncated):
    return {
        "start": start,
        "end": end,
        "hours": (end - start).total_seconds() / 3600.0,
        "truncated": truncated,
    }


def _summarize(times, windows, gaps):
    total_h = (times[-1] - times[0]).total_seconds() / 3600.0
    longest = max(windows, key=lambda w: w["hours"], default=None)
    longest_gap = max(gaps, key=lambda w: w["hours"], default=None)
    return {
        "visible_pct": 100.0 * sum(w["hours"] for w in windows) / total_h,
        "window_count": len(windows),
        "longest_window_h": longest["hours"] if longest else 0.0,
        "longest_window_truncated": bool(longest and longest["truncated"]),
        "longest_outage_h": longest_gap["hours"] if longest_gap else 0.0,
        "longest_outage_truncated": bool(longest_gap and longest_gap["truncated"]),
    }


def _track(times, margin, rise_name, set_name):
    events = find_events(times, margin)
    windows = build_windows(times, margin, events, positive=True)
    gaps = build_windows(times, margin, events, positive=False)
    return {
        "summary": _summarize(times, windows, gaps),
        "events": [
            {"utc": when, "type": rise_name if rising else set_name}
            for when, rising in events
        ],
        "windows": windows,
    }


def analyze(times, sun_alt, earth_alt, dip_deg=0.0, mask_deg=0.0,
            sun_horizon=None, earth_horizon=None):
    """Compute all metrics. Returns a dict with keys sun, earth, both.

    `sun_horizon` / `earth_horizon` are optional per-sample terrain horizon
    elevations (deg) in the direction of each body; when given they replace
    the ideal-sphere horizon (and `dip_deg` is ignored).

    Times inside the result are datetime objects; use `to_json` to serialize.
    """
    terrain = sun_horizon is not None and earth_horizon is not None
    if not terrain:
        sun_horizon = [-dip_deg] * len(times)
        earth_horizon = [-dip_deg] * len(times)
    sun_margin = [a + SUN_RADIUS_DEG - h - mask_deg for a, h in zip(sun_alt, sun_horizon)]
    earth_margin = [a + EARTH_RADIUS_DEG - h - mask_deg for a, h in zip(earth_alt, earth_horizon)]
    both_margin = [min(s, e) for s, e in zip(sun_margin, earth_margin)]

    result = {
        "period": {"start": times[0], "end": times[-1],
                   "days": (times[-1] - times[0]).total_seconds() / 86400.0},
        "horizon_model": "terrain" if terrain else "sphere",
        "thresholds_deg": {"sun_radius": SUN_RADIUS_DEG, "earth_radius": EARTH_RADIUS_DEG,
                           "horizon_dip": 0.0 if terrain else dip_deg, "mask": mask_deg},
        "sun": _track(times, sun_margin, "sunrise", "sunset"),
        "earth": _track(times, earth_margin, "earthrise", "earthset"),
        "both": _track(times, both_margin, "both_start", "both_end"),
    }
    fractions = [disk_fraction(a, SUN_RADIUS_DEG, h + mask_deg)
                 for a, h in zip(sun_alt, sun_horizon)]
    result["sun"]["summary"]["mean_disk_fraction_pct"] = 100.0 * sum(fractions) / len(fractions)
    result["sun"]["summary"]["elevation_range_deg"] = [min(sun_alt), max(sun_alt)]
    result["earth"]["summary"]["elevation_range_deg"] = [min(earth_alt), max(earth_alt)]
    return result


def status_at(result, when):
    """State of sun / earth / both at `when`.

    Returns {name: {"visible": bool, "next_change": datetime or None,
    "hours_until_change": float or None}}. `next_change` is None when no
    rise/set happens before the end of the data.
    """
    start, end = result["period"]["start"], result["period"]["end"]
    if not start <= when <= end:
        raise ValueError(f"{format_time(when)} is outside the data range "
                         f"{format_time(start)} .. {format_time(end)}")
    status = {}
    for name in ("sun", "earth", "both"):
        track = result[name]
        visible = any(w["start"] <= when < w["end"] for w in track["windows"])
        upcoming = [e["utc"] for e in track["events"] if e["utc"] > when]
        nxt = upcoming[0] if upcoming else None
        status[name] = {
            "visible": visible,
            "next_change": nxt,
            "hours_until_change": (nxt - when).total_seconds() / 3600.0 if nxt else None,
        }
    return status


def to_json(obj):
    """Serialize a result dict (datetimes -> ISO strings, floats rounded)."""
    def convert(o):
        if isinstance(o, datetime):
            return format_time(o)
        if isinstance(o, float):
            return round(o, 4)
        if isinstance(o, dict):
            return {k: convert(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [convert(v) for v in o]
        return o
    return json.dumps(convert(obj), indent=2)


def format_duration(hours):
    """Human-readable duration, e.g. '6.2 d' or '14.5 h'."""
    if hours is None:
        return "-"
    return f"{hours / 24.0:.1f} d" if hours >= 48 else f"{hours:.1f} h"
