# NASA Space Apps 2026 – Lunar South Pole Landing Site Comparison Tool

This file carries the project context. Claude Code reads it automatically when opened in this folder.
User: Kerem (Yıldız Technical University, Mathematical Engineering). Hackathon weekend: 14–15 November 2026.
Conversation language with the user is Turkish; code, comments, documentation, variables and
commit messages are in English (they are shared with the jury). This standard applies to every
new file and change until the end of the project: jury-ready English, no Turkish in code,
comments, CLI output or docs.

## Challenge (summary)

An intuitive tool for mission planners, educators and the public to quickly compare lunar
landing sites and dates. For a selected site + date it should show the position of the Sun and
Earth relative to the horizon, and assess power generation (solar) and direct-to-Earth
communication windows. Existing tools (QuickMap, Moon Trek, JPL Horizons) are powerful but hard
to use for fast scenario comparison. The core value: answering "the mission slipped — what
happens if the date/site changes?" at a glance.

Optional goals: preset site list + custom coordinates, side-by-side comparison, date/time
navigation, time remaining until sunset / Earthset, solar elevation angle, timeline animation,
different user levels.

Challenge hints and how we cover them: ephemeris (Skyfield + DE421, validated against
Horizons, precomputed CSVs) ✔; LOLA topography for horizons ✔ (surface *visualization* not yet);
no atmosphere → horizon from terrain + limb of the sphere, no refraction ✔; solar elevation
computed ✔ but must be shown prominently in the UI.

## Status at handover (2026-11-14, ~12:00 local)

The whole computation backend works end to end for five sites over one year
(2026-12-01 → 2027-12-01, hourly). **No UI yet** (see "Frontend status" below for the current state of `web/`). A git repository
exists since 2026-11-14 (branch `main`, no commit yet).

**Moving to another computer:** copy the project folder including `data/` (results are
precomputed there; `data/lola/` can be skipped, see below). Then:

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python lunar_sky.py sites
```

`kernels/` (19 MB) is re-downloaded automatically by Skyfield on first `compute`/`dsn` if missing.

On Windows a `.venv` copied from macOS does not work; delete it and recreate it (the pinned
requirements resolve to Windows wheels on Python 3.13, checked with a pip dry run only):

```
python -m venv .venv; .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python lunar_sky.py sites
```

**LOLA DEM download is incomplete.** `data/lola/LDEM_60S_60MPP_ADJ.TIF.part` was at 1.23 GB of
3,089,110,093 bytes; the PGDA server throttles (~0.1 MB/s), drops connections and returns 503
at times. Everything so far was computed by reading windows remotely, so the local file is an
optimization, not a requirement. To resume on any machine (keeps progress across drops; do
NOT use curl's `--retry` with `-C -`, it discards progress):

```
cd data/lola; f=LDEM_60S_60MPP_ADJ.TIF
until [ "$(stat -f%z $f.part 2>/dev/null)" = 3089110093 ]; do
  curl -sS -f -L -C - -o $f.part https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/$f; sleep 20; done
mv $f.part $f
```

A file placed at `data/lola/<exact product name>` is used automatically; never leave a partial
file under the final name (the code would try to read it). After the download completes,
verify once that the local horizon equals the stored (remote-derived) one.

## Custom coordinates and nearby alternatives (plan, 2026-11-14)

Proposed from the frontend side on 2026-11-14. **The backend owner should confirm the contracts
below before anyone builds on them.**

**Goal.** The user clicks any point in the south polar region and gets the same assessment as
for a built-in site, plus two kinds of suggestion: a better landing date close in time, and a
better spot close in space ("320 m north-east: usable Sun 81 % → 96 %").

**Why this needs one API endpoint.** The computation core already works for any coordinate
(`--lat/--lon` on every command). What was missing is a way for the UI to trigger it, because
the terrain horizon of a new point needs the 3 GB DEM. Everything else can run in the browser:

- Sky is site independent: one hourly table of Sun and Earth position vectors serves every
  coordinate on the Moon. Its size grows with the date range, not with the number of sites.
- Terrain is date independent: per point it reduces to the horizon profile (720 values).
- The risk model needs only Sun/Earth az/alt, the horizon profile and the DSN table
  (`lunar_risk.build_series`), so it is ported to TypeScript and runs in the browser. The port
  is validated against the existing `risk_<site>.json` files (default profile: all 352 `scan`
  rows per site must match).

The API therefore has a single job: return horizon profiles for coordinates that have no
precomputed file. Dates, duration, battery limits, scans and comparisons never hit the server.

**Flow after a click**

1. Immediately: sphere-model result from the vectors table, labelled as "no terrain yet".
2. `GET /horizon` for the point (`grid=1`), then the browser recomputes with terrain and shows
   the same panels as for a built-in site. Nearby-date suggestions come from the browser's own
   landing-date scan at this moment.
3. `GET /horizon` for the neighbourhood (`grid=5`), then the browser scores every neighbour for
   the selected mission window and suggests the best one.
4. If the API fails or the point is outside the DEM, the point stays on the sphere model and
   the UI says so.

**Contracts**

| Item | Shape |
|---|---|
| `data/ephemeris_vectors.csv` (new) | `utc, sun_x_km, sun_y_km, sun_z_km, earth_x_km, earth_y_km, earth_z_km`: apparent position of the Sun and Earth centers relative to the Moon's center in `MOON_ME_DE421`, hourly. The browser subtracts the site vector and projects on the local horizontal frame; the result must match `skyfield_<site>.csv` (target: within 0.01°). Replaces the per-site CSVs as UI input. |
| `data/dsn_moon.csv` | unchanged columns, extended to the same date range |
| `GET /horizon?lat=&lon=&mast=2&grid=1&step=125` | `{"points": [...]}`, center first. Each point: `lat`, `lon`, `east_m`, `north_m`, `ground_height_m`, `mast_m`, `azimuth_step_deg`, `horizon_deg` (same meaning as in `horizon_<site>.json`) and `slope_deg` (local slope derived from the DEM; a 1000 m ellipse would be nearly identical for neighbours 125 m apart). `grid=N` returns an N×N square with `step` meters between points. HTTP 422 outside the DEM coverage. CORS must allow the web origin. |
| `data/grid_<site>.json` (new) | the same response, precomputed for each built-in site, so built-in sites never need the API |

Date range of the vectors and DSN tables: 2026-12-01 → 2030-12-31 for now (about 0.9 MB as
Float32); the kernels allow anything up to 2050. The range must stay easy to change: the
backend sets it with `--start/--days`, and the UI never hard-codes it (the date picker takes
its limits from the first and last row of the table).

File formats: the backend keeps writing CSV for the large hourly tables; a build script in
`web/` converts them to binary arrays for the browser. Small per-point files (horizons,
grids, API responses) are JSON.

**Search area for nearby spots (agreed 2026-11-14).** A ±500 m square around the point:

| Case | Grid | Step | Reason |
|---|---|---|---|
| Built-in sites, precomputed `grid_<site>.json` | 9×9 (81 points) | 125 m | no time limit offline |
| Custom point, live API | 5×5 (25 points) | 250 m | about 2.4 s of computation |

Steps below about 100 m add nothing (60 m DEM pixels). Anything farther than 500 m is a
different site: the user clicks there, or clicks the suggested point to search again from it.
Neighbours are scored for the selected mission window and shown as a small heat map.

**Landing precision (agreed 2026-11-14).** New mission-profile parameter, default 100 m
(placeholder, to be confirmed). It is the radius in which slope is evaluated for the surface
score, replacing the fixed 1000 m ellipse when comparing neighbours: circles of 1000 m around
points 125 m apart overlap by more than 90 %, so they cannot tell neighbours apart, and a
nearby-spot suggestion only makes sense when the lander can hit a spot that precisely.
Slope source (derived from LDEM vs. LDSM) is open: the backend owner decides after trying
both. Deriving from LDEM would let the API host a single file.

**Timing** (measured on the Windows development machine with numpy 2.5.4, using synthetic
windows of the real sizes, 833² near and 2083² far; the cost does not depend on height values)

| Step | Time |
|---|---|
| Horizon, one point, windows already in memory | 0.09 s |
| Horizon, 5×5 grid (25 points), same windows | 2.4 s |
| Horizon, 9×9 grid (81 points) | 7.7 s |
| Risk for one point, one year (per-sample state + scan of 352 landing dates), Python | 0.05 s |

Not measured: reading the two windows from a local DEM (expected around a second if the file
has overviews; measure once the download is complete), a slower hosted CPU, network time, and
a cold start of the host. Remote window reads are the known slow path (~50 s per site for all
products). Design consequences: read the windows once per request and reuse them for every
grid point (`compute_horizon(..., near=, far=)` already allows it; read `near` a little wider
than the grid), keep `grid` at 5 or less for interactive use, and request the center before
the neighbourhood so the first terrain result is not delayed by the grid.

**Hosting.** Candidate: Hugging Face Spaces with Docker (FastAPI). The DEM is uploaded once
(for example as a dataset) and fetched at container start; only `LDEM_60S_60MPP_ADJ.TIF` is
needed because slope is derived from it. A sleeping container has a long cold start, so wake
it before a demo or recording. Fallback: run the API on a laptop for the demo video; the
deployed site keeps working with built-in sites and the sphere model.

**Deployment layout (agreed 2026-11-14).** One public GitHub repository: `web/` (Vite + React
+ TypeScript, deployed by Vercel as static files, no Docker), `api/` (FastAPI + Dockerfile,
deployed to the Space), the `lunar_*.py` core and `data/` at the root; `data/lola/`,
`kernels/` and `.venv` are git-ignored. Frontend and API are deployed separately so the site
stays up when the API sleeps or fails.

**Saved custom points.** The user can name and save a custom coordinate; it is stored in the
browser (`localStorage`: name, lat, lon, horizon profile), shown on the map next to the
built-in sites and selectable in comparisons. Site, date and profile are also written to the
URL so a scenario can be shared as a link. No accounts, no server-side storage.

**Caching (agreed: both sides).** A horizon never changes for a given coordinate. Browser:
the horizon of a saved point is kept with the point; grid responses stay in IndexedDB or in
memory. Server: coordinates are snapped to the 60 m DEM pixel grid and responses carry
`Cache-Control`, so nearby clicks and repeat visits reuse the same answer.

**Keeping the API awake (agreed).** The UI calls `GET /health` on page load and shows the
terrain-service status; a scheduled job (for example GitHub Actions cron) calls `/health`
regularly. Check the host's sleep policy and terms when setting this up.

**API protection.** In order of importance: parameter limits (`grid` ≤ 5, validated `step`
and coordinate range), a concurrency cap of about 2 running computations (queue or HTTP 429),
optionally a per-IP rate limit. The static site needs none; the UI sends one request at a
time and cancels the previous one on a new click.

**Limits to state in the UI.** Terrain only for 60°S–pole (DEM coverage); 60 m pixels, so
suggestions finer than about 100 m are meaningless; a custom point without API answer is
sphere-only.

## Frontend status (end of the 2026-11-14 session)

**The visual design is deliberately blank.** A first UI was built and then deleted at the
frontend developer's request because they did not like the design. They will give a new design
prompt in a new chat. Until then do not invent a visual design or layout, and do not recreate
the deleted one; wait for the prompt. Everything below that is not visual is kept and verified.

What exists in `web/` (Vite + React + TypeScript, Node 24, no UI library):

| File | Role |
|---|---|
| `scripts/build-data.mjs` | Converts `../data` into `public/data/` (git-ignored, regenerated by `npm run data`, runs automatically before `dev` and `build`): `sky_<site>.bin` (Int32 columns sun az/alt, earth az/alt, degrees × 1e5), `dsn.bin` (Int32, degrees × 1e3), minified `horizon_<site>.json`, `manifest.json` (start, step, count, scales, site list). The date range and the site list come from the files, never from code. About 0.85 MB in total. |
| `src/data/load.ts` | `loadDataset()` fetches the manifest and binaries and returns per-site `SkySeries`, `Horizon`, ground height, LOLA slope p95 and radius, plus the highest DSN Moon elevation per sample (`stationMaxAlt`). Asset URLs use `import.meta.env.BASE_URL`. |
| `src/engine/risk.ts` | TypeScript port of `lunar_risk.py`: `buildSeries`, `analyzeWindow`, `scoreWindow`, `scanLandingDates`, `horizonAt`, `DEFAULT_PROFILE`. All risk computation runs in the browser and takes a few milliseconds per site and year. |
| `scripts/validate-engine.ts` | Compares the engine with `data/risk_<site>.json` for every site: the mission window, the five slip windows and all 352 landing-date scan rows, within the backend's 3-decimal rounding. Run with `npm run validate`. **Result on 2026-11-14: identical for all five sites.** Re-run it after any change to `risk.ts`. |
| `src/App.tsx`, `src/index.css` | Empty placeholder and a minimal reset (the deleted design). |

Commands: `cd web`, `npm run dev`, `npm run build`, `npm run validate`.

Not built yet: everything visual and interactive (horizon panorama with Sun and Earth, time
slider and animation, status cards with elevation and time to sunset / Earthset, risk card,
slip table, landing-date calendar, side-by-side comparison, map, saved custom points, nearby
dates and spots), the landing-precision profile parameter, the `ephemeris_vectors.csv` based
sky calculation in the browser, and the `api/` folder (FastAPI + Dockerfile).

State of the agreements: the API, the contracts and the search area above are proposals the
backend owner has not confirmed yet; the frontend works for the five built-in sites without
any of them. Nothing has been committed or pushed. The Windows machine has no `.venv` yet;
the system Python 3.13 has numpy but not rasterio, so the Python tools that read the DEM do not
run there until the requirements are installed.

## Moon map (decided 2026-11-14: try A first, fall back to B)

The UI needs a zoomable map of the south polar region with site pins, saved custom points,
click-to-select and the nearby-spot heat map. Library in both paths: Leaflet. Overlays are
ordinary Leaflet layers and do not depend on where the tiles come from.

**Path A, try first: NASA Moon Trek tiles.** Moon Trek is a challenge resource and offers a
WMTS tile API with a "South Pole" service column:
https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon . General tile URL pattern:
`https://{WMTS endpoint}/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`
(some layers are `.jpg`; the `ResourceURL` in each layer's `WMTSCapabilities.xml` says which).
Not verified yet: which south pole layers exist, their projection, tile matrix set and maximum
zoom. The layer list on that page loads dynamically, so open it in a browser and read a
layer's capabilities document first. Expected extra work: registering the polar projection in
Leaflet (`proj4leaflet`) and converting between map coordinates and the LOLA grid used by the
terrain code. Risks: dependency on a NASA server during the demo; projection mismatch.
Give this about half an hour; if tiles do not load or the projection fights back, switch to B.

**Path B, fallback: our own tiles.** The backend owner renders a hillshade of 60°S–pole from
the LOLA products (the ready-made `_HILL` file on the PGDA page, or derived from the DEM) and
cuts it into a 256 px tile pyramid with `gdal2tiles` (raster profile). The tiles are served as
static files with the site; Leaflet uses `CRS.Simple`. A clicked pixel then maps directly to
the DEM's polar stereographic x/y (port `latlon_to_xy` / `xy_to_latlon` from
`lunar_terrain.py`), and nothing depends on an external server. Cost: an hour or two of
backend time and hosting the tiles (size not measured; keep them out of git as a build
artifact). A single image is not enough: 60°S–pole is about 1900 km wide, so the 1 km search
area around a site would be a few pixels.

Not suitable as the working map: QuickMap (no embeddable tile service known to us; fine for
manual checks) and a 3D globe (poor polar texture, hard click-to-coordinate mapping; at most
a decorative overview).

## Code map

All Python, run through the single CLI `lunar_sky.py`. Setup: `pip install -r requirements.txt`
(skyfield 1.55, requests, rasterio 1.4.4, numpy 2.4.6).

| File | Role |
|---|---|
| `lunar_sky.py` | CLI + Skyfield geometry + Horizons client + DSN station table |
| `lunar_metrics.py` | Rise/set events, visibility windows, summaries (stdlib only) |
| `lunar_terrain.py` | LOLA windows (local or remote COG), terrain horizon, slope, PSR access |
| `lunar_risk.py` | Per-sample power/comm state, mission-window indicators, risk score, date scan |

```
python lunar_sky.py sites                                   # list built-in sites
python lunar_sky.py compute  --site malapert_a --start 2026-12-01 --days 365
python lunar_sky.py horizons --site malapert_a --start 2026-12-01 --days 30   # JPL Horizons table
python lunar_sky.py compare  --site malapert_a               # Skyfield vs Horizons
python lunar_sky.py metrics  --site malapert_a --at 2026-12-10T12:00   # ideal sphere; --mask 2 (deg)
python lunar_sky.py horizon  --site malapert_a               # terrain horizon + surface (--mast 2 --ellipse 1000)
python lunar_sky.py metrics  --site malapert_a --terrain     # uses data/horizon_<site>.json
python lunar_sky.py dsn      --start 2026-12-01 --days 365   # Moon elevation at Goldstone/Madrid/Canberra
python lunar_sky.py risk     --site malapert_a --landing 2026-12-16 --duration 14
python lunar_sky.py mast     --site malapert_a --masts 2,5,10
# custom point: --lat -85 --lon 30 --site custom85   step: --step 60 (min)
# risk profile overrides: --battery-hours 50 --max-outage-hours 24 --max-slope 10 --mask 0 --sphere
```

Outputs in `data/` (the UI reads these; the only live call is `/horizon` for custom
coordinates, see "Custom coordinates and nearby alternatives"):

| File | Content |
|---|---|
| `skyfield_<site>.csv` | `utc, sun_az_deg, sun_alt_deg, earth_az_deg, earth_alt_deg` (hourly, 1 year) |
| `horizons_<site>.csv` | same columns from JPL Horizons (validation, December 2026 only) |
| `metrics_<site>.json`, `metrics_<site>_terrain.json` | per track `sun`/`earth`/`both`: `summary`, `events`, `windows` (+ `status` with `--at`) |
| `horizon_<site>.json` | `horizon_deg` and `horizon_range_km` per azimuth (0.5° step), `ground_height_m`, `surface` (slope stats from LOLA LDSM and derived from DEM, `height_error_m`, `effective_resolution_m`, `psr`) |
| `dsn_moon.csv` | `utc, goldstone_alt_deg, madrid_alt_deg, canberra_alt_deg` (site independent) |
| `risk_<site>.json` | `profile`, `window` (power + comm indicators), `score`, `slips` (0/+7/+14/+21/+28 d), `scan` (every landing date) |
| `mast_<site>.json` | Sun/Earth visibility for several mast heights |

### Conventions

- Frame `MOON_ME_DE421`; longitude east-positive; time UTC; azimuth clockwise from north
  (same as Horizons). Elevations in `compute` are of the disk CENTER relative to the local
  horizontal plane of the 1737.4 km sphere. No refraction anywhere.
- Disk radii from the Moon: Sun 0.27°, Earth 0.95°. A body is "visible" while its upper limb
  is above the horizon in its direction: `alt + radius > horizon(az) + mask`
  (sphere model: horizon = −dip of `--height`).
- Horizons request: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`,
  `SITE_COORD='east_longitude,latitude,km'`, `QUANTITIES='4'`, `APPARENT='AIRLESS'`,
  `ANG_FORMAT='DEG'`, `CSV_FORMAT='YES'`, `STEP_SIZE='60m'` (no space). Sun=10, Earth=399.
- Skyfield `Loader` resolves kernel names inside `kernels/`; pass bare file names.

### Terrain (`lunar_terrain.py`)

- Data: "A New View of the Lunar South Pole from LOLA" (Barker et al.),
  https://pgda.gsfc.nasa.gov/products/90 — cloud-optimized GeoTIFFs, south polar stereographic
  (true scale at pole, R = 1737.4 km, +y toward lon 0), float32 meters, NaN nodata.
  Used: `LDEM_60S_60MPP_ADJ.TIF` (height), `LDSM_…` (slope), `…_ERR` (height error),
  `…_EFFRES` (effective resolution), `LPSR_80S_20MPP_ADJ.TIF` (PSR mask, 1 = shadowed).
  Local file in `data/lola/` if present, else `/vsicurl/` range reads (~50 s per site).
  `LUNAR_TERRAIN_REMOTE=1` forces remote. Projection formulas checked against PROJ.
- Horizon: 720 azimuths; rays sampled every 60 m to 20 km on the full-resolution window, then
  on the 240 m overview out to 250 km with steps growing 0.2 % of range; elevation of each
  terrain point computed with lunar curvature from an observer `--mast` m above ground. The
  limb of the sphere is therefore included (negative horizons on high ground).
- Slope derived from the 60 m DEM agrees with LOLA LDSM within ~0.1° (median) at all sites.
- PSR access: nearest PSR pixel (map averaged to 60 m) within 20 km, bearing, slope along
  the straight line. Map covers 80°S–pole only.

### Risk model (`lunar_risk.py`)

Per sample: `solar_fraction` = visible share of the Sun's disk after terrain AND after the
Earth's disk (Earth-caused eclipse, circle overlap); `comm` = Earth's upper limb clears
terrain AND some DSN complex has the Moon above 10° AND Sun–Earth separation ≥ 2° (solar
conjunction); `low_elevation` = Earth center < 2° above terrain (degraded, not an outage).
Window indicators: usable-Sun %, longest darkness, grazing-Sun hours, Earth-eclipse hours,
link %, longest outage, hours lost to terrain / station gap / conjunction.

Score per category, 0–100: 0 while at most half of a limit is used, 100 at the limit.
Power = worse of (longest darkness vs battery) and (usable-Sun shortfall); comm likewise;
surface = 95th-percentile slope within the ellipse vs slope limit. Overall = worst category.
<33 low, <66 medium. `DEFAULT_PROFILE` values (14-day mission, 50 h battery, 24 h max outage,
10° slope, 50 % minimum Sun/comm) are **placeholder assumptions** — the team must choose a
mission profile.

Covered risk items: terrain eclipse, continuous darkness/battery, eclipse by Earth, grazing
Sun/partial disk, Earth occultation, solar RF conjunction, low-elevation multipath indicator,
DSN visibility gap, slope/tip-over, mast-height sensitivity, PSR access.
Deliberately out of scope (say so in the presentation): approach-corridor clearance, lobate
scarp seismicity/landslides, electrostatic dust, crater-wall IR reradiation, solar particle
events.

## Built-in sites (coordinates are APPROXIMATE, confirm before use)

| key | Name | Latitude | Longitude |
|---|---|---|---|
| shackleton | Shackleton crater center (floor) | -89.67 | 129.78 |
| connecting_ridge | Shackleton–de Gerlache ridge (high-illumination point, Mazarico 2011) | -89.45 | 222.69 |
| malapert_a | Malapert A / IM-1 Odysseus | -80.13 | 1.44 |
| mons_mouton | Mons Mouton / IM-2 region | -84.79 | 29.20 |
| chandrayaan3 | Chandrayaan-3 (Shiv Shakti) | -69.37 | 32.32 |
| apollo11 | Apollo 11 (for contrast; outside the DEM, sphere only, no data files yet) | 0.674 | 23.473 |

Coordinate check, 2026-11-14 (web sources): Shackleton matches the IAU Gazetteer (−89.67,
129.78); Malapert A matches the NASA/LROC IM-1 release (80.13°S, 1.44°E, 2579 m); Mons Mouton
matches the IM-2 landing point (84.7906°S, 29.1957°E, secondary source); Chandrayaan-3 matches
Statio Shiv Shakti (69.373°S, 32.319°E). **Connecting ridge is not confirmed:** the Mazarico
2011 table could not be read, and one secondary source quotes 229.69°E instead of 222.69°E
(about 2 km apart). Check the paper. Apollo 11 was not checked.

## Results so far

### Validation

- Skyfield vs Horizons, Shackleton / Malapert A / Mons Mouton, December 2026, hourly (721
  points), Sun + Earth: max |difference| ≤ 0.00002° in all four columns.
- Shackleton floor is permanently shadowed (horizon 20–24° all around) and inside a PSR.
- Malapert A ground height +2592 m matches IM-1's reported landing elevation (~2.6 km).
- Connecting ridge: 82.7 % Sun at 2 m, 95.7 % at 10 m — in line with Mazarico 2011
  (~86 % / ~92 %, quoted from memory; confirm in the paper).
- Earth-caused eclipse found on 2027-08-17 (max 53 % of the disk), the date of a penumbral
  lunar eclipse.
- **Not validated:** rise/set event times against Horizons; local-file vs remote horizon.

### One year from 2026-12-01, terrain vs ideal sphere (observer 2 m above ground)

| Site | Model | Sun visible | Longest dark | Earth visible | Longest Earth outage |
|---|---|---|---|---|---|
| Shackleton (floor) | sphere | 56.0% | 160 d | 49.8% | 13.7 d |
| | terrain | 0% | permanent | 0% | permanent |
| Connecting ridge | sphere | 57.3% | 137 d | 48.9% | 14.0 d |
| | terrain | 82.7% | 9.7 d | 50.0% | 13.6 d |
| Mons Mouton | sphere | 50.3% | 17.0 d | 78.8% | 6.0 d |
| | terrain | 45.6% | 17.1 d | 92.8% | 3.2 d |
| Malapert A | sphere | 49.9% | 15.9 d | 100% | none |
| | terrain | 39.0% | 18.8 d | 100% | none |
| Chandrayaan-3 | sphere | 49.0% | 15.3 d | 100% | none |
| | terrain | 46.9% | 15.9 d | 100% | none |

### 14-day mission landing 2026-12-16 (default profile, terrain, DSN)

| Site | Usable Sun | Longest dark | Link | Longest outage | Slope p95 | Risk (power/comm/surface) | Low-risk landing dates per year |
|---|---|---|---|---|---|---|---|
| Connecting ridge | 100% | 0 h | 83.3% | 2.3 d | 15.1° | 0 / 100 / 100 | 0 of 352 |
| Mons Mouton | 100% | 0 h | 99.7% | 1 h | 5.9° | 0 / 0 / 18 → low | 22 |
| Malapert A | 81.0% | 2.6 d | 99.7% | 1 h | 15.9° | 100 / 0 / 100 | 0 |
| Chandrayaan-3 | 89.9% | 32 h | 99.7% | 1 h | 3.2° | 28 / 0 / 0 → low | 37 |
| Shackleton floor | 0% | 14 d | 0% | 14 d | 9.4° | 100 / 100 / 87 | 0 |

Slip example (Mons Mouton): +0 d risk 18; +7 d Sun 51 %, 6.6 d dark → 100; +14 d Sun 1 % →
100; +28 d back to 18. This is the natural demo story.

Mast height (2 → 10 m), Sun visible over the year: connecting ridge 82.7 → 95.7 % (longest
dark 9.7 → 3.1 d); Mons Mouton 45.6 → 46.6 %; Malapert A 39.0 → 40.1 %.

PSR access: connecting ridge 0.80 km (max slope on the way 7.7°); Mons Mouton 0.83 km
(11.6°); Malapert A and Chandrayaan-3 are outside the PSR map.

Terrain sensitivity (hypothetical uniform horizon, one year): each 1° of horizon costs
~24 points of sunlit time at 89.7°S, ~7 at 85°S, ~3 at 80°S, ~2 at 73°S.

## Physics / geometry notes

- The Moon's axis is tilted ~1.5° to the ecliptic → at the pole the Sun stays within about
  ±1.5° of the horizon; a small hill can cast a shadow for days; polar "winter" gives a
  ~140–160 day dark season on an ideal sphere.
- Latitude libration ~±6.7° → at the pole the Earth dips below and rises above the horizon
  with a ~27-day period.
- Horizon dip ≈ arccos(R / (R+h)), R = 1737.4 km. 1 km of height ≈ 2° of dip.
- Periods: synodic month 29.5 d, draconic month 27.2 d, lunar "season" ~346 d.

## Decisions made

1. **Computation core: Skyfield, locally.** Validation against JPL Horizons.
2. **Heavy computation is done ahead of time**; the UI reads CSV/JSON from `data/`.
   Amended 2026-11-14 (pending backend confirmation): one exception, the terrain horizon of a
   custom coordinate, served by a single-endpoint API. The risk model runs in the browser. No
   other computation moves to a server.
3. **Terrain: LOLA 60 m (60°S–pole), two-resolution horizon.** Slope derived from the DEM is
   sufficient; LDSM is used where reachable. Finer DEMs (30/20/10/5 m) exist on the same page
   if a near-field refinement is wanted for Shackleton-area sites.
4. Moon Trek / QuickMap have no computation API: basemap tiles and visual checks only. The
   `_HILL` (hillshade) LOLA files are a good offline basemap.
5. README for the jury is deferred to the end (step 6 below); CLAUDE.md is internal.
6. Open (team): target user, UI technology, task split, mission profile for the risk score,
   the single demo story.

## Limitations

- Site coordinates are approximate; near the pole results change strongly within ~1 km.
- Hourly sampling: events are accurate to minutes by interpolation in `metrics`, but `risk`
  counts whole samples (durations in 1 h units; DSN gaps shorter than 1 h are missed).
- Power uses the visible solar-disk fraction only (no panel orientation, no thermal model).
- Communication assumes the three DSN complexes with a 10° mask; Earth's partial visibility
  is treated as visible.
- Risk limits are placeholders; the score is a transparent heuristic, not a certified metric.
- Custom coordinates get terrain only inside the DEM (60°S–pole) and only while the horizon
  API answers; otherwise they are sphere-only.

## Next steps (in priority order)

Backend and frontend run in parallel; the frontend needs nothing new for built-in sites.

1. Backend: `data/ephemeris_vectors.csv` and `dsn_moon.csv` over the agreed date range. This
   unblocks custom coordinates and longer date ranges in the UI.
2. Backend: grid horizon function (windows read once, reused for all points) and the
   `/horizon` API around it; measure the window read time on the local DEM and verify that
   the local horizon equals the stored remote-derived one.
3. Backend: `data/grid_<site>.json` for the built-in sites (run the function from step 2).
   The grid no longer has to wait for the local DEM: one remote window read per site is enough.
4. Frontend: UI reading `data/`: TypeScript port of the risk model validated against
   `risk_<site>.json`, horizon panorama with Sun and Earth, status cards (elevation, time to
   sunset / Earthset), risk card per category, slip table, landing-date scan as a calendar
   strip for all sites, side-by-side comparison, then custom coordinates and the
   nearby-date / nearby-spot suggestions.
5. Team: default mission profile (now adjustable in the UI, so only defaults are needed), the
   demo story, the date range, and the connecting ridge longitude.
6. Validate event times against Horizons; optionally 10-minute step; uncertainty from `_ERR`.
7. Last 5–6 hours: no new features; bug fixing, demo story, presentation, submission, and
   the jury-facing English `README.md`.

## References

- Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- Horizons manual: https://ssd.jpl.nasa.gov/horizons/manual.html
- Skyfield planetary frames (lunar surface example): https://rhodesmill.org/skyfield/planetary.html
- NAIF generic kernels: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- LOLA south pole products (PGDA): https://pgda.gsfc.nasa.gov/products/90
- Moon Trek: https://trek.nasa.gov/moon/
- LROC QuickMap: https://quickmap.lroc.asu.edu/
- Reference paper: Mazarico et al. 2011, polar illumination conditions from LOLA (Icarus)
