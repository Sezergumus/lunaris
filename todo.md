# TODO: Explorer mode and the 3D surface view

> **AI agent: this file is your task.** Read it to the end, read `CLAUDE.md`, then start
> phase 0 at once and work through every phase without stopping or asking for approval,
> following "Instructions for the AI agent" below. Finish by writing the "Summary" at the
> end of this file.

Plan for an educational "Explorer" mode and a first-person 3D surface view ("Lunar Street
View") in the Lunaris web UI (`web/`). Written 2026-11-15 ~05:45 local from a review of the
code and the data files. A new session must be able to implement it from this file and
`CLAUDE.md` alone.

**Status:** approved by Sezer and Kerem. Phase B and frontend phases 0 to 9 are done
(2026-11-15, Kerem's Mac; see "Summary"). One box is open: the frame-rate check on
integrated graphics (phase 2). One commit per phase (Conventional
Commits, English, no AI attribution, no push unless asked). Tick the boxes as the work lands.

**Who does what:** phase B is backend (Kerem, local DEM). Everything else is frontend
(Sezer). Phase 0 and the first half of phase 1 do not wait for phase B.

## Instructions for the AI agent (read first)

Sezer starts the agent and checks the result in the morning. Nobody is there to answer.

- **Work until every box in this file is ticked. Do not stop and do not ask for approval.**
  This file is the approval for every phase, every commit and every new dependency listed
  here. There is no time limit and nothing is cut: every phase is delivered.
- When a decision is open, take the option that best fits this file and `CLAUDE.md`, write
  it down for the summary, and go on. When something fails, find the cause and fix it; do
  not ship a lesser version instead.
- Phase B: if `data/terrain_<site>.json` / `.bin` are not there when phase 1 needs them, do
  phase B yourself. This Windows machine has no local DEM; `lunar_terrain.py` then reads the
  NASA files remotely (range reads, about a minute per site). The Python environment is
  `.venv` in the repository root (`.venv/Scripts/python`, `requirements.txt` installed).
  Pull first in case Kerem has already pushed them.
- After each phase: `npm run validate`, `npm run lint`, `npm run build`, then check it in a
  browser (headless Edge or Chrome against `npm run dev`; both are installed), then commit
  with the message given under the phase. Never push.
- Do not change the engine's numbers or the URL parameters the Planner already uses.
- Still off limits: any Claude/AI attribution, Turkish in code or docs, pushing, and
  deleting files you did not create.
- **When everything is done**, fill in the "Summary" section at the end of this file and
  commit it: what was built per phase, decisions you took on your own, deviations from this
  plan, what was checked and how, known problems, and how to try it (URLs to open). Update
  the session handoff in `CLAUDE.md` in the same commit.

## Why

The challenge text names "an educational game" as an accepted format and asks for
accessibility across skill levels, for the Moon/Earth contrast to be apparent, and for an
explanation of why a small change of place or date has a large effect. The Planner answers a
mission planner; nothing on screen yet answers a first-time visitor.

## Approach: real terrain, engine-decided visibility

Three ways were weighed:

| Way | Result | Verdict |
|---|---|---|
| Layers built from `horizon_range_km` plus the 9 × 9 grid | One obstruction per direction: flat cut-outs, no shadows, coarse ground | Rejected: does not look real and invents depth |
| Skyline panorama only (no new data) | Honest and quick, but a flat silhouette | Kept as the fallback |
| **Real LOLA height patches, drawn with three.js, shadows computed on the GPU** | Real mountains, crater rims and slopes; shadows that move with the Sun | **Chosen** |

three.js is the drawing library in every case; the choice is about the data. The chosen way
needs one new backend output (phase B): height patches cut from the same 60 m DEM
(`LDEM_60S_60MPP_ADJ.TIF`) the horizon code already reads. No new source file is needed:

- LDSM (slope map) is not needed: slopes and surface normals follow from the heights.
- Moon Trek hillshade tiles are not used as a texture: their lighting is baked in and would
  contradict the moving Sun.
- The 20 m DEM (80° S to the pole) could sharpen the nearest few hundred meters later. It
  does not cover Chandrayaan-3 and differs from what the engine uses. Not in this plan.

Rules that keep the view honest:

1. **The engine decides what is visible.** The Sun and the Earth are clipped by
   `PlaceData.horizon` (the profile the risk model uses) and are also covered by the terrain
   mesh. A disk shown while the metric card says "In shadow" must not happen.
2. **Shadows are required, not decoration.** With the Sun 1–2° high the picture is made of
   shadows cast by distant ridges. Without them the inner wall of Shackleton would be drawn
   sunlit, which is false.
3. **What the data cannot show is said on screen.** A 60 m pixel has no rocks or small
   craters; the ground at the observer's feet is smooth. Stars, the Sun's glare and the fill
   light in shadow are illustrative.

## Phase B (backend, Kerem): terrain patches

New command `patch` in `lunar_sky.py` (function in `lunar_terrain.py`), one run per built-in
site: `python lunar_sky.py patch --site mons_mouton` → `data/terrain_<site>.json` and
`data/terrain_<site>.bin`.

- [x] Four nested square windows of `height_m`, all through
      `read_window("height_m", x_site, y_site, radius_m, decimation)` so they share one
      center (the 60 m pixel corner nearest the site) and average resampling:

      | Level | Decimation | Pixel | `radius_m` | Size |
      |---|---|---|---|---|
      | 0 | 1 | 60 m | 7 680 | 256 × 256 |
      | 1 | 4 | 240 m | 30 720 | 256 × 256 |
      | 2 | 16 | 960 m | 122 880 | 256 × 256 |
      | 3 | 64 | 3 840 m | 245 760 | 128 × 128 |

      Each level covers exactly the middle quarter (per side) of the next one.

      **As built (2026-11-15, Kerem's Mac):** `lunar_terrain.compute_patch` reads one
      full-resolution window (8192 x 8192) and block-averages it for every level, instead
      of four decimated `read_window` calls. A decimated read takes the file's overviews,
      whose pixel grid is not aligned with the window (measured against the true block
      average at Mons Mouton: up to 16 m at 240 m pixels, 113 m at 960 m, 938 m at 3 840 m),
      which would open steps between levels. Now a coarse pixel equals the mean of the
      16 finer pixels it covers (checked: difference 0.001 m or less at all five sites).
      Level 1 therefore differs by a few meters from the far window of `compute_horizon`.
- [x] `terrain_<site>.bin`: Float32, little-endian, levels 0 to 3 one after the other, each
      row by row with row 0 at the top (largest projected y), as `Grid.data`. 852 kB per
      site. Float32 on purpose: height steps of 0.1 m would show as bands under a 1–2° Sun.
- [x] `terrain_<site>.json`: `site` (key, name, lat, lon), `source`, `ground_height_m`
      (bilinear at the site, the value in `horizon_<site>.json`), and per level `pixel_m`,
      `size`, `x0` (left edge) and `y0` (top edge) in projected meters (`Grid.x0`, `Grid.y0`).
- [x] Fail with a message if a window is cut by the edge of the DEM or holds a NaN. (All five
      sites fit: the farthest, Chandrayaan-3, is 632 km from the pole; the DEM reaches 931 km.)
- [x] `web/scripts/build-data.mjs` copies both files and sets `terrain: true` on the site in
      `manifest.json`.
- [x] Run for the five sites and commit the outputs in `data/` (about 4.3 MB in total).
- [x] Optional: `horizon_range_km` for every point of `grid_<site>.json` (720 values per
      point, km to 2 decimals, as in `horizon_<site>.json`). It enables the mast estimate
      after a hop (phase 6). `compute_grid` / `grid_to_json` now return it, so the terrain
      service does too (live service redeployed 2026-11-15 and checked; the field is
      optional in `TerrainPoint`). The five files were not regenerated: the ranges were
      merged into them, so slopes and every other value are unchanged (a full re-run would
      switch the slopes to the 60 m map, an open team decision in `CLAUDE.md`). Checked:
      the fresh horizons equal the stored ones at all 405 points, and the center point's
      ranges equal `horizon_<site>.json`. Files grew from about 0.45 to 0.76 MB each.

Checked on 2026-11-15: `ground_height_m` equals `horizon_<site>.json` at all five sites; a
skyline marched over the four levels (finest level that holds the point) against
`horizon_deg` differs by at most 0.12 deg (mean 0.003 to 0.03 deg); the vertex formula
below equals `xy_to_latlon` to 1e-12; a point at 61 S fails with the edge message and writes
nothing. `npm run data` copies the files and sets `terrain: true`; `npm run validate` passes.
In the `.bin` the levels start at Float32 offsets 0, 65 536, 131 072 and 196 608.

`feat(backend): export nested terrain patches for the surface view`

## Frontend architecture

New code in `web/src/`:

- `state/mode.ts`: `"plan" | "explore"`, surface view open or closed, heading and pitch; a
  small external store like `state/scenario.ts`. `state/url.ts` reads and writes `mode`,
  `view` and `step`.
- `data/load.ts` (addition): `loadSiteTerrainPatch(key)`, cached, fetched only when the
  surface view opens.
- `surface/SurfaceView.tsx`: canvas, HTML overlay, look controls; the lazy entry point.
- `surface/scene.ts`: renderer, camera, draw order, on-demand drawing, resize, dispose.
- `surface/terrain.ts`: patch → vertex positions, normals, index buffers, height textures.
- `surface/shadow.ts`: the shadow pass. `surface/sky.ts`: Sun, Earth, stars, skyline curtain.
- `surface/beacons.ts`: neighbouring points and hops. `surface/hud.tsx`: labels per mode.
- `explore/ExplorerShell.tsx`, `explore/Intro.tsx`, `explore/Tour.tsx`, `explore/Game.tsx`,
  `explore/steps.ts` (extends `STORIES`).

Reuse, do not rewrite: `sampleAt`, `useInstant`, `usePlayback`, `horizonAt`,
`SUN_RADIUS_DEG` / `EARTH_RADIUS_DEG`, `terrainDiskFraction`, `obstruction` and `sentence`
(move them out of `charts/HorizonView.tsx` into a shared module), `STORIES` / `applyStory`,
`loadSiteGrid`, `scoreGrid`, `bestPoint`, `betterSpot`, `neighbourPlace`, `offsetText`,
`scanLandingDates`, `verdict`, `CopyLink`, `Segmented`, `Sheet`.

Technical decisions (so nobody has to work them out again):

- **`three` in its own chunk** through `import()`; the Planner's first load must not grow.
  Check the version with `npm view three version` when installing. Labels, pins and buttons
  are HTML over the canvas, not sprites.
- **Scene frame:** x = east, y = up, z = −north, meters, origin on the ground at the site.
  A direction (azimuth clockwise from north, elevation) is
  `(sin az · cos el, sin el, −cos az · cos el)`.
- **Vertices on the sphere.** A pixel center (x, y) of the projection becomes a Moon-fixed
  unit vector `m = (4R·y, 4R·x, s − 4R²) / (s + 4R²)` with `s = x² + y²`, R = 1 737 400 m
  (the inverse of `latlon_to_xy`). The vertex is `(R + h) · m`, expressed in the site's
  east / up / north axes (as in `engine/sky.ts`), minus the site's own position. Curvature
  and the projection's scale are then exact. Compute in Float64, store Float32.
- **Draw order instead of a deep depth buffer.** Stars, Sun, Earth, skyline curtain, then
  the levels from 3 to 0 with the depth buffer cleared before each. The levels are nested
  squares around the observer, so an outer level is always behind an inner one along every
  line of sight. Near and far planes are set per level. An outer level skips the cells that
  lie fully inside the next inner level and keeps one cell of overlap, so no gap opens.
- **Sun and Earth:** true angular radius; the fragment is discarded below the engine's
  horizon at its azimuth (the 720 values as a small texture). The Earth is a shaded sphere,
  so its phase follows from the Sun's direction.
- **Skyline curtain:** the engine's horizon as a dark band behind the mesh. It fills the
  sliver where a coarse far level sits lower than the engine's skyline, and it is the whole
  terrain where no patch exists (custom points, a failed download).
- **Shadow pass:** one small render target per level (same size as the level). For every
  texel, march from the surface point toward the Sun over the height textures. Height of a
  sample point Q above the reference sphere without cancellation:
  `(2·R0·Q.y + |Q|²) / (|Q − C| + R0) + ground`, with `R0 = R + ground` and the Moon's center
  `C = (0, −R0, 0)`. Its projected position: `x = 2R·m.y / (1 − m.z)`,
  `y = 2R·m.x / (1 − m.z)` with `m` the unit vector of Q − C in Moon-fixed axes. Keep the
  smallest angular clearance along the ray; the lit share is a smooth step over ± the Sun's
  radius (the idea of `terrainDiskFraction`). Steps start at one pixel and grow with distance;
  stop when the ray is above the highest terrain. Read heights with four `texelFetch` calls
  (bilinear by hand; float textures cannot be filtered everywhere). Take surface points from
  a position texture written on the CPU, not from float math in the shader.
- **Recompute shadows only when the Sun moves**, at most about 20 times a second during
  playback. Looking around costs nothing.
- **Surface brightness:** mix of Lambert and Lommel–Seeliger (`μ0 / (μ0 + μ)`), one grey
  albedo, a small fill light, exposure that follows the Sun's elevation. Tune by eye.
- **Draw on demand:** when the cursor, the camera or a tween changes. Playback updates the
  scene from the scenario store (the `SkyArrows` pattern), not through React renders.
- **Fallbacks:** no WebGL 2 or the chunk fails → the enlarged `HorizonView`. No patch →
  curtain only.
- **Numbers in the copy come from the engine at run time** (risk 18 → 100, share of
  sunlight, highest Sun elevation). Never type a result into a sentence.
- **Planner stays as it is.** A header control switches the mode; the URL carries
  `mode=explore`. Explorer steps link back with "Open in Planner".

## Claims not to make

- "Water-ice trap": the data is a permanent-shadow mask. Write "permanently shadowed region".
- "~10 min walk": no sourced walking speed. Give distance and the slope on the way.
- "Higher than Mont Blanc": lunar heights are measured from the 1737.4 km reference sphere,
  not from a sea level. Write "5,321 m above the Moon's mean radius".
- Rocks, small craters, surface texture, real star positions: not in the data.
- Free walking: positions are the 81 grid points, because only they have an engine horizon.

## Frontend phases

Estimates are for one developer working with Claude.

### Phase 0: mode switch (about 45 min)

- [x] `state/mode.ts` and the `mode` / `view` / `step` parameters in `state/url.ts`.
- [x] `Planner | Explorer` control in the sites panel header and in the mobile dock.
- [x] Explorer shell: the Planner panels step aside; one stage, a caption area, a transport
      (play, pause, restart).
- [x] Escape and the browser's back button leave the mode.

`feat(web): add the Explorer mode switch`

### Phase 1: surface view with real terrain (about 3 h)

- [x] Add `three`; lazy chunk; WebGL 2 check with the `HorizonView` fallback.
- [x] Camera at eye height (`mastM` above the ground); drag to look (mouse, touch), arrow
      keys, wheel or pinch for the field of view; pitch limited to −85°..+85°.
- [x] Sun, Earth and skyline curtain from the engine (works before phase B is done).
- [x] `loadSiteTerrainPatch`; four levels as meshes with normals; draw order as above.
- [x] Follows the timeline cursor and playback without React renders.
- [x] `Look at Sun` and `Look at Earth`; compass strip along the top edge; marker at the
      edge when a body is outside the view.
- [x] Entry from the Planner: expand button on the horizon chart in the inspector; opens
      over the map; `view=surface` in the URL.
- [x] `prefers-reduced-motion`: no eased camera moves, stepped playback (as `usePlayback`).
- [x] Caption: what is measured (terrain, Sun, Earth) and what is illustrative.

`feat(web): add a first-person 3D surface view`

### Phase 2: light and shadow (about 2 h)

- [x] Shadow pass per level, cached, recomputed when the Sun moves.
- [x] Surface brightness as above; night look when the Sun is hidden; stars then.
- [x] Shadow of the lander at the observer's feet, opposite the Sun, length = height /
      tan(elevation), capped; label with the length.
- [ ] Check on a laptop with integrated graphics; lower the update rate if playback stutters.

`feat(web): light the surface view with terrain shadows`

### Phase 3: Explorer intro, "Stand on the Moon" (about 1.5 h)

- [x] Opens the surface view full screen at the opening site and plays one lunar day (708 h).
- [x] Captions tied to the cursor, values from the data: highest Sun elevation in the window,
      length of the day, where the Earth hangs.
- [x] Contrast with the equator from the Apollo 11 reference (sphere model): highest Sun
      elevation there against here; one day here = 29.5 Earth days.
- [x] Small inset: the Sun's path over the day, pole against equator, on one elevation axis.
- [x] `Start the tour` and `Skip to Planner`.

`feat(web): add the Explorer introduction`

### Phase 4: guided tour (about 1.5 h)

- [x] `explore/steps.ts`: each step = a story (place, date, comparison), one sentence, where
      to look, how much of the window to play.
- [x] Step 1, why the south pole: Mons Mouton against Apollo 11.
- [x] Step 2, ridge or crater floor: connecting ridge against Shackleton (a wall of 20–24°
      all around, the Sun never clears it).
- [x] Step 3, a one-week slip: Mons Mouton on the planned date and 7 days later, same view.
- [x] Step 4, 500 m matters: Malapert A and its best nearby spot.
- [x] Step card: Back, Next, progress dots, `Open in Planner` (same scenario, `mode` removed).
- [x] Each step is a shareable URL (`mode=explore&step=…`).

`feat(web): add the guided tour`

### Phase 5: hopping between grid points (about 2 h)

- [x] Registry of which grid a hopped-to place came from, so `useNearby` keeps the 81 points
      after a hop (today the grid is lost once the place is no longer the site itself).
- [x] Beacons (upright markers) for the eight nearest points and the best spot; label
      `125 m NE · Risk 18`. From 2 m eye height a point 125 m away is only 0.9° below the
      horizontal, so flat ground markers would not be readable.
- [x] Click: the camera moves over the mesh to the point; the engine horizon and the scores
      of that point take over.
- [x] `Back to the site center`; the map pin follows the hop.
- [x] Planner: beacons coloured by risk level. Explorer: only the best spot is marked.

`feat(web): hop between nearby points in the surface view`

### Phase 6: mast lift (about 30 min)

- [x] The camera rises with `mastM`; the near terrain drops by real geometry.
- [x] `Estimate` label from `mast.mode`; disabled with a reason where it is `fixed`
      (hopped-to points, unless phase B's optional item is done).

`feat(web): show the mast height in the surface view`

### Phase 7: labels per mode (about 1.5 h)

- [x] Explorer, Earth card: distance and one-way light delay from `vectors.bin`; ground
      station in view (keep the per-station columns of `stations.bin` in `loadSkyTables`).
- [x] Explorer: permanently shadowed region pin from `surface.psr` (distance, bearing, slope
      on the way), only where the file has it (ridge, Mons Mouton, Shackleton).
- [x] Explorer: the "why" sentence of the horizon chart as a caption.
- [x] Planner: elevation lines at 0°, 5°, 10° and azimuth lines every 30°; the Sun's and the
      Earth's track over the window; the stretch of skyline that blocks a body.
- [x] Readout at the center of the view: azimuth, elevation, skyline height and its distance.

`feat(web): add Explorer and Planner labels to the surface view`

### Phase 8: mini game, "Keep the lander alive for 14 days" (2 to 4 h)

- [x] Pick one of the 81 points and a landing date.
- [x] Rule from the existing profile, stated on screen as a game rule: the lander fails when
      continuous darkness exceeds `battery_survival_h`. No watt-hour model (no sourced numbers).
- [x] The result plays as a time-lapse in the surface view and stops at the failure:
      `Day 4: the Sun set behind the ridge; the battery lasted 50 h`.
- [x] Hint from the engine: `bestPoint` ("try 375 m SE") or `scanLandingDates` ("try 16 Dec").
- [x] Result: days survived, and `Open in Planner` for the same point and date.

`feat(web): add the landing game`

### Phase 9: wrap-up (about 1 h)

- [x] Phone-sized screen: touch look, sheet layout, captions readable, frame rate acceptable.
- [x] Keyboard: every control reachable, visible focus, Escape closes.
- [x] Bundle: `three` and the patches only on demand; Planner first load unchanged.
- [x] `npm run validate`, `npm run lint`, `npm run build`.
- [x] Two Explorer screenshots for the slides.
- [x] `CLAUDE.md` handoff: what was built, known limits.

`docs: record the Explorer mode in the session handoff`

## Order

- Phase B and phase 0 can run at the same time. Phase 1 begins with the Sun, the Earth and
  the curtain, and takes the mesh in when the patch files exist (see the agent
  instructions: generate them if they are missing).
- Then phases 2 to 9 in order. Each starts only when the one before is committed and
  checked in a browser.
- The curtain-only view and the `HorizonView` fallback are runtime fallbacks (no patch for
  the place, no WebGL 2), not a way to skip work.

## Verification

After every phase: `npm run validate`, `npm run lint`, `npm run build`, then in the browser:

- Patch against horizon: sample the mesh skyline from the site at a few azimuths and compare
  with `horizon_deg`; differences should stay within a few tenths of a degree.
- Mons Mouton, landing 2026-12-16: the Sun circles just above the skyline for 14 days; its
  disk goes behind the terrain at 2026-12-30T08:27Z (the sunset in
  `data/metrics_mons_mouton_terrain.json`), the same minute the metric card switches.
- Shackleton: walls 20–24° high all around; the floor stays in shadow for the whole year;
  the Sun never appears.
- Connecting ridge: the ground at the observer's feet is lit while the Shackleton interior
  next to it is black.
- Malapert A: the Earth stays above the northern skyline for the whole window.
- At any paused instant the view and the inspector agree on `sunVisible` and `earthVisible`,
  and the ground under the observer is lit or dark accordingly.
- Apollo 11 and custom points (no patch): curtain only, no error.
- With WebGL disabled the fallback chart appears and the tour still works.

## Summary

Built on 2026-11-15 on Kerem's Mac (not by the unattended agent on Sezer's machine), one
commit per phase on `main`, each pushed: `8dabc15` (0), `7b915b0` (1), `9151f9f` (2),
`8365782` (3 and 4 together), `a393544` (5), `2fb38b2` (6), `a901e4a` (7), `025d584` (8),
then the wrap-up commit.

**What was built**

- Phase 0: `state/mode.ts` (mode, view, step, camera heading / pitch / field of view),
  `mode`, `view`, `step` (1-based) in the URL. Going one level deeper pushes a history entry
  (`history.state.lunarisPushed`), so Escape and the back button leave the Explorer or the
  surface view. `Planner | Explorer` in the sites header, a telescope button in the mobile
  dock. `usePlayback` moved from the timeline to `App`.
- Phase 1: `surface/` (lazy chunk with three.js 0.187): `geometry.ts` (vertices on the
  sphere, the formulas above), `terrain.ts` (levels, skipped inner cells), `sky.ts` (Sun,
  Earth with its phase, glare, stars, the curtain), `scene.ts` (draw order, per-level
  planes), `SurfaceView.tsx` (look controls, compass, edge markers, caption),
  `SurfaceStage.tsx` (lazy load, horizon-chart fallback). Disk sizes per sample from the
  engine. Entry: expand button on the inspector's horizon chart (`view=surface`).
- Phase 2: `surface/shadow.ts`, a GPU march per level as specified (R32F height textures,
  RGBA32F positions, RGBA8 targets), recomputed when the Sun moves, at most every 50 ms.
  The mast's shadow with its true length.
- Phase 3 and 4: `explore/Explorer.tsx`, `steps.ts` (intro and four steps), `facts.ts`
  (every number in the copy), `SunPathInset.tsx`. Each step applies its own scenario
  (`applyScene`, mission parameters back to defaults), plays it and can switch the stage
  between A and B.
- Phase 5: hop registry in `state/nearby.ts` (`hopOrigin`); `terrainFromPoint` keeps
  `horizon_range_km`; beacons, flight and "Back to <site>" in the surface view.
- Phase 6: the Planner's `MastControl` inside the surface view, with a reason when fixed.
- Phase 7: per-station columns in `loadSkyTables` (`stations`), `psr` in `SiteTerrain`,
  `charts/why.ts` (moved out of `HorizonView`), Planner guides / tracks / blocking skyline,
  Explorer Earth card / PSR pin / "why" caption, center readout.
- Phase 8: `explore/game.ts`, `explore/Game.tsx` (step 5 of the Explorer).
- Phase 9: the Explorer is a lazy chunk too (19 kB); phone layout (inset hidden, compact
  mast panel); key codes for zoom; screenshots in `docs/screenshots/`.

**Decisions taken without asking**

- Entering the Explorer (or a step) replaces the scenario on screen with the step's own;
  "Open in Planner" keeps it. The Planner's previous scenario is not restored.
- The ground within 60 to 150 m of the observer takes the engine's lit share instead of the
  shadow texture, so the view and the metric cards cannot disagree under the feet.
- Terrain light is gated by the lowest point of the skyline, not by 0 deg (high ground sees
  the Sun below the horizontal).
- The Earth's distance in the Earth card comes from its apparent disk size (the same
  ephemeris), not from a new table.
- Tracks and guide lines are drawn before the curtain, so the skyline hides them; the
  blocking stretch of skyline is drawn over the terrain.
- No beacons in the game (the best spot would give the answer away). The game's "dark" is
  the engine's (no part of the Sun's disk), so its result matches the risk card's longest
  darkness against the battery.
- The skyline curtain is dark grey, not the terrain's colour; the far mesh covers it nearly
  everywhere.

**Checked (browser pane on the dev server, live terrain API in `.env.local`; screenshots
force frames while the pane is hidden)**

- Mons Mouton: the Sun label turns "behind terrain" between 08:20 and 08:29 on 30 Dec, the
  sunset in `metrics_mons_mouton_terrain.json` is 08:28 (after the disk-radius fix), and
  the metric card switches in the same minute.
- Shackleton: walls about 20 deg all round, all ground in shadow, Sun and Earth behind
  terrain. Malapert A: observer in shadow, stars out, only a distant ridge lit.
- Tour numbers equal the backend: slip 0 -> 100 with 6.6 days dark; Malapert A 100 -> 63 at
  559 m NW; ridge 100 % Sun against 0 % on the floor, walls >= 19.8 deg.
- Hop to Malapert A's best spot: the place, the mesh and the beacons follow; "Back to
  Malapert A" returns. Mast 10 m on the ridge: "recomputed by the terrain service".
- Game at Malapert A, 16 Dec: fails on day 2.1 (landed in shadow); the hint "375 m S" then
  survives 14 days.
- Ridge: PSR pin 796 m S, slope up to 8 deg (backend: 0.80 km, 7.7 deg); Earth card
  distance and light delay; DSN stations.
- Phone size (375 x 812): Explorer layout, no horizontal scroll, touch drag turns the view;
  keyboard: arrows turn the view, focus ring visible, Escape leaves.
- `npm run validate`, `npm run lint` (0 warnings), `npm run build` after every phase.
  Planner first load 677 kB (674 kB before; three.js 579 kB and the Explorer 19 kB are
  separate chunks).

**Known problems / not checked**

- Frame rate during playback on integrated graphics not measured (the pane was hidden, so
  `requestAnimationFrame` was throttled). The shadow pass is the expensive part (four
  256 x 256 targets, up to 420 steps per texel); lower `MAX_STEPS` or the update rate if it
  stutters.
- Custom points and points of a live 5 x 5 grid have no height patch: curtain only, no
  beacons. Apollo 11 and custom points: curtain only, as designed.
- The Planner's surface overlay on a phone (between the dock and the top) was not looked at.
- Surface brightness is tuned by eye; near the observer the 60 m ground looks smooth.
- The 3D view's Sun and Earth sizes follow the ephemeris; the horizon chart still draws
  the mean sizes (it was not touched).

**How to try it**

- `http://localhost:5173/?mode=explore` (intro), `...&step=1` to `step=4` (tour), `step=5`
  (game).
- Planner: select a site, press the expand button on the horizon chart
  (`?site=malapert_a&date=2026-12-16&view=surface`).
