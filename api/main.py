"""Terrain service: horizon profiles for coordinates that have no precomputed file.

The web client computes everything else itself (Sun/Earth angles from the
vectors table, the risk model, date scans). This service has one job:

  GET /health    service status and which terrain files are in use
  GET /horizon   terrain horizon and slope for a point or a square of points

Run locally from the repository root:

  pip install -r api/requirements.txt
  uvicorn api.main:app --port 8000

Settings (environment variables):
  LUNAR_TERRAIN_DIR     directory with the LOLA files (default: data/lola in the repository)
  LUNAR_TERRAIN_URL     where files without a local copy are read from by range requests
                        (default: the PGDA server; a faster mirror can be given)
  LUNAR_TERRAIN_REMOTE_SLOPE  set to 1 when that source also holds the slope map
                        (LDSM_60S_60MPP_ADJ.TIF); otherwise slope is derived from the heights
  LUNARIS_CORS_ORIGINS  comma-separated list of allowed web origins (default: *)
  LUNARIS_MAX_JOBS      horizon computations allowed at the same time (default: 2); further
                        requests wait for a free slot, answers already cached never wait
  LUNARIS_JOB_WAIT_S    how long a request waits for a slot before HTTP 429 (default: 30)
"""
import os
import sys
import threading
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("LUNAR_TERRAIN_DIR", os.path.join(ROOT, "data", "lola"))

from fastapi import FastAPI, HTTPException, Query, Response  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

import lunar_terrain as lt  # noqa: E402

MAX_GRID = 5
MAX_JOBS = int(os.environ.get("LUNARIS_MAX_JOBS", "2"))
JOB_WAIT_S = float(os.environ.get("LUNARIS_JOB_WAIT_S", "30"))
CACHE_SIZE = 256
# A horizon never changes for a given coordinate, so answers can be cached for good.
CACHE_HEADER = "public, max-age=31536000, immutable"

app = FastAPI(title="Lunaris terrain service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("LUNARIS_CORS_ORIGINS", "*").split(",")],
    allow_methods=["GET"],
    allow_headers=["*"],
)
_jobs = threading.BoundedSemaphore(MAX_JOBS)
_cache = OrderedDict()  # request key -> JSON body, least recently used first
_cache_lock = threading.Lock()


def _cached(key):
    with _cache_lock:
        body = _cache.get(key)
        if body is not None:
            _cache.move_to_end(key)
        return body


def _store(key, body):
    with _cache_lock:
        _cache[key] = body
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _source(name):
    return "local" if lt.local_product(name) else "missing" if name in lt.LOCAL_ONLY else "remote"


@app.get("/health")
def health():
    """Cheap status call; the web client uses it to show whether terrain is available."""
    return {
        "status": "ok",
        "height": _source("height_m"),
        "slope": ("local slope map" if lt.local_product("slope_deg") else
                  "remote slope map" if lt.slope_map_available() else "derived from height"),
        "roughness": _source("roughness"),
        "max_grid": MAX_GRID,
        "max_jobs": MAX_JOBS,
        "coverage": "60S to the south pole",
    }


def _horizon_json(lat, lon, mast, grid, step, precision):
    return lt.grid_to_json(lt.compute_grid(lat, lon, n=grid, step_m=step, mast_m=mast,
                                           precision_m=precision))


@app.get("/horizon")
def horizon(
    lat: float = Query(..., ge=-90.0, le=90.0, description="latitude, degrees north"),
    lon: float = Query(..., ge=-360.0, le=360.0, description="longitude, degrees east"),
    mast: float = Query(2.0, ge=0.0, le=100.0, description="observer height above ground, m"),
    grid: int = Query(1, ge=1, le=MAX_GRID, description="points per side of the square (odd)"),
    step: float = Query(125.0, ge=60.0, le=1000.0, description="distance between points, m"),
    precision: float = Query(100.0, ge=30.0, le=2000.0,
                             description="landing precision: radius in which slope is judged, m"),
    snap: bool = Query(True, description="move the point to the nearest 60 m height pixel"),
):
    """Horizon profile and slope for `grid` x `grid` points, center first."""
    if grid % 2 == 0:
        raise HTTPException(422, "grid must be an odd number")
    if not lt.in_coverage(lat, lon):
        raise HTTPException(422, "outside terrain coverage (60S to the south pole)")
    if snap:
        lat, lon = lt.snap_to_pixel(lat, lon)
    key = (round(lat, 7), round(lon, 7), mast, grid, step, precision)
    body = _cached(key)
    if body is None:
        # Computations are CPU-heavy, so only MAX_JOBS run at once; the others wait their turn.
        if not _jobs.acquire(timeout=JOB_WAIT_S):
            raise HTTPException(429, "terrain service is busy; retry shortly",
                                headers={"Retry-After": "3"})
        try:
            body = _cached(key)  # an identical request may have finished while this one waited
            if body is None:
                body = _horizon_json(*key)
                _store(key, body)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        finally:
            _jobs.release()
    return Response(body, media_type="application/json", headers={"Cache-Control": CACHE_HEADER})
