"""Terrain horizon and surface properties from the LOLA south-pole DEMs.

Data: "A New View of the Lunar South Pole from LOLA" (Barker et al.),
https://pgda.gsfc.nasa.gov/products/90 . The files are cloud-optimized
GeoTIFFs in south polar stereographic X/Y (meters, MOON_ME frame, sphere of
radius 1737.4 km), so a window around a site can be read either from a local
copy in `data/lola/` or directly from the server with HTTP range requests.

What this module computes for a site:

- the terrain horizon: for each azimuth, the highest elevation angle of the
  surrounding terrain as seen from the observer (lunar curvature included);
- surface properties around the site: height, slope, DEM height error and
  DEM effective resolution, summarized over a landing-ellipse radius.

The horizon uses two grids: full resolution close to the site (where pixel
size matters) and a decimated overview for distant terrain.
"""
import json
import math
import os

import numpy as np

MOON_RADIUS_M = 1737400.0
REMOTE_BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
LOCAL_DIR = os.path.join("data", "lola")

# Products covering 60S..90S at 60 m/pixel.
PRODUCTS = {
    "height_m": "LDEM_60S_60MPP_ADJ.TIF",
    "slope_deg": "LDSM_60S_60MPP_ADJ.TIF",
    "height_error_m": "LDEM_60S_60MPP_ADJ_ERR.TIF",
    "effective_resolution_m": "LDEM_60S_60MPP_ADJ_EFFRES.TIF",
    # Permanently shadowed regions (1 = PSR), 80S..90S at 20 m/pixel.
    "psr": "LPSR_80S_20MPP_ADJ.TIF",
}
PSR_COVERAGE_M = 304_000.0   # half-size of the PSR map

NEAR_RADIUS_M = 25_000.0     # full-resolution window half-size
FAR_RADIUS_M = 250_000.0     # decimated window half-size
FAR_DECIMATION = 4           # 60 m -> 240 m for distant terrain
NEAR_LIMIT_M = 20_000.0      # switch from near grid to far grid at this range


# ------------------------------------------------------------- projection
def latlon_to_xy(lat_deg, lon_deg):
    """South polar stereographic (true scale at the pole), meters."""
    colat = np.radians(90.0 + np.asarray(lat_deg, dtype=float))
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    r = 2.0 * MOON_RADIUS_M * np.tan(colat / 2.0)
    return r * np.sin(lon), r * np.cos(lon)


def xy_to_latlon(x, y):
    r = np.hypot(x, y)
    lat = -90.0 + np.degrees(2.0 * np.arctan(r / (2.0 * MOON_RADIUS_M)))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def destination(lat_deg, lon_deg, azimuth_deg, distance_m):
    """Point reached from (lat, lon) along a great circle (arrays allowed)."""
    lat1, lon1 = math.radians(lat_deg), math.radians(lon_deg)
    az = np.radians(azimuth_deg)
    theta = np.asarray(distance_m) / MOON_RADIUS_M
    sin_lat2 = math.sin(lat1) * np.cos(theta) + math.cos(lat1) * np.sin(theta) * np.cos(az)
    lat2 = np.arcsin(np.clip(sin_lat2, -1.0, 1.0))
    lon2 = lon1 + np.arctan2(np.sin(az) * np.sin(theta) * math.cos(lat1),
                             np.cos(theta) - math.sin(lat1) * sin_lat2)
    return np.degrees(lat2), np.degrees(lon2)


# ----------------------------------------------------------------- raster
def product_path(name):
    """Local file if present, otherwise the remote URL (range reads).

    Set LUNAR_TERRAIN_REMOTE=1 to force remote reads.
    """
    filename = PRODUCTS[name]
    local = os.path.join(LOCAL_DIR, filename)
    if os.path.exists(local) and not os.environ.get("LUNAR_TERRAIN_REMOTE"):
        return local
    return "/vsicurl/" + REMOTE_BASE + filename


def download_product(name):
    """Download a full product into data/lola/ (resumable; large files)."""
    import requests

    filename = PRODUCTS[name]
    os.makedirs(LOCAL_DIR, exist_ok=True)
    final = os.path.join(LOCAL_DIR, filename)
    if os.path.exists(final):
        return final
    part = final + ".part"
    done = os.path.getsize(part) if os.path.exists(part) else 0
    with requests.get(REMOTE_BASE + filename, stream=True, timeout=120,
                      headers={"Range": f"bytes={done}-"}) as r:
        r.raise_for_status()
        with open(part, "ab" if r.status_code == 206 else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    os.replace(part, final)
    return final


class Grid:
    """A square raster window with bilinear sampling in projected X/Y."""

    def __init__(self, data, x0, y0, pixel_m):
        self.data = data          # row 0 is the top (largest y)
        self.x0 = x0              # x of the left edge
        self.y0 = y0              # y of the top edge
        self.pixel_m = pixel_m

    def sample(self, x, y):
        """Bilinear value at (x, y); NaN outside the window."""
        col = (np.asarray(x) - self.x0) / self.pixel_m - 0.5
        row = (self.y0 - np.asarray(y)) / self.pixel_m - 0.5
        rows, cols = self.data.shape
        inside = (col >= 0) & (col <= cols - 1) & (row >= 0) & (row <= rows - 1)
        c0 = np.clip(np.floor(col).astype(int), 0, cols - 2)
        r0 = np.clip(np.floor(row).astype(int), 0, rows - 2)
        fc, fr = col - c0, row - r0
        d = self.data
        value = (d[r0, c0] * (1 - fc) * (1 - fr) + d[r0, c0 + 1] * fc * (1 - fr)
                 + d[r0 + 1, c0] * (1 - fc) * fr + d[r0 + 1, c0 + 1] * fc * fr)
        return np.where(inside, value, np.nan)


def read_window(name, x_center, y_center, radius_m, decimation=1):
    """Read a square window of a product around a projected point."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import Window

    with rasterio.open(product_path(name)) as ds:
        pixel = ds.transform.a
        col_c = (x_center - ds.transform.c) / pixel
        row_c = (ds.transform.f - y_center) / pixel
        half = int(math.ceil(radius_m / pixel / decimation)) * decimation
        col0 = max(0, int(round(col_c)) - half)
        row0 = max(0, int(round(row_c)) - half)
        col1 = min(ds.width, int(round(col_c)) + half)
        row1 = min(ds.height, int(round(row_c)) + half)
        col1 -= (col1 - col0) % decimation
        row1 -= (row1 - row0) % decimation
        window = Window(col0, row0, col1 - col0, row1 - row0)
        out_shape = ((row1 - row0) // decimation, (col1 - col0) // decimation)
        data = ds.read(1, window=window, out_shape=out_shape,
                       resampling=Resampling.average).astype(np.float32)
        return Grid(data, ds.transform.c + col0 * pixel,
                    ds.transform.f - row0 * pixel, pixel * decimation)


# ---------------------------------------------------------------- horizon
def ray_distances(max_m, pixel_m, growth=0.002):
    """Sample ranges along a ray: pixel-sized steps that grow with distance."""
    d, out = pixel_m / 2.0, []
    while d < max_m:
        out.append(d)
        d += max(pixel_m, growth * d)
    return np.array(out)


def compute_horizon(lat, lon, mast_m=2.0, az_step_deg=0.5, near=None, far=None):
    """Terrain horizon as seen from `mast_m` above the surface at (lat, lon).

    Returns a dict with the azimuth grid (deg, clockwise from north), the
    horizon elevation angle per azimuth (deg) and the range of the terrain
    point that defines it (km), plus the ground height at the site.
    """
    x_site, y_site = latlon_to_xy(lat, lon)
    if near is None:
        near = read_window("height_m", x_site, y_site, NEAR_RADIUS_M)
    if far is None:
        far = read_window("height_m", x_site, y_site, FAR_RADIUS_M, FAR_DECIMATION)

    ground = float(near.sample(x_site, y_site))
    r_obs = MOON_RADIUS_M + ground + mast_m

    az = np.arange(0.0, 360.0, az_step_deg)
    d_near = ray_distances(NEAR_LIMIT_M, near.pixel_m)
    d_far = d_near[-1] + ray_distances(FAR_RADIUS_M - d_near[-1], far.pixel_m)
    elevation = np.full(az.size, -90.0)
    distance = np.zeros(az.size)
    for grid, dist in ((near, d_near), (far, d_far)):
        lat2, lon2 = destination(lat, lon, az[:, None], dist[None, :])
        x, y = latlon_to_xy(lat2, lon2)
        r_target = MOON_RADIUS_M + grid.sample(x, y)
        theta = dist[None, :] / MOON_RADIUS_M
        # Elevation of the target above the observer's local horizontal plane.
        angle = np.degrees(np.arctan2(r_target * np.cos(theta) - r_obs,
                                      r_target * np.sin(theta)))
        angle = np.where(np.isnan(angle), -90.0, angle)
        best = angle.argmax(axis=1)
        best_angle = angle[np.arange(az.size), best]
        better = best_angle > elevation
        elevation = np.where(better, best_angle, elevation)
        distance = np.where(better, dist[best], distance)

    return {
        "ground_height_m": ground,
        "mast_m": mast_m,
        "azimuth_deg": az,
        "horizon_deg": elevation,
        "horizon_range_km": distance / 1000.0,
    }


def horizon_at(horizon, azimuth_deg):
    """Interpolate the horizon elevation at arbitrary azimuths (deg)."""
    az = horizon["azimuth_deg"]
    return np.interp(np.asarray(azimuth_deg) % 360.0, az, horizon["horizon_deg"], period=360.0)


# ---------------------------------------------------------------- surface
def slope_from_heights(grid):
    """Slope (deg) from central differences of a height grid."""
    dz_dy, dz_dx = np.gradient(grid.data, grid.pixel_m)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def _disk_values(grid, values, x, y, radius_m):
    rows, cols = values.shape
    xs = grid.x0 + (np.arange(cols) + 0.5) * grid.pixel_m
    ys = grid.y0 - (np.arange(rows) + 0.5) * grid.pixel_m
    mask = np.hypot(xs[None, :] - x, ys[:, None] - y) <= radius_m
    picked = values[mask]
    return picked[~np.isnan(picked)]


def surface_properties(lat, lon, radius_m=1000.0, near=None):
    """Surface statistics inside a circle of `radius_m` around the site.

    Slope is reported twice: from the LOLA slope map (LDSM) and derived from
    the 60 m height grid (about 120 m baseline), so the two can be compared.
    """
    x, y = latlon_to_xy(lat, lon)
    x, y = float(x), float(y)
    if near is None:
        near = read_window("height_m", x, y, radius_m + 300.0)
    heights = _disk_values(near, near.data, x, y, radius_m)
    derived = _disk_values(near, slope_from_heights(near), x, y, radius_m)

    out = {
        "radius_m": radius_m,
        "height_m": {"site": float(near.sample(x, y)),
                     "min": float(heights.min()), "max": float(heights.max())},
        "slope_derived_deg": _slope_stats(derived),
    }
    for name in ("slope_deg", "height_error_m", "effective_resolution_m"):
        grid = read_window(name, x, y, radius_m + 300.0)
        values = _disk_values(grid, grid.data, x, y, radius_m)
        if name == "slope_deg":
            out["slope_lola_deg"] = _slope_stats(values)
        else:
            out[name] = {"site": float(grid.sample(x, y)),
                         "median": float(np.median(values)), "max": float(values.max())}
    return out


def psr_access(lat, lon, search_radius_m=20_000.0, near=None):
    """Nearest permanently shadowed region (PSR) and the way to it.

    The PSR map is averaged to 60 m, so patches smaller than about one such
    pixel are ignored. Returns None outside the map (north of ~80S), else a
    dict with the straight-line distance and bearing to the nearest PSR and
    the slope met along that line (derived from the 60 m height grid).
    """
    x, y = latlon_to_xy(lat, lon)
    x, y = float(x), float(y)
    if max(abs(x), abs(y)) + search_radius_m > PSR_COVERAGE_M:
        return None
    grid = read_window("psr", x, y, search_radius_m, decimation=3)
    rows, cols = grid.data.shape
    xs = grid.x0 + (np.arange(cols) + 0.5) * grid.pixel_m
    ys = grid.y0 - (np.arange(rows) + 0.5) * grid.pixel_m
    dist = np.hypot(xs[None, :] - x, ys[:, None] - y)
    shadowed = np.nan_to_num(grid.data) > 0.5
    out = {
        "search_radius_m": search_radius_m,
        "site_in_psr": bool(shadowed.flat[dist.argmin()]),
        "psr_area_pct_within_5km": float(100.0 * shadowed[dist <= 5000.0].mean()),
    }
    candidates = shadowed & (dist <= search_radius_m)
    if not candidates.any():
        out["nearest_distance_m"] = None
        return out
    masked = np.where(candidates, dist, np.inf)
    r, c = np.unravel_index(masked.argmin(), masked.shape)
    px, py = xs[c], ys[r]
    out["nearest_distance_m"] = float(masked[r, c])
    # Bearing clockwise from north; in this projection north points away from the pole.
    north = np.array([x, y]) / np.hypot(x, y)
    east = np.array([north[1], -north[0]])
    step = np.array([px - x, py - y])
    out["bearing_deg"] = float(np.degrees(np.arctan2(step @ east, step @ north)) % 360.0)

    if near is None:
        near = read_window("height_m", x, y, search_radius_m + 300.0)
    slope = Grid(slope_from_heights(near), near.x0, near.y0, near.pixel_m)
    t = np.linspace(0.0, 1.0, max(2, int(out["nearest_distance_m"] / 30.0)))
    along = slope.sample(x + t * (px - x), y + t * (py - y))
    out["path_slope_deg"] = {"mean": float(np.nanmean(along)), "max": float(np.nanmax(along))}
    return out


def _slope_stats(values):
    return {
        "median": float(np.median(values)),
        "p95": float(np.percentile(values, 95)),
        "max": float(values.max()),
        "pct_below_5deg": float(100.0 * np.mean(values < 5.0)),
        "pct_below_10deg": float(100.0 * np.mean(values < 10.0)),
    }


# -------------------------------------------------------------------- I/O
def save_horizon(path, site, horizon, surface=None):
    doc = {
        "site": site,
        "source": "LOLA " + PRODUCTS["height_m"] + " (pgda.gsfc.nasa.gov/products/90)",
        "ground_height_m": round(horizon["ground_height_m"], 2),
        "mast_m": horizon["mast_m"],
        "azimuth_step_deg": float(horizon["azimuth_deg"][1] - horizon["azimuth_deg"][0]),
        "horizon_deg": [round(float(v), 4) for v in horizon["horizon_deg"]],
        "horizon_range_km": [round(float(v), 2) for v in horizon["horizon_range_km"]],
    }
    if surface is not None:
        doc["surface"] = _rounded(surface)
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")


def load_horizon(path):
    with open(path) as f:
        doc = json.load(f)
    step = doc["azimuth_step_deg"]
    return {
        "ground_height_m": doc["ground_height_m"],
        "mast_m": doc["mast_m"],
        "azimuth_deg": np.arange(len(doc["horizon_deg"])) * step,
        "horizon_deg": np.array(doc["horizon_deg"]),
        "horizon_range_km": np.array(doc["horizon_range_km"]),
    }


def _rounded(obj):
    if isinstance(obj, dict):
        return {k: _rounded(v) for k, v in obj.items()}
    if isinstance(obj, float):
        return round(obj, 3)
    return obj
