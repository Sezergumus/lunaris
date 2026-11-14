# NASA Space Apps 2026 – Lunar South Pole Landing Site Comparison Tool

This file carries the project context. Claude Code reads it automatically when opened in this folder.
User: Kerem (Yıldız Technical University, Mathematical Engineering). Hackathon weekend: 14–15 November 2026.
Conversation language with the user is Turkish; code, comments, documentation, variables and
commit messages are in English (they are shared with the jury). This standard applies to every
new file and change until the end of the project: jury-ready English, no Turkish in code,
comments, CLI output or docs.

## Session handoff (read this first; keep it current)

**Rule for Claude:** this section replaces the chat history. A new chat, on either
developer's machine, must be able to continue from this file alone, without anyone
re-explaining anything. Update it without being asked whenever something changes that a fresh
session would need: at the end of each piece of work, after every decision, and when a new
pitfall is found. Keep it short; move details into the sections below and delete what is no
longer true. Say which side (backend / frontend) a note belongs to.

**The repository is the single source of truth** (https://github.com/Sezergumus/lunaris,
branch `main`), since 2026-11-14 ~15:00. Two people work here: Kerem (backend owner, macOS,
GitHub `KeremGull`, collaborator with push access) and Sezer (frontend, Windows, repository
owner). Both commit directly to `main`. Pull before starting; do not commit or push without
the user asking.

Kerem's Mac: the clone is `~/Desktop/lunaris` and is complete and self-sufficient: `.venv`
(from `requirements.txt`), `kernels/` and the full LOLA DEM
(`data/lola/LDEM_60S_60MPP_ADJ.TIF`, 2.9 GB) are in place, all git-ignored; every command
runs offline except the remote layers read by `horizon`. Open new chats in that folder. The
older folder `~/Desktop/Nasa Space App` is superseded (stale copies of code and results
only); never edit it.

**Never add Claude/AI attribution anywhere** (user instruction, overrides tool defaults): no
`Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line, in commits, pull
requests, code or docs.

**Where we are (2026-11-15, ~01:15 local):** everything is committed and pushed, the working
tree is clean, nothing is in progress. The terrain API was deployed after the work listed
here (see the block on the live API below). Work of the evening on Kerem's Mac, in order:
mission-profile presets, the Chandrayaan-3 backtest, the profile selector, the
horizon-uncertainty score, then:

1. Communication requirement: "link in 50 % of the mission" became "at least 8 h of contact
   in every 24 h" (profile key `min_daily_contact_h` replaces `min_comm_pct`; new indicator
   `comm.worst_day_contact_h`; both engines; `risk_*`, `ranking`, `nearby_*`, `backtest_*`
   regenerated; no score changed). See "Risk model".
2. Web only: a "Mission limits" card in the Mission parameters popover of the sites header
   (`web/src/panels/MissionParameters.tsx`, `web/src/panels/LimitsControl.tsx`,
   `web/src/state/limits.ts`) with five sliders: darkness survived, usable Sun needed,
   longest outage, contact per day, slope limit. A slider overrides the selected profile
   (`limitOverrides` in the scenario store; choosing a profile or "Reset" clears them); the
   risk badge, landing-date strip and comparison follow live; the values travel in the URL
   as `dark`, `sun`, `outage`, `contact`, `slope`. Checked in the browser on Malapert A
   (`dark=140&slope=20`: risk 100 -> 59; reset -> 100), not on a phone-sized screen. Mission
   length is not a slider (the timeline's 14 d / lunar day control owns the window).

The risk-card additions of the evening are visual changes in the frontend's area, made with
Kerem's approval; tell Sezer. Still open from Kerem's idea list: a battery state-of-charge
model as an extra indicator (not started; no sourced Wh / W numbers).

**Frontend, built after that (Sezer's machine, plan in `frontend-new-plan.md`, all committed):**

- `data/terrain.ts`: one `/horizon` request at a time (queue; a request whose caller aborted
  before it was sent is dropped; a sent one finishes and is cached; one retry after 1.5 s on
  429). Fixes the 429 on quick clicks against the 2-job limit.
- Mission length is free (1-60 d, presets 14 d / 30 d, URL `window=<hours>`) and **sets
  `profile.duration_days`** (`effectiveProfile(..., windowHours)` / `useEffectiveProfile` in
  `state/limits.ts`), so every score, scan and grid follows it. The slip is one field that
  sets B = A + N days (not additive); `slipDays` may be negative (URL `slip=-6`).
- Saved points (`state/savedPoints.ts`, localStorage, max 10, terrain stored with the point:
  no request when reopened); list + menu in `SitesPanel`, Save button in the inspector.
- Live risk of the five sites for the mission on screen (`state/siteScores.ts`, window-only
  scoring via `scorePlace` in `engine/grid.ts`): chip + "Best" in the list, level ring and
  score on the map pins. Nearby grid (`state/nearby.ts`): heat-map dots around scenario A on
  the map, and a "Suggestions" card (`panels/Recommendations.tsx`) with a better spot (vs
  the grid center, same rules) and a better landing date (from the landing-date scan).
  Custom points scan 5x5 / 250 m only on a button press.
- Checked in headless Chromium against the dev server without a terrain service (custom
  points sphere-only there): live-API paths (custom scan, saved terrain from the service)
  are not tried in a browser yet. Not checked on a phone-sized screen.

- Backend: complete for five sites over one year (geometry → metrics → terrain horizon →
  risk → alternatives: date alternatives, `rank`, `nearby`). Results in `data/`.
- Frontend: scaffold, data build script, TypeScript risk engine (validated against
  `risk_<site>.json`) and a south polar map with Moon Trek tiles. Visual design is
  deliberately blank until the frontend developer gives a design prompt.
- Built on 2026-11-14 (backend, contracts confirmed by Kerem as proposed): `vectors` and
  `grid` commands, the `landing_precision_m` profile key, the terrain service in `api/`.
  See "Backend state against this plan" below for the exact shapes and measured numbers.
- Built on 2026-11-14 evening: profile presets and the backtest (above). Not done there:
  a heated / nuclear preset (no sourced numbers), the `date_alternatives` midnight quirk
  (see pitfalls), a `validate` check that the Python and TypeScript presets are equal.
- Not built: the visual parts of the frontend that are still open (see "Frontend status"),
  README.

**The terrain API is live (since 2026-11-15 ~00:45):**
`https://lunaris-terrain-601609650151.europe-west1.run.app` (`/health`, `/horizon`).

- Host: Google Cloud Run, Kerem's account (free trial), project
  `project-df92223b-059a-42b1-82a`, region `europe-west1`, service `lunaris-terrain`, public,
  2 GiB / 2 CPU, at most 2 instances, scales to zero. Redeploy:
  `sh api/deploy_cloud_run.sh project-df92223b-059a-42b1-82a` (needs `gcloud auth login` as
  Kerem; gcloud 593 is installed with Homebrew). Logs:
  `gcloud run services logs read lunaris-terrain --project <id> --region europe-west1`.
- The container holds no terrain. It reads the height grid and the 60 m slope map by range
  requests from the public bucket `gs://lunaris-lola-601609650151` (same region;
  `LDEM_60S_60MPP_ADJ.TIF` 2.9 GB, `LDSM_60S_60MPP_ADJ.TIF` 4.0 GB) through the settings
  `LUNAR_TERRAIN_URL=https://storage.googleapis.com/lunaris-lola-601609650151`
  (`lunar_terrain.REMOTE_BASE`) and `LUNAR_TERRAIN_REMOTE_SLOPE=1`
  (`lunar_terrain.slope_map_available`). Mirror of all six local GeoTIFFs (9.4 GB):
  https://huggingface.co/datasets/KeremGull/lunaris-lola (account `KeremGull`); the first
  deployment read from it and was 2-3 times slower.
- Measured on the live service (bucket): first request after a deploy 4.4 s, a new point
  1.1-1.7 s, a repeated point 0.27 s (in-memory cache), 5x5 grid 8.0 s, 422 outside
  coverage, CORS `*`, immutable cache header. **Horizon, ground height and slope equal the
  local computation exactly** for the same point with `snap=false` (Mons Mouton slope 3.298,
  Malapert A 13.109 deg, horizon difference 0.0). With the Hugging Face source a custom
  point in the web UI (dev server, `VITE_TERRAIN_API` set to the URL in the git-ignored
  `web/.env.local` on Kerem's Mac) got its terrain from the service; not repeated in the
  browser after the move to the bucket.
- The local slope source changed on 2026-11-14 20:20: `LDSM_60S_60MPP_ADJ.tiff` (4.0 GB,
  60 m) is now in `data/lola` and is **picked before the 120 m map**, so `grid`, the API and
  a re-run of `horizon` use 60 m slopes; `grid_<site>.json` in the repository was made with
  the 120 m map and was not regenerated. Two `LDEC_*` files are also there (not used by any
  code, product not identified).
- Still to do: set `VITE_TERRAIN_API` to the URL in the Vercel project (Sezer) and redeploy
  the site; then restrict `LUNARIS_CORS_ORIGINS` to the site's origin (a list with commas
  needs another delimiter in `--set-env-vars`); optionally a scheduled `/health` call so a
  demo does not start cold. The 5x5 grid takes 8 s (computation, not reading). The UI calls
  `/horizon` with `grid=1` only (`/health` and the nearby-spot search have no component).
- Cost: the bucket is public, so downloads by others are billed as egress to Kerem's trial
  credit; storage of 6.6 GiB is small. Not priced exactly.
- Dead ends, do not retry: Hugging Face Docker Spaces need a PRO subscription since 2026
  (HTTP 402 on create); Render's free 512 MB is too close to the 500 MB peak measured. A new
  Google Cloud project refuses the first build until the default Compute service account
  has `roles/run.builder` (Kerem granted it). The slim Python image lacks `libexpat1`, which
  rasterio's GDAL needs (installed in `api/Dockerfile`).

**Next action (backend):** ask Kerem what he wants next; the current list is in "Next steps"
at the end of this file (item 1 is connecting the deployed site to the live API).
**Next action (frontend):** the design is decided and planned in `frontend-plan.md`. Phase 8
has its explainer lines (`Explainer.tsx`, an info tooltip in the inspector header) and URL state (`state/url.ts`); whether phase 8 is
complete was not checked in the running app by the backend side. Ask Sezer.
**Open decisions (user/team; do not decide silently):**

- Slope source for scores. Kerem supplied local `LDSM_60S_120MPP_ADJ.tiff` and asked to use
  it; `grid`/API use it when present. It is 120 m/pixel and reads lower than the 60 m map
  stored in `horizon_<site>.json` (p95 within 1000 m: Shackleton 7.6 vs 9.4, ridge 14.3 vs
  15.1, Malapert A 15.5 vs 15.9, Mons Mouton 5.3 vs 5.9, Chandrayaan-3 2.5 vs 3.2 deg).
  `horizon_<site>.json` and the risk files were NOT regenerated, so they still carry the
  60 m values; re-running `horizon` now would switch them to the 120 m map and move the
  surface scores (Shackleton 87 -> about 51). Every grid point also carries
  `slope_derived_deg` (from the 60 m heights) so either can be chosen.
- Surface score radius: `risk` judges slope within the 1000 m ellipse of the horizon file,
  `grid`/API within `landing_precision_m` (100 m). Same point, different surface score
  (Mons Mouton 18 vs 0). Decide one rule for the UI.
- Roughness (`LDRM`, 80S to the pole only) is reported per grid point but not scored; its
  unit was not checked against the product description.
- Mission-profile defaults: mission length, battery survival hours, max comm outage, slope
  limit, minimum Sun share, daily contact hours (`DEFAULT_PROFILE` in `lunar_risk.py`, mirrored in
  `web/src/engine/risk.ts`; change both and re-run `npm run validate`).
- Landing precision / ellipse radius. Results flip with it: Malapert A `nearby` finds nothing
  low-risk at 1000 m but a risk-3 point 2 km E at 300 m.
- Demo story. Candidates: Mons Mouton slip (risk 18 → 100 with a 7-day slip → 18 at +28 d);
  Malapert A "a point 2 km east saves it".
- Official site coordinates (all approximate), date range of the tables.

**How Kerem works (confirmed in practice):**

- Talks Turkish; wants every code/doc artifact in jury-ready English.
- Wants direct answers with concrete numbers and a recommendation, asks "why not X?"
  follow-ups; explain trade-offs with estimates and say clearly what was not verified.
- Ask before large downloads (state file, source, size).
- Commit messages: English, Conventional Commits (`type(scope): imperative summary`, types
  such as `feat`, `fix`, `docs`, `chore`, `refactor`, `test`; scopes used so far: `backend`,
  `data`, `web`; optional body explaining what and why). One logical change per commit.
- README is deliberately last. CLAUDE.md is internal and names the user; the repository is
  public, so keep personal details out of it beyond what is already here.

**Pitfalls already hit (do not rediscover):**

- Skyfield `Loader`: pass bare kernel file names, not paths (caused a 404 on second run).
- PGDA server: slow, drops connections, intermittent 503. `curl --retry` with `-C -`
  discards progress; curl without `-f` treats a 503 page as success. Use the resume loop in
  "Status". A partial file under the final name breaks reads (use `.part`).
- `horizon` reads slope/error/effres/PSR layers remotely even with the local DEM; it fails
  when the server is down. `nearby`, `risk`, `rank`, `metrics`, `mast` need no server
  (`nearby` and `mast` need the DEM, local or remote).
- `risk` counts whole hourly samples; `metrics` interpolates events. Small differences
  between the two are expected.
- `nearby` uses DEM-derived slope, `risk` uses LOLA LDSM → centre surface score can differ
  slightly (Mons Mouton 23 vs 18).
- CSV writers use LF line endings on purpose (CRLF created whole-file diffs in git).
- `risk_<site>.json` is the reference for the frontend engine test: after regenerating it,
  run `npm run validate` in `web/`. Adding keys is safe; changing `window`/`slips`/`scan`
  values is not.
- A `.venv` cannot be copied between machines or operating systems; recreate it.
- `web/scripts/build-data.mjs` cuts `dsn_moon.csv` to the length of the per-site tables,
  because the station table now runs to 2030 while `skyfield_<site>.csv` covers one year.
- Local terrain files are matched without regard to case and `.tif`/`.tiff`; the slope map
  may be the 60 m or the 120 m file. `roughness` is local-only (no remote fallback).
- The API snaps a clicked point to the nearest 60 m height pixel (moves it up to ~42 m); the
  UI must use the `center` returned, not the clicked coordinate. `snap=false` turns it off.
- `fastapi`/`uvicorn` are in `api/requirements.txt` only (installed in Kerem's `.venv`).
- After pulling frontend work run `npm install` in `web/` (new dependencies such as
  `radix-ui`, `lucide-react`); it may touch `package-lock.json`, do not commit that by accident.
- `date_alternatives` matches the landing against the scan's midnight dates: with a landing
  time that is not 00:00 the "Requested date" line can say "NOT low risk" although the
  window itself scores low (seen in `backtest --profile solar_lander`). Trust the slip table.
- The terrain-sensitivity experiment (hypothetical uniform horizons by latitude) was a
  throwaway script; only its result table is kept below.

**Not validated yet:** rise/set event times against Horizons; Mazarico 2011 percentages
quoted from memory; DSN station coordinates approximate.

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
Horizons, precomputed CSVs) ✔; LOLA topography for horizons ✔ (surface _visualization_ not yet);
no atmosphere → horizon from terrain + limb of the sphere, no refraction ✔; solar elevation
computed ✔ but must be shown prominently in the UI.

## Status (2026-11-14, ~15:00 local)

The whole computation backend works end to end for five sites over one year
(2026-12-01 → 2027-12-01, hourly), including alternatives (dates, sites, nearby points).
The frontend has its non-visual parts and a map (see "Frontend status"). The git repository
has commits on `main` and is pushed to GitHub.

**Setting up a machine:** clone the repository (`data/` results are tracked), then:

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python lunar_sky.py sites
```

Windows (the pinned requirements resolve to Windows wheels on Python 3.13, checked with a
pip dry run only):

```
python -m venv .venv; .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python lunar_sky.py sites
```

`kernels/` (19 MB, git-ignored) is downloaded automatically by Skyfield on first use.

**LOLA DEM** (`data/lola/LDEM_60S_60MPP_ADJ.TIF`, 3,089,110,093 bytes, git-ignored) is
optional. Kerem's Mac has a complete copy (in the old working folder until moved here).
Without it terrain windows are read remotely (~50 s per site instead of 0.3 s; `nearby`
becomes slow but works). The horizon from the local file equals the remote-derived one within
0.00005° at all five sites. Measured on the Mac with the local DEM: one horizon including
window reads 0.2–0.8 s; `nearby` with 33 points (windows read once, Skyfield angles, horizon,
slope, one-year risk scan per point) 8 s in total.

The PGDA server throttles and drops large downloads (the DEM took ~3 h). To download it,
resume in a loop and never leave a partial file under the final name (the code would try to
read it); do NOT combine curl's `--retry` with `-C -`:

```
cd data/lola; f=LDEM_60S_60MPP_ADJ.TIF
until [ "$(stat -f%z $f.part 2>/dev/null)" = 3089110093 ]; do
  curl -sS -f -L -C - -o $f.part https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/$f; sleep 20; done
mv $f.part $f
```

## Custom coordinates and nearby alternatives (plan, 2026-11-14)

Proposed from the frontend side on 2026-11-14. **The backend owner should confirm the contracts
below before anyone builds on them.**

Backend state against this plan (2026-11-14 ~16:00): **contracts confirmed by the backend
owner as proposed and built.** Differences from the table below are additions only.

- `data/ephemeris_vectors.csv`: `python lunar_sky.py vectors --start 2026-12-01 --days 1491`
  (35,785 hourly rows to 2030-12-31T00:00Z, 3.0 MB; Sun to 0.1 km, Earth to 0.001 km). The
  command checks itself against every `skyfield_<site>.csv`: max difference 0.00003 deg
  (target was 0.01). Reference implementation of the browser math: `vectors_to_altaz`.
- `data/dsn_moon.csv`: same range (`dsn --start 2026-12-01 --days 1491`); the first year is
  byte-identical to the previous file.
- `data/grid_<site>.json`: `python lunar_sky.py grid --site <key>` (defaults `--grid 9
--grid-step 125`, precision from the profile, `--precision` overrides). About 0.45 MB per
  site, 5.5 s each. The center point equals `horizon_<site>.json` exactly. Top-level keys:
  `site`, `center`, `grid`, `step_m`, `mast_m`, `precision_m`, `source`, `slope_source`,
  `horizon_coverage_complete` (false when the 250 km horizon reach leaves the map, i.e.
  north of about 68S), `points`. Points: center first, then rows from the south-west. Per
  point, beyond the contract: `slope_deg` is the 95th-percentile slope within `precision_m`
  (LDSM if local, else derived), plus `slope_at_point_deg`, `slope_derived_deg`, `roughness`.
  With a per-site Sun/Earth table the command also prints the best neighbour for `--landing`.
- `GET /horizon` in `api/main.py` (`uvicorn api.main:app` from the repository root): the same
  document without `site`. Parameters `lat, lon, mast=2, grid=1 (odd, max 5), step=125,
precision=100, snap=true`. 422 outside coverage or for a bad grid, 429 above 2 concurrent
  computations, `Cache-Control: immutable`, CORS from `LUNARIS_CORS_ORIGINS` (default `*`),
  in-memory cache of 256 answers. `GET /health` reports which terrain files are in use.
  Measured on the Mac with local files: grid=1 0.3 s, grid=5 1.8 s, cached 1 ms.
  `api/Dockerfile` and `api/start.sh` (fetches files listed in `LUNARIS_TERRAIN_URLS`) are
  written but were never built or run.
- Grid results, landing 2026-12-16 (slope from the 120 m LDSM within 100 m): Malapert A site
  risk 100 -> best neighbour 500 m N, 250 m W risk 52 (usable Sun 81.0 -> 88.1 %, longest
  dark 2.6 d -> 38 h, slope 12.9 -> 6.4 deg), no low-risk point in the square; Mons Mouton
  site risk 0, 75 of 81 points low-risk; Chandrayaan-3 28 -> 20 at 375 m S, 375 m E;
  connecting ridge all 100 (comm) with usable Sun 11-100 % across the square; Shackleton
  floor all 100.
- The ring search `nearby` is kept unchanged (another site a few km away); the grid is for
  fine placement.

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

| Item                                            | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/ephemeris_vectors.csv` (new)              | `utc, sun_x_km, sun_y_km, sun_z_km, earth_x_km, earth_y_km, earth_z_km`: apparent position of the Sun and Earth centers relative to the Moon's center in `MOON_ME_DE421`, hourly. The browser subtracts the site vector and projects on the local horizontal frame; the result must match `skyfield_<site>.csv` (target: within 0.01°). Replaces the per-site CSVs as UI input.                                                                             |
| `data/dsn_moon.csv`                             | unchanged columns, extended to the same date range                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GET /horizon?lat=&lon=&mast=2&grid=1&step=125` | `{"points": [...]}`, center first. Each point: `lat`, `lon`, `east_m`, `north_m`, `ground_height_m`, `mast_m`, `azimuth_step_deg`, `horizon_deg` (same meaning as in `horizon_<site>.json`) and `slope_deg` (local slope derived from the DEM; a 1000 m ellipse would be nearly identical for neighbours 125 m apart). `grid=N` returns an N×N square with `step` meters between points. HTTP 422 outside the DEM coverage. CORS must allow the web origin. |
| `data/grid_<site>.json` (new)                   | the same response, precomputed for each built-in site, so built-in sites never need the API                                                                                                                                                                                                                                                                                                                                                                 |

Date range of the vectors and DSN tables: 2026-12-01 → 2030-12-31 for now (about 0.9 MB as
Float32); the kernels allow anything up to 2050. The range must stay easy to change: the
backend sets it with `--start/--days`, and the UI never hard-codes it (the date picker takes
its limits from the first and last row of the table).

File formats: the backend keeps writing CSV for the large hourly tables; a build script in
`web/` converts them to binary arrays for the browser. Small per-point files (horizons,
grids, API responses) are JSON.

**Search area for nearby spots (agreed 2026-11-14).** A ±500 m square around the point:

| Case                                           | Grid            | Step  | Reason                     |
| ---------------------------------------------- | --------------- | ----- | -------------------------- |
| Built-in sites, precomputed `grid_<site>.json` | 9×9 (81 points) | 125 m | no time limit offline      |
| Custom point, live API                         | 5×5 (25 points) | 250 m | about 2.4 s of computation |

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

| Step                                                                                | Time   |
| ----------------------------------------------------------------------------------- | ------ |
| Horizon, one point, windows already in memory                                       | 0.09 s |
| Horizon, 5×5 grid (25 points), same windows                                         | 2.4 s  |
| Horizon, 9×9 grid (81 points)                                                       | 7.7 s  |
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

- TypeScript, deployed by Vercel as static files, no Docker), `api/` (FastAPI + Dockerfile,
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

**The visual design is now specified in `frontend-plan.md`** (four-zone HUD, Radix + own CSS,
lucide icons). Follow that plan; do not invent a different layout or recreate the first,
deleted UI. Everything below that is not visual is kept and verified.

What exists in `web/` (Vite + React + TypeScript, Node 24, no UI library):

| File                           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build-data.mjs`       | Converts `../data` into `public/data/` (git-ignored, regenerated by `npm run data`, runs automatically before `dev` and `build`): `sky_<site>.bin` (Int32 columns sun az/alt, earth az/alt, degrees × 1e5), `dsn.bin` (Int32, degrees × 1e3), minified `horizon_<site>.json`, `manifest.json` (start, step, count, scales, site list), and for custom points `vectors.bin` (Float32 columns sun x/y/z, earth x/y/z in km, 0.86 MB), `stations.bin` (like `dsn.bin`, on the vectors time axis to 2030), `grid_<site>.json`; `manifest.vectors` holds that longer time axis. The date range and the site list come from the files, never from code. About 0.85 MB in total. |
| `src/data/load.ts`             | `loadDataset()` fetches the manifest and binaries and returns per-site `SkySeries`, `Horizon`, ground height, LOLA slope p95 and radius, plus the highest DSN Moon elevation per sample (`stationMaxAlt`). Asset URLs use `import.meta.env.BASE_URL`.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/engine/risk.ts`           | TypeScript port of `lunar_risk.py`: `buildSeries`, `analyzeWindow`, `scoreWindow`, `scanLandingDates`, `horizonAt`, `DEFAULT_PROFILE`. All risk computation runs in the browser and takes a few milliseconds per site and year.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scripts/validate-engine.ts`   | Compares the engine with `data/risk_<site>.json` for every site: the mission window, the five slip windows and all 352 landing-date scan rows, within the backend's 3-decimal rounding. Run with `npm run validate`. **Result on 2026-11-14: identical for all five sites.** Re-run it after any change to `risk.ts`.                                                                                                                                                                                                                                                                                                                                                     |
| `src/engine/sky.ts`            | `skyFromVectors(table, lat, lon, heightM, range?)`: Sun/Earth azimuth and elevation of any coordinate from the site-independent vectors table (port of `vectors_to_altaz`); returns a `SkySeries`, so `buildSeries` takes it directly. `sampleIndex`, `tableEndMs`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/engine/grid.ts`           | Types `TerrainGrid` / `TerrainPoint` (shape of `/horizon` and `grid_<site>.json`); `scoreGrid(grid, vectors, stationMaxAlt, profile, landingMs)` scores every point for one mission window (25 points in about 5 ms); `bestPoint` (lowest risk, then most Sun, then nearest; same order as the backend); `pointHorizon`.                                                                                                                                                                                                                                                                                                                                                  |
| `src/data/terrain.ts`          | Terrain-service client: `fetchHorizon({lat, lon, grid, step, mast, precision}, signal)` with an in-page cache, `fetchTerrainHealth`, `terrainConfigured`, `insideTerrainCoverage`, `TerrainError` with `kind` `unconfigured` / `outside` (422) / `busy` (429) / `unavailable`. Service address from `VITE_TERRAIN_API` (for example in `web/.env.local`: `VITE_TERRAIN_API=http://localhost:8000`).                                                                                                                                                                                                                                                                       |
| `src/data/load.ts` (additions) | `loadSkyTables()` -> vectors table, `stationMaxAlt` on its time axis, `endMs` (date-picker limits); `loadSiteGrid(key)`; `SiteInfo.grid` says whether a grid file exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/App.tsx`, `src/index.css` | Map, site list and a five-row fact card for the selected site or clicked point; glass theme tokens. The starting point of `frontend-plan.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Commands: `cd web`, `npm run dev`, `npm run build`, `npm run validate`.

`npm run validate` now also checks the site-independent path (result on 2026-11-14, all five
sites): angles from `vectors.bin` equal the per-site tables within 0.00003 deg (Float32 is
enough), and the center of every precomputed grid, scored from the vectors table, reproduces
the backend's mission window. Best neighbours equal the backend's `grid` output (Malapert A
500 m N, 250 m W, risk 52). A live test against the local API for a custom point
(-85.3, 31.0, grid 5) gave the same scores as Python for landings in 2026 and 2029. `tsc -b`,
`oxlint` and `vite build` pass. The client in `terrain.ts` was run in a
browser against the local API on 2026-11-14 (`VITE_TERRAIN_API=http://localhost:8000` in
`web/.env.local`): a custom point (-85.3, 31) got its terrain horizon, the snapped center
and the exact 10 m mast horizon; CORS and caching headers are in place. The UI calls
`/horizon` with `grid=1` only: `/health` (service status) and the `grid=5` nearby-spot
search are not used by any component yet.

Not built yet: everything visual and interactive (horizon panorama with Sun and Earth, time
slider and animation, status cards with elevation and time to sunset / Earthset, risk card,
slip table, landing-date calendar, side-by-side comparison, saved custom points, the
nearby-spot heat map, the click-to-assess flow of the plan). `landing_precision_m` is in
`Profile` but nothing sends it to the service yet (pass it as `precision`).

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

| File               | Role                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| `lunar_sky.py`     | CLI + Skyfield geometry + Horizons client + DSN station table                       |
| `lunar_metrics.py` | Rise/set events, visibility windows, summaries (stdlib only)                        |
| `lunar_terrain.py` | LOLA windows (local or remote COG), terrain horizon, slope, PSR access              |
| `lunar_risk.py`    | Per-sample power/comm state, mission-window indicators, risk score, date scan       |
| `api/main.py`      | FastAPI terrain service: `/health`, `/horizon` (wraps `lunar_terrain.compute_grid`) |

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
python lunar_sky.py rank     --landing 2026-12-16            # all precomputed sites, same date/profile
python lunar_sky.py nearby   --site malapert_a --landing 2026-12-16   # --radii 1,2,5,10 --ellipse 1000
python lunar_sky.py vectors  --start 2026-12-01 --days 1491           # site-independent Sun/Earth vectors
python lunar_sky.py grid     --site malapert_a --landing 2026-12-16   # --grid 9 --grid-step 125 --precision 100
python lunar_sky.py backtest                                          # Chandrayaan-3, August 2023 (pass/fail checks)
# named mission profile for risk/rank/nearby/grid/backtest: --profile generic|solar_lander|battery_rover
# custom point: --lat -85 --lon 30 --site custom85   step: --step 60 (min)
# risk profile overrides: --battery-hours 50 --max-outage-hours 24 --max-slope 10 --mask 0 --sphere
```

Outputs in `data/` (the UI reads these; the only live call is `/horizon` for custom
coordinates, see "Custom coordinates and nearby alternatives"):

| File                                                 | Content                                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skyfield_<site>.csv`                                | `utc, sun_az_deg, sun_alt_deg, earth_az_deg, earth_alt_deg` (hourly, 1 year)                                                                                                                    |
| `horizons_<site>.csv`                                | same columns from JPL Horizons (validation, December 2026 only)                                                                                                                                 |
| `metrics_<site>.json`, `metrics_<site>_terrain.json` | per track `sun`/`earth`/`both`: `summary`, `events`, `windows` (+ `status` with `--at`)                                                                                                         |
| `horizon_<site>.json`                                | `horizon_deg` and `horizon_range_km` per azimuth (0.5° step), `ground_height_m`, `surface` (slope stats from LOLA LDSM and derived from DEM, `height_error_m`, `effective_resolution_m`, `psr`) |
| `dsn_moon.csv`                                       | `utc, goldstone_alt_deg, madrid_alt_deg, canberra_alt_deg` (site independent)                                                                                                                   |
| `risk_<site>.json`                                   | `horizon_uncertainty` (same mission on the horizon raised by the map's height error), `profile`, `window` (power + comm indicators), `score`, `slips` (0/+7/+14/+21/+28 d), `dates` (nearest low-risk dates, slip tolerance, low-risk windows), `scan` (every landing date)           |
| `mast_<site>.json`                                   | Sun/Earth visibility for several mast heights                                                                                                                                                   |
| `ranking.json`                                       | all sites for one landing date: window, score, date alternatives; sorted by risk                                                                                                                |
| `ephemeris_vectors.csv`                              | `utc, sun_x_km … earth_z_km`: Sun and Earth from the Moon's center in `MOON_ME_DE421`, hourly to 2030-12-31                                                                                     |
| `grid_<site>.json`                                   | 9×9 points every 125 m around the site: horizon profile and slope per point (shape of the API response)                                                                                         |
| `backtest_chandrayaan3.json`                         | the model run on the flown Chandrayaan-3 mission (2023): slip table, model sunset/sunrise, observed dates, `checks`, `passed`                                                                   |
| `nearby_<site>.json`                                 | 33 candidate points (site + 8 bearings × rings): position, height, slope, indicators, scores, slip tolerance, low-risk date count; `best_for_date`, `most_slip_tolerant`, `most_low_risk_dates` |

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
link %, longest outage, contact on the worst day (fewest contact hours in any 24 h block
counted from the landing, whole blocks only), hours lost to terrain / station gap / conjunction.

Score per category, 0–100: 0 while at most half of a limit is used, 100 at the limit.
Power = worse of (longest darkness vs battery) and (usable-Sun shortfall); comm = worse of
(longest outage vs limit) and (shortfall of the worst day's contact against
`min_daily_contact_h`);
surface = 95th-percentile slope within the ellipse vs slope limit. Overall = worst category.
<33 low, <66 medium. `DEFAULT_PROFILE` values (14-day mission, 50 h battery, 24 h max outage,
10° slope, 50 % minimum Sun, 8 h of contact in every 24 h) are **placeholder assumptions** — the team must choose a
mission profile.

**Mission-profile presets** (`PROFILE_PRESETS` in `lunar_risk.py`, mirrored in
`web/src/engine/risk.ts`; CLI `--profile`, UI selector in the risk card, URL `profile=`).
Each preset only overrides `DEFAULT_PROFILE` and carries a `basis` text shown in the UI:

| Key             | Darkness limit | Slope limit | Basis                                                                                                                                                                                              |
| --------------- | -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic`       | 50 h           | 10 deg      | project defaults (placeholders); the reference files `risk_<site>.json` use this one                                                                                                               |
| `solar_lander`  | 24 h           | 10 deg      | IM-1 / Chandrayaan-3 class, no night survival (confirmed). 24 h is OUR assumption; 10 deg is a statement by the Intuitive Machines CTO, not a document. Chandrayaan-3's slope limit was not looked up |
| `battery_rover` | 50 h           | 15 deg      | NASA VIPER lunar operations page (50 h continuous darkness, drives up to 15 deg). Other sources say "a little over four days" of darkness                                                          |

A heated / nuclear-powered preset was left out: no sourced numbers. Mission length stays
14 days in every preset. Seen in the UI: Mons Mouton, landing 2026-12-16, scores 18 (low,
surface) with `solar_lander` and 0 with `battery_rover` (slope 5.9 deg against 15).

**Horizon uncertainty** (2026-11-14; Kerem rejected a fixed 0.5 deg margin as arbitrary).
The margin is derived per azimuth from the data: `atan(height error / distance of the
obstruction that sets the horizon)`, with the largest LOLA height error inside the landing
ellipse (`surface.height_error_m.max`) and `horizon_range_km` of `horizon_<site>.json`
(`lunar_risk.horizon_uncertainty_deg` / `raised_horizon`, ported as `raisedHorizon` in
`web/src/engine/risk.ts`). `risk` scores the mission again on the raised horizon and writes
`horizon_uncertainty` (margin, window, score, low-risk date count) into `risk_<site>.json`;
the UI shows it under each score ("With map height error ...").

| Site             | Height error (max) | Nearest obstruction | Margin max / median | Effect, landing 2026-12-16                           |
| ---------------- | ------------------ | ------------------- | ------------------- | ---------------------------------------------------- |
| Shackleton       | 0.36 m             | 9.5 km              | 0.002 / 0.002 deg   | none                                                 |
| Connecting ridge | 0.55 m             | 0.09 km             | 0.35 / 0.117 deg    | link 83.3 -> 81.8 %, score unchanged                 |
| Mons Mouton      | 1.09 m             | 0.39 km             | 0.16 / 0.005 deg    | none                                                 |
| Malapert A       | 1.99 m             | 0.21 km             | 0.54 / 0.097 deg    | usable Sun 81.0 -> 80.1 %, dark 62 -> 65 h, same score |
| Chandrayaan-3    | 3.11 m             | 0.51 km             | 0.35 / 0.008 deg    | none                                                 |

**Result: no score, level or low-risk date count changes at any site**, so the verdicts are
robust to the map's stated height error. For comparison, a uniform 0.5 deg mask (not
justified by the data) moves Chandrayaan-3 from 28 (low) to 40 (medium) and cuts Mons
Mouton's low-risk dates from 22 to 16. Limits to state: the LOLA error map is the formal
interpolation error and ignores rocks and craters below the 60 m pixel; the error is taken
near the site, not at the far obstruction (where the angle is small anyway); landing-position
error is a separate, probably larger source (see the grids). Not available for custom points:
the API and `grid_<site>.json` carry neither `horizon_range_km` nor the height error. With a
raised mast the UI still uses the obstruction distances of the 2 m horizon.

Daily contact rule (2026-11-14): replaced "link in at least 50 % of the mission", which
never decided anything (the longest-outage test always fired first). The 8 h is an
assumption (about one ground-station pass), not sourced; CLI `--min-contact-hours`. Measured
before the change: with 4, 8 or 12 h the low-risk landing dates per year are the same as
with the old rule at every site (Mons Mouton 22, Chandrayaan-3 37, others 0), so the number
is not sensitive. Reason: with three DSN complexes the link is nearly continuous while the
Earth is up (worst day 23 h at Mons Mouton, Malapert A, Chandrayaan-3 for the 16 Dec window;
16 h is the lowest day of the year at the last two), and a day without contact already
fails the 24 h outage limit. The rule only bites for a mission with fewer stations or a
shorter outage limit. Over the year Mons Mouton has 21 days below 8 h, the ridge 177.

Alternatives: `dates` block = nearest low-risk landing date before/after, slip tolerance
(days the landing can slip and stay low-risk), list of low-risk landing windows. `rank`
compares the preset sites. `nearby` evaluates rings around a site with one shared DEM window;
it uses slope derived from the DEM for every candidate, so the centre's surface score can
differ slightly from `risk` (which uses LDSM).

Covered risk items: terrain eclipse, continuous darkness/battery, eclipse by Earth, grazing
Sun/partial disk, Earth occultation, solar RF conjunction, low-elevation multipath indicator,
DSN visibility gap, slope/tip-over, mast-height sensitivity, PSR access.
Deliberately out of scope (say so in the presentation): approach-corridor clearance, lobate
scarp seismicity/landslides, electrostatic dust, crater-wall IR reradiation, solar particle
events.

## Built-in sites (coordinates are APPROXIMATE, confirm before use)

| key              | Name                                                                      | Latitude | Longitude |
| ---------------- | ------------------------------------------------------------------------- | -------- | --------- |
| shackleton       | Shackleton crater center (floor)                                          | -89.67   | 129.78    |
| connecting_ridge | Shackleton–de Gerlache ridge (high-illumination point, Mazarico 2011)     | -89.45   | 222.69    |
| malapert_a       | Malapert A / IM-1 Odysseus                                                | -80.13   | 1.44      |
| mons_mouton      | Mons Mouton / IM-2 region                                                 | -84.79   | 29.20     |
| chandrayaan3     | Chandrayaan-3 (Shiv Shakti)                                               | -69.37   | 32.32     |
| apollo11         | Apollo 11 (for contrast; outside the DEM, sphere only, no data files yet) | 0.674    | 23.473    |

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
- Horizon from the local DEM equals the remote-derived one within 0.00005° at all five sites.
- **Backtest against a flown mission** (`python lunar_sky.py backtest`, result in
  `data/backtest_chandrayaan3.json`, all four checks pass with every preset): Chandrayaan-3
  landed 2023-08-23 12:33 UTC and worked until local sunset. Model, 12-day mission, terrain
  horizon, DSN: landing date risk 0 (97.6 % usable Sun); +7 d 100; +14 d 100 (0 % Sun);
  +28 d 0. Model sunset 2023-09-04 07:17 UTC (ISRO put the rover to sleep on 2 Sep and the
  lander on 4 Sep); model next sunrise 2023-09-19 22:38 UTC (ISRO's wake-up attempt was on
  22 Sep, no response). Low-risk landing windows: 21-24 Aug, i.e. the real date is inside,
  with slip tolerance 0-1 day. Observed dates are from press reports of ISRO statements; the
  official sunset time was not found. Comm in the model is DSN, the mission used ISRO/ESA
  stations too, so only the power side is really tested.
- **Not validated:** rise/set event times against Horizons.

### One year from 2026-12-01, terrain vs ideal sphere (observer 2 m above ground)

| Site               | Model   | Sun visible | Longest dark | Earth visible | Longest Earth outage |
| ------------------ | ------- | ----------- | ------------ | ------------- | -------------------- |
| Shackleton (floor) | sphere  | 56.0%       | 160 d        | 49.8%         | 13.7 d               |
|                    | terrain | 0%          | permanent    | 0%            | permanent            |
| Connecting ridge   | sphere  | 57.3%       | 137 d        | 48.9%         | 14.0 d               |
|                    | terrain | 82.7%       | 9.7 d        | 50.0%         | 13.6 d               |
| Mons Mouton        | sphere  | 50.3%       | 17.0 d       | 78.8%         | 6.0 d                |
|                    | terrain | 45.6%       | 17.1 d       | 92.8%         | 3.2 d                |
| Malapert A         | sphere  | 49.9%       | 15.9 d       | 100%          | none                 |
|                    | terrain | 39.0%       | 18.8 d       | 100%          | none                 |
| Chandrayaan-3      | sphere  | 49.0%       | 15.3 d       | 100%          | none                 |
|                    | terrain | 46.9%       | 15.9 d       | 100%          | none                 |

### 14-day mission landing 2026-12-16 (default profile, terrain, DSN)

| Site             | Usable Sun | Longest dark | Link  | Longest outage | Slope p95 | Risk (power/comm/surface) | Low-risk landing dates per year |
| ---------------- | ---------- | ------------ | ----- | -------------- | --------- | ------------------------- | ------------------------------- |
| Connecting ridge | 100%       | 0 h          | 83.3% | 2.3 d          | 15.1°     | 0 / 100 / 100             | 0 of 352                        |
| Mons Mouton      | 100%       | 0 h          | 99.7% | 1 h            | 5.9°      | 0 / 0 / 18 → low          | 22                              |
| Malapert A       | 81.0%      | 2.6 d        | 99.7% | 1 h            | 15.9°     | 100 / 0 / 100             | 0                               |
| Chandrayaan-3    | 89.9%      | 32 h         | 99.7% | 1 h            | 3.2°      | 28 / 0 / 0 → low          | 37                              |
| Shackleton floor | 0%         | 14 d         | 0%    | 14 d           | 9.4°      | 100 / 100 / 87            | 0                               |

Slip example (Mons Mouton): +0 d risk 18; +7 d Sun 51 %, 6.6 d dark → 100; +14 d Sun 1 % →
100; +28 d back to 18. This is the natural demo story.

Ranking for that date: mons_mouton 18 (low, slip tolerance 1 d), chandrayaan3 28 (low),
the other three 100. Mons Mouton low-risk landing windows: 14–17 Dec 2026, 13–15 Jan 2027,
then short windows in May, Aug, Sep, Oct, Nov 2027 (22 dates in total).

Nearby search (rings to 10 km), landing 2026-12-16:

- Malapert A, 1 km ellipse: every point within 10 km is limited by slope; best is 5 km N,
  risk 58 (medium). With `--ellipse 300`: 2 km E → risk 3 (low), 100 % Sun, 43 low-risk dates
  in the year (the site itself: risk 100, none).
- Connecting ridge: no low-risk point within 10 km (comm outage or slope); 1 km N drops to
  14 % Sun — extreme position sensitivity near the pole.
- Mons Mouton: the site itself is the best of its 33 candidates.

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

## Next steps (in priority order, rewritten 2026-11-15 ~01:30)

Done and no longer listed: vectors and DSN tables to 2030, the grid function, `/horizon`,
`grid_<site>.json`, the TypeScript risk engine, the HUD of `frontend-plan.md` up to phase 8
(explainer lines and URL state exist; completeness not checked), profile presets, the
backtest, horizon uncertainty, the daily contact rule, mission-limit sliders, the live API.

1. **Connect the deployed site to the API** (Sezer, minutes): set `VITE_TERRAIN_API` to
   `https://lunaris-terrain-601609650151.europe-west1.run.app` in the Vercel project and
   redeploy. Then backend: restrict `LUNARIS_CORS_ORIGINS` to the site's origin and try a
   custom point on the deployed site.
2. **Tell Sezer what changed in his area** on 2026-11-14 evening: profile selector, the
   "With map height error" line and the daily-contact footnote in the risk card, the
   "Mission limits" card. Ask him whether phase 8 is complete.
3. **Team decisions** (see "Open decisions"): slope source and whether to regenerate
   `grid_<site>.json` / `horizon_<site>.json` with the 60 m slope map; surface-score radius;
   default mission profile and the unsourced numbers in it (24 h for `solar_lander`, 8 h of
   daily contact); the demo story; the connecting ridge longitude.
4. **Frontend, if time allows:** terrain-service status from `/health`; try the custom-point
   nearby scan and saved points against the live API in a browser; a phone-sized check of
   the new cards. (Nearby search, heat map and saved points are built, see the handoff.)
5. **Backend, if time allows:** horizon uncertainty for custom points (the API would have to
   return `horizon_range_km` and a height error); the `date_alternatives` midnight quirk;
   a `validate` check that the Python and TypeScript presets are equal; a battery
   state-of-charge indicator (no sourced Wh / W numbers); rise/set times against Horizons.
6. **Before the demo:** call `/health` once to wake the service (first request about 4 s);
   check the Google Cloud trial credit.
7. **Last 5–6 hours:** no new features; bug fixing, demo story, presentation, submission,
   and the jury-facing English `README.md` (state the out-of-scope risks and that the limits
   are assumptions).

## References

- Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- Horizons manual: https://ssd.jpl.nasa.gov/horizons/manual.html
- Skyfield planetary frames (lunar surface example): https://rhodesmill.org/skyfield/planetary.html
- NAIF generic kernels: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- LOLA south pole products (PGDA): https://pgda.gsfc.nasa.gov/products/90
- Moon Trek: https://trek.nasa.gov/moon/
- LROC QuickMap: https://quickmap.lroc.asu.edu/
- Reference paper: Mazarico et al. 2011, polar illumination conditions from LOLA (Icarus)
