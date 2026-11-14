# Frontend plan: four-zone HUD

Implementation plan for the Lunaris web UI (`web/`). Written 2026-11-14 from the frontend
developer's design brief (`frontend.md`, Turkish, not tracked) and a review of the current
code. A new session must be able to implement it from this file and `CLAUDE.md` alone.

**Status:** approved, not started. Implement phase by phase, starting at phase 0, one commit
per phase (Conventional Commits, English, no AI attribution, no push unless asked).

## Context

The challenge text gives seven UI directives:

1. Site selection and comparison: curated sites (Apollo, CLPS, other programs), custom
   coordinates, side-by-side or sequential comparison of sites (and of dates).
2. Date and time flexibility: see how a schedule slip changes feasibility.
3. Sun and Earth position relative to the horizon, time remaining to sunset and Earthset.
4. Power and communication: solar elevation angle shown prominently, sunlight duration,
   Earth visibility windows.
5. More than one visual representation of the site–Sun–Earth geometry (map plus a second view).
6. Temporal dynamics: animation or timeline over a lunar day or several days.
7. Accessible to mission planners and to the public; make the Moon/Earth contrast apparent.

Today `web/` has the Moon Trek polar map, a site list and a five-row fact card. The computation
engine (`engine/risk.ts`, `engine/sky.ts`, `engine/grid.ts`) is complete and validated against
the backend, but none of its output is on screen. Goal: build the panels on top of the existing
engine without rewriting it.

## Layout

| Zone | Content |
|---|---|
| Left panel ("Sites") | site list, custom `Lat °S` / `Lon °E` entry, Apollo 11 reference row, `+ Compare` per row |
| Center (map) | existing LOLA map; Sun and Earth direction arrows from the active pin(s) |
| Right panel ("Landing site") | one-line summary, 360° horizon view, 2×2 key metrics, risk badge, mast slider |
| Bottom bar | macro row: start date, window length, slip buttons, landing-date risk strip; micro row: play/pause, speed, hourly slider with Gantt strips; expands for comparison |

## Corrections to the brief (from the code and the data)

| # | Brief | Problem | Decision |
|---|---|---|---|
| 1 | Turkish labels (`Gölgede — Doğuşa 14s`, `+7 Gün Ertele`) | Everything the jury sees is English | English UI text: `In shadow · sunrise in 14 h`, `Slip +7 d` |
| 2 | Horizon chart Y axis fixed at −5°..+12° | Shackleton's horizon is 19.8–23.6°; the Sun is near 90° at Apollo 11 | Base range −5..+12°, widened automatically to the site's horizon; a body outside the range is drawn as an arrow with its value at the top edge |
| 3 | Horizon chart 320×130 px | Right panel is 300 px wide (264 px content) | Panel 360 px; chart is a responsive SVG (`viewBox`) |
| 4 | Apollo 11 in the list and on the map | The map is a south polar projection that ends near 55°S; no data files for Apollo 11 | List row labelled "Equatorial reference · off map", no pin, sphere model computed from the vectors table |
| 5 | Date range fixed at 2026-12-01 / 2030-12-31 | The UI must never hard-code the range | Limits from `loadSkyTables()` → `vectors.startMs` / `endMs` |
| 6 | Speeds 1x / 12x / 24x | 1x is real time, useless here | Simulated time per second: `6 h/s`, `24 h/s`, `3 d/s`; linear interpolation between hourly samples |
| 7 | "Max Continuous Eclipse" | In this code base "eclipse" means an Earth-caused eclipse | Label `Longest darkness`; badge against `battery_survival_h` (50 h default) |
| 8 | Custom coordinates | The terrain API is not deployed; no `VITE_TERRAIN_API` and no DEM on the Windows machine | Flow from `CLAUDE.md`: sphere model first, terrain when the API answers; visible label `Sphere model · no terrain` |
| 9 | Mast slider 2–15 m with a live horizon | Only the 2 m horizon profile exists; other heights need the DEM (backend) | **Decided:** first-order estimate now, API later (see "Mast slider") |
| 10 | No risk score | The engine has it (`scoreWindow`, `scanLandingDates`); the demo story (Mons Mouton 18 → 100 → 18) depends on it | **Decided:** risk badge plus a landing-date risk strip |
| 11 | Compare is Site A vs Site B only | Directive 1 also asks for date A vs date B; the core question is "the mission slipped, what now?" | **Decided:** A and B are scenarios (place + start date); `Slip +N d` keeps the original date as A and the slipped date as B |

## UI components

**Decided: Radix primitives with our own CSS; no Tailwind, no shadcn.** shadcn is Radix plus
Tailwind styles; behaviour and accessibility are the same, and we keep a single styling system
(the existing glass theme and tokens in `src/index.css`) without a Tailwind reset touching the
existing panels or Leaflet. No control may show the browser's default look.

New dependencies (check the current version and React 19 support with `npm view` when
installing):

- `radix-ui`: `Slider` (mast; thumb and keyboard behaviour of the time slider), `Popover`
  (date picker), `Tooltip` (icon buttons, values on the Gantt and risk strips), `ToggleGroup`
  (speed, window length, A | B).
- `react-day-picker`: calendar inside the `Popover`, limits from the table.
- `lucide-react`: icons (Play, Pause, Plus, X, Crosshair, ZoomIn, ZoomOut, Sun, Globe, …).
  Replace the inline SVG icons in the files being touched; keep the brand mark.

Thin wrappers in `web/src/ui/` (`Slider.tsx`, `DatePicker.tsx`, `Tooltip.tsx`, `Segmented.tsx`,
`NumberField.tsx`, `Button.tsx`) and `ui.css`, all on the existing tokens (`--glass`,
`--accent`, `--sun`, `--earth`, `--radius-row`, `--ease-out`). Number entry uses
`type="text" inputmode="decimal"` with our own validation (no native spinner). The main time
slider is a custom component: Gantt and risk strips behind a Radix `Slider`.

## Architecture

**One data path for every place.** `loadSkyTables()` → `skyFromVectors(vectors, lat, lon, 0)`
(height 0, as in `scripts/validate-engine.ts`) → `buildSeries(sky, horizon | null,
stationMaxAlt, profile)`. The whole table (35,785 hourly samples) is computed once per place and
memoized; a few milliseconds. The per-site `sky_<site>.bin` files are not used by the UI
(one year only).

**New code in `web/src/`:**

- `data/load.ts` (addition): `loadSiteTerrain(key)` → from `horizon_<site>.json`: `Horizon`,
  `groundHeightM`, `slopeP95Deg`, `slopeRadiusM`, `horizonRangeKm`, without downloading the sky
  binaries.
- `engine/events.ts`: `nextTransition(flags, margin, fromIndex)` (minute precision by linear
  interpolation between hourly samples; `null` → "Always visible" / "Never rises"),
  `runs(flags, first, count)` (Gantt intervals), `sampleAt(series, sky, tMs)` (interpolated
  instantaneous state; mind azimuth wrap-around), `panelYield(elevDeg, solarFraction)`
  (vertical panel = cos, horizontal = sin).
- `engine/mast.ts`: see "Mast slider".
- `state/scenario.ts`: `Place` = built-in site | custom point | reference; `Scenario` =
  `{ place, startMs }`; `usePlaceSeries(place)`. Time state (`startMs`, `windowHours`,
  `cursorMs`) in a small external store (`useSyncExternalStore`) so that only subscribed
  components re-render during playback.
- `state/usePlayback.ts`: `requestAnimationFrame` loop, speed, honours
  `prefers-reduced-motion`.
- `panels/SitesPanel.tsx`, `panels/InspectorPanel.tsx`, `panels/TimelineBar.tsx`.
- `charts/HorizonView.tsx` (SVG), `charts/GanttStrips.tsx` (canvas or SVG rects).
- `map/SkyArrows.ts`: SVG arrows inside a Leaflet marker at the active pin(s), updated
  imperatively.
- CSS: `panels.css`, `timeline.css`, `ui/ui.css`.

**Reuse, do not rewrite:** `horizonAt`, `buildSeries`, `analyzeWindow(series, ms, days)`,
`scoreWindow`, `scanLandingDates`, `SUN_RADIUS_DEG` / `EARTH_RADIUS_DEG`, `DEFAULT_PROFILE`
(`engine/risk.ts`); `skyFromVectors`, `sampleIndex`, `tableEndMs` (`engine/sky.ts`);
`fetchHorizon`, `terrainConfigured`, `insideTerrainCoverage`, `TerrainError`
(`data/terrain.ts`); `latLonToXY`, `formatLat`, `formatLon`, `formatDistance`,
`surfaceDistanceM` (`geo/polar.ts`); the `getInsets` pattern (`App.tsx`), `centerFor` and
`flyToPoint` (`map/MoonMap.tsx`).

**Arrow direction on the map.** The projection is conformal. Local north at a point = away from
the pole, `(x, y) / r`; local east = `(y, −x) / r`. Arrow direction =
`cos(az) · north + sin(az) · east`, with screen y flipped. Arrows have a fixed screen length,
independent of zoom.

## Mast slider (estimate now, terrain service later)

Not random mock data: a physical first-order estimate. `horizon_<site>.json` also gives the
distance of the obstruction at each azimuth (`horizon_range_km`). Raising the mast by `Δh`
lowers that obstruction's angle by about `atan(Δh / range)`:

`horizon'(az) = horizon(az) − atan((mast − 2 m) / range(az))`

The true horizon can be slightly higher (a farther ridge can take over), so the estimate leans
optimistic. Therefore:

- Visible label next to the slider: `Estimate · exact values need the terrain service`.
- `engine/mast.ts`: `estimateMastHorizon(horizon, rangeKm, mastM)`; single entry point
  `horizonForMast(place, mastM)`. When `terrainConfigured()` is true, the same function calls
  `fetchHorizon({ lat, lon, mast })` (debounced) and returns the exact profile, and the label
  goes away. Leave a `TODO(api)` comment there and a line in the `CLAUDE.md` handoff: "mast
  slider is an estimate until the terrain service is deployed".
- Disabled where no range data exists (custom points, Apollo 11).
- Sanity check: connecting ridge 2 → 10 m, yearly Sun 82.7 % → about 95.7 % (backend `mast`
  output, `data/mast_<site>.json`). If the estimate is far off, make the label stronger.

## Phases (one commit each)

0. **UI foundation.** Dependencies, `ui/` wrappers and `ui.css`; the existing sidebar and
   inspector icons move to lucide. Load the `dataviz` skill before any chart code.
   `feat(web): add UI primitives and icon set`
1. **Foundation.** `events.ts`, `loadSiteTerrain`, `scenario.ts`, `usePlayback.ts`. Extend
   `scripts/validate-engine.ts`: compare `nextTransition` results with the events in
   `data/metrics_<site>_terrain.json` and report the largest difference.
   `feat(web): add scenario state and rise/set event helpers`
2. **Bottom bar.** Date picker (limits from the table), window length (`14 d` /
   `1 lunar day · 708 h`), `Slip +7 d` / `Slip +14 d`, slider, play/pause and speed, three Gantt
   strips (Sun / Earth link / Both = golden window). Add the bar to the `getInsets` bottom inset;
   move `.map-footer`, `.map-controls` and `.map-attribution` above it.
   `feat(web): add timeline bar with playback and visibility strips`
3. **Right panel.** One-line summary (`Lat, Lon • X km to pole • Slope p95 Y°`), `HorizonView`
   (terrain silhouette; Sun and Earth disks at their true angular radii), 2×2 grid: Solar
   elevation (large type, with vertical vs horizontal panel yield), Time to sunset (red
   `In shadow · sunrise in …` when dark), Time to Earthset with `DTE link: Active / Blocked`
   and the reason (terrain / no station / conjunction), Longest darkness in the window with a
   battery badge. Panel width 360 px.
   `feat(web): add horizon view and key metric cards`
4. **Map arrows.** Yellow dashed Sun arrow, blue solid Earth arrow; they turn with the slider;
   dimmed while the body is below the horizon.
   `feat(web): draw Sun and Earth direction arrows on the map`
5. **Left panel and comparison.** `Lat °S` / `Lon °E` entry (validation, outside-coverage
   warning), Apollo 11 reference row, `+ Compare`. In comparison the bottom bar expands (A and B
   strips plus a difference summary such as `+22 % more Sun`), the right panel shows A | B
   columns, the map shows both pins with arrows. Scenario model: `+ Compare` sets B's place;
   `Slip +N d` with comparison off opens A = original date, B = slipped date (same place);
   `Clear comparison` closes it. Custom point: sphere first, then `fetchHorizon(grid=1)`; use
   the returned `center`; cancel on a new click.
   `feat(web): add custom coordinates and scenario comparison`
6. **Risk.** Badge in the right panel (overall plus power / comm / surface, `scoreWindow`,
   mission window of `DEFAULT_PROFILE.duration_days`); landing-date risk strip in the macro row
   of the bottom bar (`scanLandingDates`, one cell per day coloured low / medium / high; click
   jumps to that date).
   `feat(web): add risk badge and landing-date risk strip`
7. **Mast slider** with the estimate above; horizon view, metrics and Gantt strips update live.
   `feat(web): add mast height slider with first-order horizon estimate`
8. **Wrap-up.** Short explanatory lines for directive 7 (for example "The Sun moves about 0.5°
   per hour here, 15° per hour on Earth"), site and date in the URL, update `CLAUDE.md`
   ("Frontend status" and the session handoff).
   `docs: record the HUD in the session handoff`

Mobile: keep the existing sheet layout working, but desktop comes first.

## Verification

- After every phase in `web/`: `npm run validate` (existing checks plus the new event
  comparison), `npm run lint`, `npm run build`.
- In the browser (`npm run dev`), against known numbers:
  - Mons Mouton, landing 2026-12-16, 14 d: usable Sun 100 %, longest dark 0 h, risk 18 (low).
    `Slip +7 d` → Sun about 51 %, 6.6 d dark, risk 100; +28 d → back to 18.
  - Mons Mouton at 2026-12-16T00:00Z: time to sunset about 14 d 8 h (sunset
    2026-12-30T08:27Z in `data/metrics_mons_mouton_terrain.json`).
  - Malapert A: no Earthset → `Always visible`. Shackleton: permanent shadow, its 20–24°
    horizon fits the chart.
  - Apollo 11: Sun high, daylight about 14.75 d; the map does not fly.
  - Comparison Mons Mouton vs Malapert A: strips and difference summary consistent with the
    14-day table in `CLAUDE.md`.
- With the terrain API off, a custom point shows `Sphere model · no terrain` and no error.
