# Frontend Planned Changes: HUD Decluttering & Copy Tightening

Implementation plan for decluttering the Lunaris web UI (`web/src/`). All changes below are approved for implementation. Do not alter the underlying risk/sky engine math or URL parameter contracts.

---

## 1. Left Panel (`SitesPanel.tsx`) & Header Controls

### 1.1 Collapsible Sites Panel + Mission Parameters Button
Add two icon-only buttons (`IconButton` with `Tip` tooltips) to the right side of the `.brand` header in `web/src/panels/SitesPanel.tsx`:

1. **Mission Parameters Button (`SlidersHorizontal` icon from `lucide-react`)**
   - **Tooltip:** `"Mission parameters"`
   - **Active indicator:** Show a small accent/warning dot on the button when `Object.keys(limitOverrides).length > 0` or `mastM !== MAST_RANGE_M.min`.
   - **Presentation (Recommended: Radix `Popover`):** Opens a `320px` `.glass.glass--thick` popover anchored below/beside the button (`side="bottom"`, `align="start"`, `collisionPadding={12}`).
     - *Why Popover over in-panel tab:* Works seamlessly even when the Sites panel is collapsed into a compact top bar, and keeps the site list visible when expanded so the user can watch live site risk badges and the `"Best"` tag update while dragging sliders.
   - **Contents of the Mission Parameters Popover:**
     1. **Mission profile selector:** Move or mirror the `Segmented` preset selector (`Generic`, `Solar lander`, `Battery rover`) here so profile selection and limit overrides live together. Add a tooltip or compact one-line note for the active preset's `basis`.
     2. **Mission limits sliders (`LimitsControl`):** The 5 sliders (`battery_survival_h`, `min_sunlit_pct`, `max_comm_outage_h`, `min_daily_contact_h`, `max_slope_deg`) + `Reset` button when edited.
     3. **Mast height slider (`MastControl`):** The `2–15 m` mast height slider (`actions.setMast`), enabled when a place with adjustable terrain is selected (`views.some(v => v.data.mast.mode !== "fixed")`), or always interactive for setting `mastM` in the scenario store with a compact status note.

2. **Collapse / Expand Sites Button (`PanelLeftClose` / `PanelLeftOpen` or `ChevronUp` / `ChevronDown` icon)**
   - **Tooltip:** `"Collapse sites"` when expanded, `"Expand sites"` when collapsed.
   - **Collapsed state behavior:**
     - Hides `.sidebar__scroll` (site list, saved points, reference row, custom coordinates) and `.sidebar__hint`.
     - Shrinks `.sidebar` to its header bar (`align-self: start`), optionally showing a compact pill with the currently selected `placeA` name when collapsed.
     - `getInsets()` in `web/src/App.tsx` reads `sidebarRef.current?.getBoundingClientRect()`; update `getInsets` (or trigger on collapse toggle) so map camera insets adapt to the compact header height/width.

### 1.2 Collapsible Custom Coordinates & Cleaner Site Rows
- **Collapsible Custom Coordinates (`CustomEntry` in `SitesPanel.tsx`):**
  - Instead of keeping the `Lat °S` / `Lon °E` fields and `Assess` / `Compare` buttons permanently expanded, render a compact toggle header/button (`+ Custom coordinates`).
  - Auto-expand when a custom point is active (`placeA?.kind === "custom" || placeB?.kind === "custom"`).
- **Remove Redundant Coordinates from Site Rows (`SiteRow` & `SavedRow` in `SitesPanel.tsx`):**
  - Remove the right-hand `.site-row__coords` (`formatLat` / `formatLon`) column from list rows so titles, risk pills, `"Best"` badges, and subtitles have breathing room. Coordinates remain visible in the right-hand `InspectorPanel` summary.

---

## 2. Right Panel (`InspectorPanel.tsx`) Structure & Removals

In `web/src/App.tsx`, simplify the children passed into `<InspectorPanel>`:
- **Remove `<LimitsControl />`** from `InspectorPanel` (moved to the Mission Parameters popover in the left header).
- **Remove `<MastControl views={views} />`** from `InspectorPanel` (moved to the Mission Parameters popover in the left header).
- **Remove `<Explainer views={views} />`** from the bottom of `InspectorPanel` (either remove completely or move its bullet points into a small `Info` / `CircleHelp` icon tooltip in the inspector header).

---

## 3. Copy Tightening & Text Reduction Across Right Panel

### 3.1 Summary & Horizon Chart (`InspectorPanel.tsx`, `HorizonView.tsx`)
- **Summary model line (`InspectorPanel.tsx`):**
  - Before: `LOLA terrain horizon · 2 m mast, estimate`
  - After: `LOLA terrain · 2 m mast (est.)` (or `LOLA terrain · 2 m mast` when exact/precomputed).
- **Horizon chart caption (`HorizonView.tsx`):**
  - Before: `<figcaption className="hv__caption">{view.data.horizon ? "Terrain horizon" : "Ideal horizon (sphere)"} · north in the middle · heights ×{exaggeration}, disks to that scale</figcaption>`
  - After: Remove `.hv__caption` completely (the model status is already stated immediately above the chart in `.summary__model`, and `N` is marked in the middle of the horizontal axis).

### 3.2 2×2 Metric Cards (`InspectorPanel.tsx`)
- **Solar elevation (`ElevationCell`):**
  - Before: `1.42° above the terrain` / `Panel yield: upright 88% · flat 12%`
  - After: `+1.4° vs terrain` (or `−1.4° vs terrain`) / `Panel: 88% upright · 12% flat`
- **Time to sunset (`SunsetCell`):**
  - Before: `no sunset in the data` / `no sunrise in the data`
  - After: `None in window`
- **Time to Earthset (`EarthsetCell`):**
  - Before: `DTE link: Active` / `DTE link: Blocked · no station`
  - After: `Link: Active` / `Link: No station` (or `Terrain`, `Conjunction`)
- **Longest darkness (`DarknessCell`):**
  - Before: `Within the 50 h battery` / `Exceeds the 50 h battery`
  - After: `≤ 50 h battery` / `> 50 h battery`
  - Before: `Usable Sun 84% of this window`
  - After: `84% sunlit`

### 3.3 Mission Risk Card (`RiskBadge.tsx`)
- **Card heading:**
  - Before: `Mission risk · 14-day mission · 0 best, 100 worst`
  - After: `Mission risk`
- **Map height error line (`.risk__error`):**
  - Before: `With map height error (1.5 m, horizon up to 0.42° higher): 18 · Low`
  - After: `Height error (+1.5 m): 18 · Low` (keep full detail in a `Tip` tooltip on hover).
- **Bottom footnote (`.risk__foot`):**
  - Before: 4–5 lines repeating all numeric limits and the full `PROFILE_PRESETS[profileKey].basis` paragraph.
  - After: Remove `.risk__foot` from `RiskBadge.tsx`. Move `PROFILE_PRESETS[profileKey].basis` to a tooltip on the preset options or a compact one-liner inside the Mission Parameters popover.

### 3.4 Suggestions Card (`Recommendations.tsx`)
- **Card heading:**
  - Before: `Suggestions · for this mission`
  - After: `Suggestions`
- **Better spot row (`spotRow`):**
  - Remove the second line (`Here: Risk 34 · Medium with the same rules (slope within 100 m)`), since the current site's risk is displayed immediately above in `RiskBadge`.
- **Custom scan prompt (`spotRow` idle/loading state):**
  - Before: `25 points 250 m apart from the terrain service, about 8 s`
  - After: `±500 m grid · ~8 s`

### 3.5 Mission Limits Sliders (`LimitsControl.tsx`)
- **Row labels:**
  - Remove inline `.metric__hint` (`· longest time without usable Sun`, `· share of the mission`, etc.) from each slider row so every row fits cleanly on one line (`POWER  Darkness survived` on the left, `50 h` on the right). Optionally keep `limit.hint` as a tooltip or `aria-label`.
- **Footnote (`.limits__note`):**
  - Remove the multi-line scoring explanation (`"Set by the mission profile above. Score: 0 while at most half of a limit is used, 100 at the limit."`).

---

## 4. Files to Touch When Implementing
1. `web/src/panels/SitesPanel.tsx` — Header icon buttons (`Collapse`, `Mission parameters` popover), collapsible `CustomEntry`, coordinate removal in `SiteRow`/`SavedRow`.
2. `web/src/panels/InspectorPanel.tsx` — Remove `LimitsControl`, `MastControl`, `Explainer` from inspector stack; shorten `Summary` and 2×2 metric cell strings.
3. `web/src/charts/HorizonView.tsx` — Remove `.hv__caption`.
4. `web/src/panels/RiskBadge.tsx` — Shorten header and height-error text; remove `.risk__foot`.
5. `web/src/panels/Recommendations.tsx` — Shorten header, remove redundant `"Here: Risk..."` note, shorten scan note.
6. `web/src/panels/LimitsControl.tsx` & `web/src/panels/MastControl.tsx` — Remove inline hints and long footnotes for compact display inside the Mission Parameters popover.
7. `web/src/App.tsx` — Update `<InspectorPanel>` children and ensure `getInsets()` accounts for collapsed sidebar state.
8. `web/src/index.css` & `web/src/panels/panels.css` — Styles for collapsed `.sidebar`, header action buttons, and the Mission Parameters popover.
