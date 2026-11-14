# Full scan: "Find best spots" for the mission on screen

Status: proposal for review, 2026-11-15. Nothing is built. Backend: please check section 4
(the data contract) and answer the questions in section 6.

## 1. What we want

One button, "Find best spots". For the mission on screen (landing date, mission length,
profile and limit sliders) it shows the best places to land, as a ranked list in the sites
panel and as markers on the map. Clicking a result selects it; `+` adds it as scenario B.

Today the "Best" badge only compares the five pin coordinates. The question the button
answers is wider: "for this date, where should we land?"

## 2. The constraint

Scoring a point needs three inputs. Two are already site independent and in the browser;
the third is the bottleneck.

| Input | Where it comes from | Cost |
| --- | --- | --- |
| Sun / Earth angles | `vectors.bin`, any coordinate | in the browser, free |
| DSN visibility | `stations.bin` | in the browser, free |
| Terrain horizon + slope | per point: a precomputed file or `GET /horizon` | the limit |

Horizons the browser has today: the 9 x 9 grids around the five sites (405 points, +-500 m
each, `grid_<site>.json`), saved points (at most 10) and grids fetched in the session.
Everything else needs the terrain service: 1.1-1.7 s per new point, 8 s for a 5 x 5 grid,
`grid` <= 5, `step` <= 1000 m, one request at a time from the page.

Browser scoring is cheap: about 0.2 ms per point for a 14-day mission (25 points in about
5 ms, `scoreGrid` in `web/src/engine/grid.ts`).

## 3. Options

### A. Known areas only (frontend only)

Candidate pool: the 405 grid points + saved points. Scored in about 0.1 s, follows the date
and the sliders live, no backend work, no service dependency.

- Result: the best point within +-500 m of each site, ranked. This already differs from the
  pins: Malapert A 100 at the pin, 52 at 500 m N / 250 m W; Chandrayaan-3 28 -> 20
  (landing 2026-12-16, numbers from the `grid` command).
- Limit: it never looks outside the surroundings of the five sites.

### B. A + "Scan this area" through the live service

Adds a second button that asks the service for 5 x 5 points at 1000 m around the map
center (+-2 km) and scores them. Works anywhere from 60 S to the pole.

- Cost: about 8 s per press, one +-2 km square per press, needs the service up.
- No backend change. Covering more than a few km this way is not practical.

### C. Whole-region heat map from a precomputed file (needs backend)

The backend writes one file with a coarse lattice of horizons over the polar region
(section 4). The browser scores every lattice point for the mission on screen and colours
the map; the list shows the top few zones.

- It is a screening, not a verdict. Near the pole results change within about 1 km (the
  connecting ridge drops to 14 % Sun 1 km north), so a 5 km sample does not describe its
  cell. Intended use is a funnel: heat map -> click a promising zone -> the existing
  +-500 m fine scan (5 x 5 at 250 m, about 8 s) finds the actual spot.
- Cost: sections 4 and 5.

### D. Staged: A now, C plugs in later (recommended)

Build the button, list and markers against a pluggable candidate pool. Today the pool is
option A. If the region file arrives, it becomes a second pool and the same button covers
the whole region. If it does not arrive, A is still a finished feature.

### Rejected

- Whole map through the live service: 3,000 points at 1.1-1.7 s, one at a time, is about
  an hour per scan.
- Raising `MAX_GRID` on the service: at the measured rate (25 points in 8 s) a 9 x 9 block
  is about 26 s and still covers one small square.
- Whole map on the sphere model (no terrain): free, but wrong where it matters. Shackleton
  floor is 56 % Sun on the sphere and 0 % with terrain; the connecting ridge 57 % vs 83 %.

## 4. Region file: proposed contract (option C)

Proposed from the frontend side; the backend owner confirms or changes it.

**Lattice.** A square lattice in the DEM's own projection (south polar stereographic x/y,
`latlon_to_xy`), spacing `step_m`, every node with latitude <= `max_lat`. A lattice in
projected x/y lets the browser draw the heat map as one small image aligned with the map
(about 122 x 122 pixels for 80 S at 5 km). Scale error of the projection at 80 S is 0.8 %.

**Per point.** The same quantities as a point of `compute_grid`, reduced:

| Field | Meaning |
| --- | --- |
| `x_m`, `y_m` (or row/column) | lattice position; lat/lon follow from the projection |
| `ground_height_m` | as in the grid files |
| `slope_deg` | 95th-percentile slope within `precision_m` (100 m), same statistic as `grid` |
| `horizon` | terrain horizon at 2 m mast, azimuth step `azimuth_step_deg` |

**Coverage and spacing** (point count = area / step^2):

| Coverage | Projected radius | 2.5 km | 5 km | 10 km | 16 km |
| --- | --- | --- | --- | --- | --- |
| 85 S - pole | 152 km | 11,600 | 2,900 | 720 | - |
| 80 S - pole | 304 km | 46,400 | 11,600 | 2,900 | 1,130 |
| 60 S - pole (whole map) | 931 km | - | 109,000 | 27,200 | 10,600 |

Recommendation: **80 S - pole at 5 km, about 11,600 points.** It contains four of the five
sites (Chandrayaan-3 at 69.4 S stays outside), and every point has complete horizon
coverage (the 250 km reach leaves the map only north of about 68 S).

**Horizon size.** Stored as Int16 hundredths of a degree:

| Azimuth step | Bytes per point | 11,600 points |
| --- | --- | --- |
| 0.5 deg (as today) | 1,440 | 16.7 MB |
| 1 deg | 720 | 8.4 MB |
| 2 deg | 360 | 4.2 MB |

Recommendation: 2 deg, taking the **maximum** of the 0.5 deg values in each bin, so an
obstruction is never lost (the screening errs toward more shadow). `horizonAt` in the
TypeScript engine already interpolates any azimuth step, so no engine change is needed.

**Format.** Two files in `data/`: a small JSON header (`region.json`: `step_m`, `max_lat`,
`mast_m`, `precision_m`, `azimuth_step_deg`, `source`, `slope_source`, point count, lattice
origin) and one binary (`region_horizons.i16`, little-endian, one row per point, plus
`ground_height_m` and `slope_deg` either in the header as arrays or as two more binaries).
JSON for the horizons would be about 11 MB at 2 deg. `web/scripts/build-data.mjs` copies
both into `public/data/`; the page loads them only when the button is pressed.

**Computation.** Suggested, not prescribed: reuse `compute_grid` block by block so the
height windows are read once per block. An 11 x 11 block at 5 km needs a near window of
about +-61 km at 60 m (16 MB) and a far window of about +-286 km at 240 m (23 MB); about
96 blocks cover the region.

## 5. Costs

| Item | Option A | Option C (80 S, 5 km, 2 deg) |
| --- | --- | --- |
| Backend work | none | new CLI command + one run |
| Backend run time | - | about 17 min at 0.09 s per horizon, plus window reads |
| New data in the repository | none | about 4.2 MB binary + a small JSON |
| Page load | unchanged | unchanged (loaded on button press) |
| First press | loads 5 grid files, 2.2 MB | loads about 4.2 MB |
| Scoring per date, 14-day mission | about 0.1 s | about 2.3 s in a Web Worker |
| Scoring per date, 60-day mission | about 0.4 s | about 10 s (fewer with several workers) |
| While dragging the date | live | recomputed after release |

Rough effort (frontend estimate, not measured): A about 2 h; C backend 1-2 h including the
run; C frontend 2-3 h (build script, worker, heat layer, list). Today is the last day of
the hackathon and the handoff says no new features in the last 5-6 hours, which is the
main argument for D.

## 6. Decisions needed from the backend owner

1. Can the region file be produced today, and is the time better spent elsewhere?
2. Coverage and spacing: 80 S at 5 km (recommended), 85 S at 2.5 km (same point count,
   finer, drops Malapert A), or something else?
3. Azimuth step and reduction rule: 2 deg with the maximum per bin?
4. File format: JSON header + Int16 binary as above, or another shape? Tracked in git?
5. Slope: the region file would use the 60 m slope map (now picked first locally) within
   100 m, while `grid_<site>.json` was made with the 120 m map. Regenerate the grids so
   both pools agree, or accept the difference?
6. Is a 5 km screening defensible in front of the jury if the UI labels it as "sampled
   every 5 km, scan a zone for the real spot"?

## 7. Frontend plan

**Shared by A and C**

- Button "Find best spots" at the top of the sites list (`web/src/panels/SitesPanel.tsx`;
  the sites sheet on phones). It reads the mission on screen; there is no second date
  field.
- Ranking: the existing `bestPoint` order (lowest risk, then most usable Sun), the same as
  the backend's `grid` command. One entry per area, otherwise the top five are all
  neighbours at Mons Mouton (75 of its 81 points are low risk).
- Output: a "Best for 16 Dec · 14 d" section (risk chip, usable Sun, name such as
  "Mons Mouton · 354 m NE") and numbered markers on the map. A result opens through
  `neighbourPlace` (`web/src/state/nearby.ts`), which keeps the point's terrain, so no
  service request is made.
- New `web/src/state/bestSpots.ts`: loads the pools on first press, scores with
  `scoreGrid` / `scorePlace` (`web/src/engine/grid.ts`), deferred so dragging the date
  stays smooth. `web/src/map/MoonMap.tsx` gets the ranked markers; `web/src/App.tsx` wires
  them.

**Only for C**

- `web/scripts/build-data.mjs` copies the region files; `web/src/data/load.ts` gets a
  loader; scoring moves to a Web Worker.
- Heat layer: one image in projected coordinates, coloured by risk level like the existing
  nearby dots. The list takes the top zones with a minimum distance between entries.
- Clicking a cell selects it as a custom point, where the existing "Scan nearby spots"
  does the fine search.

**Rules the scan follows (and where they differ from the pins)**

- Mast: 2 m only. The mast slider cannot apply, because the estimate needs
  `horizon_range_km`, which grid and region points do not carry.
- Slope: 95th percentile within `landing_precision_m` (100 m), not the 1000 m ellipse of
  `horizon_<site>.json`. A site's score in the list can therefore differ from its pin
  (Mons Mouton 0 vs 18). This is the open "surface score radius" decision becoming visible.

## 8. Not verified

- Browser scoring time at 11,600 points: extrapolated from 25 points in about 5 ms.
- Backend run time: 0.09 s per horizon was measured on the Windows machine with synthetic
  windows; the block scheme was not run.
- The effect of reducing the horizon to 2 deg on scores. Suggested check: score the five
  site centers with the reduced and the full profile and compare.
- Drawing the heat layer as one image in the map's projection was not tried.
- Whether a 5 km lattice finds the zones a planner would care about. A quick test: do the
  lattice points nearest the five sites agree in level with the sites themselves?
