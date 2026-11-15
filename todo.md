# TODO: Explorer mode and the surface view

Plan for an educational "Explorer" mode and a first-person 360° surface view ("Lunar Street
View") in the Lunaris web UI (`web/`). Written 2026-11-15 ~05:00 local from a review of the
code and the data files. A new session must be able to implement it from this file and
`CLAUDE.md` alone.

**Status:** proposed, not started. One commit per phase (Conventional Commits, English, no AI
attribution, no push unless asked). Tick the boxes as the work lands.

## Why

The challenge text names "an educational game" as an accepted format and asks for
accessibility across skill levels, for the Moon/Earth contrast to be apparent, and for an
explanation of why a small change of place or date has a large effect. The Planner answers a
mission planner; nothing on screen yet answers a first-time visitor. Both features run in the
browser on files the page already loads: no backend work, no new data, no API call.

## Is the surface view feasible? Yes, as a data-driven panorama

Street View itself is not a 3D model: it is a 360° panorama per position plus hops between
positions. The data supports exactly that.

| Needed | Available | Where |
|---|---|---|
| Skyline in every direction | 720 azimuths (0.5° step), elevation of the terrain | `horizon_<site>.json`, and every point of `grid_<site>.json` |
| Distance of the skyline | per azimuth, 0.09 to 159 km | `horizon_<site>.json` only (site centre) |
| Ground near the observer | 81 heights and slopes, 125 m apart, ±500 m | `grid_<site>.json` |
| Sun and Earth direction at any instant | interpolated between hourly samples | `sampleAt` in `engine/events.ts` |
| Positions to hop between | the same 81 points, each with its own skyline | `grid_<site>.json` |
| Earth distance, light delay | Earth vector in km | `vectors.bin` |
| Nearest permanently shadowed region | distance, bearing, slope on the way | `surface.psr` in `horizon_<site>.json` (ridge, Mons Mouton, Shackleton; null elsewhere) |

Limits that shape the design (do not hide them, the jury reads the code):

1. **One skyline value per direction.** The files give the first obstruction, not the
   terrain behind it or between 500 m and the skyline. Mountains cannot be drawn as true
   layered 3D. The skyline is drawn as one silhouette; distance may tint it, nothing more.
2. **Grid points have no obstruction distance** (`horizon_range_km` is in the centre file
   only). After a hop the skyline is exact, but distance labels and the mast estimate are not
   available there (`mast.mode === "fixed"`, as in the Planner today).
3. **The ground is 125 m coarse.** Slope and tilt are real; rocks, small craters and surface
   texture are not in the data. Any texture is decoration and is labelled so.
4. **From 2 m eye height, a point 125 m away is 0.9° below the horizontal, 500 m away 0.2°.**
   Neighbouring points do not spread over the ground like Street View arrows; they bunch at
   the horizon. They are drawn as upright beacons, nearest ring and best spot only.
5. **True angular sizes are small.** The Sun's disk is 0.53° wide (about 8 px at a 75° field
   of view), the Earth 1.9°. Disks stay true to scale; a glow makes the Sun findable.

## Decisions

- **The view shows what the engine uses.** The skyline drawn is always `PlaceData.horizon`
  (base, mast estimate or exact from the terrain service), and the Sun and the Earth are
  hidden by drawing the skyline over them. A disk visible in the view while the metric card
  says "In shadow" must be impossible by construction. No second horizon model in the view.
- **Rendering: three.js, loaded lazily.** Real perspective is needed for looking down (shadow,
  ground) and for the mast lift; hand-written projection on a 2D canvas costs more time than
  it saves. `three` goes into its own chunk through `import()` so the Planner's first load
  does not grow. Check the current version with `npm view three version` when installing.
  Labels and pins are HTML positioned over the canvas (existing CSS, real buttons), not
  sprites.
- **Fallback.** No WebGL, or the chunk fails to load: the existing `HorizonView`, enlarged.
  The same fallback is the escape route if phase 1 is not on screen in time (see "Cut rules").
- **One component for both ideas.** The Explorer intro ("Stand on the Moon") is the surface
  view in full screen with scripted playback. Do not build a separate 2D panorama.
- **Render on demand.** Draw when the cursor, the camera or a tween changes; no idle 60 fps
  loop. Playback updates the scene imperatively from the scenario store (the `SkyArrows`
  pattern), not through React renders.
- **Numbers in the copy come from the engine at run time** (risk 18 → 100, share of sunlight,
  highest Sun elevation). Never type a result into a sentence.
- **Planner stays as it is.** A header control switches the mode; the URL carries
  `mode=explore`. Explorer steps link back with "Open in Planner".

## Claims not to make

- "Water-ice trap": the data is a permanent-shadow mask. Write "permanently shadowed region".
- "~10 min walk": no sourced walking speed. Give distance and the slope on the way.
- "Higher than Mont Blanc": lunar heights are measured from the 1737.4 km reference sphere,
  not from a sea level. Write "5,321 m above the Moon's mean radius".
- Layered 3D mountains, real surface texture, real star positions: not in the data.
- Mast lift at a hopped-to point: no obstruction distances there.

## Architecture

New code in `web/src/`:

- `state/mode.ts`: `"plan" | "explore"`, surface view open/closed, heading and pitch; small
  external store like `state/scenario.ts`. `state/url.ts` reads and writes `mode` and `view`.
- `surface/SurfaceView.tsx`: canvas, HTML overlay, look controls; lazy entry point.
- `surface/scene.ts`: renderer, camera, on-demand draw, resize, dispose.
- `surface/skyline.ts`: curtain from the skyline down, rebuilt or tweened when the horizon
  changes. `surface/bodies.ts`: Sun, Earth (with phase), glow, stars.
- `surface/ground.ts`: 9 × 9 mesh, shading, shadow, compass rose.
- `surface/beacons.ts`: neighbouring points, hop. `surface/hud.tsx`: labels per mode.
- `explore/ExplorerShell.tsx`, `explore/Intro.tsx`, `explore/Tour.tsx`, `explore/Game.tsx`,
  `explore/steps.ts` (extends `STORIES`).

Reuse, do not rewrite: `sampleAt`, `useInstant`, `usePlayback`, `horizonAt`,
`SUN_RADIUS_DEG` / `EARTH_RADIUS_DEG`, `obstruction` and `sentence` (move them out of
`charts/HorizonView.tsx` into a shared module), `STORIES` / `applyStory`, `loadSiteGrid`,
`scoreGrid`, `bestPoint`, `betterSpot`, `neighbourPlace`, `offsetText`, `scanLandingDates`,
`verdict`, `CopyLink`, `Segmented`, `Sheet`.

Coordinates: x = east, y = up, z = −north, meters, origin on the ground under the observer.
A direction (azimuth clockwise from north, elevation) is
`(sin az · cos el, sin el, −cos az · cos el)`.

## Phases

Estimates are for one developer working with Claude. Phases 0 to 3 are the product; 4 to 8
are each optional and independent.

### Phase 0: mode switch (about 45 min)

- [ ] `state/mode.ts` and the `mode` / `view` parameters in `state/url.ts`.
- [ ] `Planner | Explorer` control in the sites panel header and in the mobile dock.
- [ ] `EXPLORER_ENABLED` constant that hides the control (the cut rule needs one line).
- [ ] Explorer shell: the Planner panels step aside, a single stage with a caption area and
      a transport (play, pause, restart).
- [ ] Escape and the browser's back button leave the mode.

`feat(web): add the Explorer mode switch`

### Phase 1: surface view core (about 3 h)

- [ ] Add `three`; lazy chunk; WebGL check with the `HorizonView` fallback.
- [ ] Camera at eye height; drag to look (mouse, touch), arrow keys, wheel or pinch for the
      field of view; pitch limited to −85°..+85°.
- [ ] Skyline curtain from `PlaceData.horizon`; sphere model (no terrain) draws a flat horizon.
- [ ] Sun and Earth at true angular radius from `sampleAt`, drawn before the curtain so the
      terrain covers them; glow behind the curtain (gives the halo over a ridge for free).
- [ ] Follows the timeline cursor and playback without React renders.
- [ ] `Look at Sun` and `Look at Earth` buttons; compass strip along the top edge; marker at
      the edge when a body is outside the view.
- [ ] Entry from the Planner: expand button on the horizon chart in the inspector; opens as
      an overlay over the map; `view=surface` in the URL.
- [ ] `prefers-reduced-motion`: no eased camera moves, stepped playback (as `usePlayback`).
- [ ] Caption under the view: what is measured (skyline, slope, Sun, Earth) and what is not.

`feat(web): add a first-person surface view of the skyline, Sun and Earth`

### Phase 2: Explorer intro, "Stand on the Moon" (about 1.5 h)

- [ ] Opens the surface view full screen at the opening site and plays one lunar day (708 h).
- [ ] Captions tied to the cursor, values from the data: highest Sun elevation in the window,
      hours of the day, Earth's position.
- [ ] Contrast with the equator from the existing Apollo 11 reference (sphere model): highest
      Sun elevation there against here; one day here = 29.5 Earth days.
- [ ] Small inset: the Sun's path over the day, pole against equator, on one elevation axis.
- [ ] `Start the tour` and `Skip to Planner`.

`feat(web): add the Explorer introduction`

### Phase 3: guided tour (about 1.5 h)

- [ ] `explore/steps.ts`: each step = a story (place, date, comparison), one sentence, where
      to look, how much of the window to play.
- [ ] Step 1, why the south pole: Mons Mouton against Apollo 11.
- [ ] Step 2, ridge or crater floor: connecting ridge against Shackleton (a wall of 20–24°
      all around, the Sun never clears it).
- [ ] Step 3, a one-week slip: Mons Mouton on the planned date and 7 days later, same view.
- [ ] Step 4, 500 m matters: Malapert A and its best nearby spot.
- [ ] Step card: Back, Next, progress dots, `Open in Planner` (same scenario, `mode` removed).
- [ ] Each step is a shareable URL (`mode=explore&step=…`).

`feat(web): add the guided tour`

**Cut line A. Explorer can ship here.**

### Phase 4: ground, light and shadow (about 1.5 h)

- [ ] 9 × 9 mesh from `grid_<site>.json` under the observer; a flat plane where no grid
      exists (custom points, reference).
- [ ] Faces shaded by the Sun's direction and `solarFraction`; fades into the curtain within
      about 200 m so the coarse mesh never rises above the measured skyline.
- [ ] Shadow of the lander on the ground, opposite the Sun, length = height / tan(elevation),
      capped; hidden while the Sun is hidden. Label with the length.
- [ ] Night: ground and curtain go dark when `sunVisible` is false; stars appear (decorative).
- [ ] Compass rose on the ground at the observer's feet.

`feat(web): add terrain, lighting and the lander's shadow to the surface view`

### Phase 5: hopping between grid points (about 2 h)

- [ ] Registry of which grid a hopped-to place came from, so `useNearby` keeps the 81 points
      after a hop (today the grid is lost once the place is no longer the site itself).
- [ ] Beacons for the eight nearest points and the best spot; label `125 m NE · Risk 18`.
- [ ] Click: short fade and zoom, then the skyline and the scores of the new point.
- [ ] `Back to the site centre`; the map pin follows the hop.
- [ ] Planner: beacons coloured by risk level. Explorer: only the best spot is marked.

`feat(web): hop between nearby points in the surface view`

### Phase 6: mast lift (about 45 min)

- [ ] Camera height follows `mastM`; the skyline tweens between the two profiles.
- [ ] Planner: thin line of the 2 m skyline for comparison.
- [ ] `Estimate` label from `mast.mode`; control disabled with a reason where it is `fixed`.

`feat(web): show the mast height in the surface view`

### Phase 7: labels per mode (about 1.5 h)

- [ ] Explorer, Earth card: distance and one-way light delay from `vectors.bin`; ground
      station in view (keep the per-station columns of `stations.bin` in `loadSkyTables`).
- [ ] Explorer: permanently shadowed region pin from `surface.psr` (distance, bearing, slope
      on the way), only where the file has it.
- [ ] Explorer: the "why" sentence of the horizon chart as a caption.
- [ ] Planner: elevation lines at 0°, 5°, 10° and azimuth lines every 30°; the Sun's and the
      Earth's track over the window; the stretch of skyline that blocks a body.
- [ ] Readout at the centre of the view: azimuth, elevation, skyline height and its distance.

`feat(web): add Explorer and Planner labels to the surface view`

### Phase 8: mini game, "Keep the lander alive for 14 days" (2 to 4 h)

- [ ] Pick one of the 81 points and a landing date.
- [ ] Rule from the existing profile, stated on screen as a game rule: the lander fails when
      continuous darkness exceeds `battery_survival_h`. No watt-hour model (no sourced numbers).
- [ ] The result plays as a time-lapse in the surface view and stops at the failure:
      `Day 4: the Sun set behind the ridge; the battery lasted 50 h`.
- [ ] Hint from the engine: `bestPoint` ("try 375 m SE") or `scanLandingDates` ("try 16 Dec").
- [ ] Result: days survived, and `Open in Planner` for the same point and date.

`feat(web): add the landing game`

### Phase 9: wrap-up (about 1 h, always done, also after a cut)

- [ ] Phone-sized screen: touch look, sheet layout, captions readable.
- [ ] Keyboard: every control reachable, visible focus, Escape closes.
- [ ] Bundle: `three` only in the lazy chunk; Planner first load unchanged.
- [ ] `npm run validate`, `npm run lint`, `npm run build`.
- [ ] Two Explorer screenshots for the slides.
- [ ] `CLAUDE.md` handoff: what was built, what was cut, known limits.

`docs: record the Explorer mode in the session handoff`

## Cut rules

- Phase 1 not showing the skyline, the Sun and the Earth correctly after 3 h: drop three.js,
  use the enlarged `HorizonView` as the stage for phases 2 and 3, and go on.
- 15:00 local: anything not working is hidden (`EXPLORER_ENABLED = false` if the mode itself
  is broken) and the Planner is delivered. After that, phase 9 and bug fixes only.
- Phases 4 to 8 start only when the phase before them is committed and checked in a browser.

## Verification

After every phase: `npm run validate`, `npm run lint`, `npm run build`, then in the browser:

- Mons Mouton, landing 2026-12-16: the Sun circles just above the skyline for 14 days; its
  disk goes behind the terrain at 2026-12-30T08:27Z (the sunset in
  `data/metrics_mons_mouton_terrain.json`), the same minute the metric card switches.
- Shackleton: the skyline stands 20–24° high all around; the Sun never appears; night shading.
- Malapert A: the Earth stays above the northern skyline for the whole window.
- Connecting ridge, mast 2 → 10 m: the near skyline drops, sunlight share matches the
  inspector.
- At any paused instant the view and the inspector agree on `sunVisible` and `earthVisible`.
- Apollo 11 (no terrain): flat horizon, the Sun high overhead, no beacons, no error.
- With WebGL disabled the fallback chart appears and the tour still works.
