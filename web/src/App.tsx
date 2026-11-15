import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadSites, type SiteInfo } from "./data/load.ts";
import { fetchTerrainHealth, terrainConfigured } from "./data/terrain.ts";
import { RiskStrip } from "./charts/RiskStrip.tsx";
import { Explorer } from "./explore/Explorer.tsx";
import { SurfaceStage } from "./surface/SurfaceStage.tsx";
import { MoonMap, type Insets, type MapCandidate, type MapPick, type MapPoint, type MapSavedPin, type PinRisk } from "./map/MoonMap.tsx";
import { CompareSummary } from "./panels/CompareSummary.tsx";
import { InspectorPanel } from "./panels/InspectorPanel.tsx";
import { Recommendations } from "./panels/Recommendations.tsx";
import { RiskBadge } from "./panels/RiskBadge.tsx";
import { MissionParametersPanel } from "./panels/MissionParameters.tsx";
import { MobileDock, type SheetId } from "./panels/MobileDock.tsx";
import { SitesPanel } from "./panels/SitesPanel.tsx";
import { TimelineBar } from "./panels/TimelineBar.tsx";
import { betterSpot, neighbourPlace, offsetText, useNearby } from "./state/nearby.ts";
import { usePlaceSeries, useSkyTables } from "./state/placeData.ts";
import { useSiteScores } from "./state/siteScores.ts";
import { actions, customPlace, getScenario, sitePlace, useScenario, type Place } from "./state/scenario.ts";
import type { LimitKey } from "./state/limits.ts";
import { leaveLevel, getMode, modeActions, useMode } from "./state/mode.ts";
import { getSavedPoint, openSavedPoint, useSavedPoints } from "./state/savedPoints.ts";
import { OPENING_SITE } from "./state/stories.ts";
import { readUrl, syncUrl } from "./state/url.ts";
import { usePlayback } from "./state/usePlayback.ts";
import { useViews } from "./state/view.ts";
import { Sheet, type SheetState } from "./ui/Sheet.tsx";
import { MOBILE_QUERY, useMediaQuery } from "./ui/useMediaQuery.ts";

const PANEL_GAP = 16;
/** Distance of the map's own chrome from a panel edge, and from the screen edge without one. */
const CHROME_GAP = 12;
const DOCKED_MIN_WIDTH = 760;
const MOBILE_GAP = 8;
/** Height kept clear above the bottom chrome (the zoom buttons are the tallest). */
const CHROME_ZONE = 140;
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where an element's layout box sits on the screen, ignoring transforms. A panel is measured
 * while it may still be animating in (scale, slide); its rect would be off by that much, and
 * no ResizeObserver fires when the animation ends.
 */
function layoutBox(el: HTMLElement | null | undefined): Box | undefined {
  if (!el) return undefined;
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

/** The basemap ends near 55°S; places north of this are not flown to. */
const MAP_NORTH_LIMIT_DEG = -56;

export default function App() {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<MapPoint | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const paramsRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);

  const placeA = useScenario((s) => s.placeA);
  const placeB = useScenario((s) => s.placeB);
  const { tables, error: tablesError } = useSkyTables();
  const mastM = useScenario((s) => s.mastM);
  const a = usePlaceSeries(tables, placeA, mastM);
  const b = usePlaceSeries(tables, placeB, mastM);
  const views = useViews(a, b);
  const siteScores = useSiteScores(tables, sites);
  const nearby = useNearby(tables, a);
  const mode = useMode((m) => m.mode);
  const surfaceOpen = useMode((m) => m.view === "surface");
  // Mounted here, not in the timeline: the Explorer plays the window without the Planner's panels.
  usePlayback();

  // Start-up: the site list and the tables arrive separately; the scenario in the URL is
  // applied once both are known. The date range comes from the table, never from code.
  // The terrain service sleeps when idle and takes a few seconds to start. Wake it now, so
  // the first custom point does not wait for that. The answer itself is not needed.
  useEffect(() => {
    if (!terrainConfigured()) return;
    const controller = new AbortController();
    fetchTerrainHealth(controller.signal).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    loadSites().then(
      (list) => setSites([...list].sort((x, y) => x.lat - y.lat)),
      (error: Error) => setLoadError(error.message),
    );
  }, []);

  useEffect(() => {
    if (!tables || sites.length === 0) return;
    if (!getScenario().limits) {
      // A first visit (nothing in the link) opens on a site, so the panels are never empty.
      const firstVisit = window.location.search === "";
      const url = readUrl(sites);
      modeActions.restore(url.mode);
      actions.init({ minMs: tables.vectors.startMs, maxMs: tables.endMs }, url.startMs, url.windowHours);
      if (url.mastM !== null) actions.setMast(url.mastM);
      if (url.profileKey) actions.setProfile(url.profileKey);
      for (const [key, value] of Object.entries(url.limitOverrides)) actions.setLimit(key as LimitKey, value);
      const opening = sites.find((site) => site.key === OPENING_SITE);
      if (url.placeA) actions.selectPlace(url.placeA);
      else if (firstVisit && opening) actions.selectPlace(sitePlace(opening));
      if (url.placeA && url.placeB) actions.compareWith(url.placeB);
      if (url.placeA && url.slipDays !== 0) actions.slip(url.slipDays);
    }
    return syncUrl();
  }, [tables, sites]);



  // Narrow screens: the map is full screen and each panel opens as a bottom sheet, one at a
  // time. Wide screens ignore this state (the sheets are `display: contents` there).
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [sheet, setSheet] = useState<{ id: SheetId; state: SheetState } | null>(null);
  const sheetRef = useRef(sheet);
  const showSheet = useCallback((next: { id: SheetId; state: SheetState } | null) => {
    // Kept in a ref as well: the camera reads it in the same event that opens a sheet.
    sheetRef.current = next && next.state !== "closed" ? next : null;
    setSheet(sheetRef.current);
  }, []);
  const sheetState = (id: SheetId): SheetState => (sheet?.id === id ? sheet.state : "closed");
  const onSheetState = (id: SheetId) => (state: SheetState) => showSheet({ id, state });
  const openSheet = useCallback(
    (id: SheetId) => {
      showSheet({ id, state: id === "timeline" || id === "params" ? "full" : "half" });
      // The card covers the lower half: bring the place into the half above it.
      const place = getScenario().placeA;
      if (id === "inspector" && place && place.lat <= MAP_NORTH_LIMIT_DEG) setFlyTarget({ lat: place.lat, lon: place.lon });
    },
    [showSheet],
  );

  const hasInspector = views.length > 0;
  useEffect(() => {
    if (!mobile || (!hasInspector && sheetRef.current?.id === "inspector")) showSheet(null);
  }, [mobile, hasInspector, showSheet]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape inside a popover or a menu closes that, not the panel.
      if (event.key !== "Escape" || (event.target as HTMLElement).closest("[role='dialog'], [role='menu']")) return;
      // The Explorer and the surface view are left first, one level at a time.
      const m = getMode();
      if (m.mode === "explore" || m.view === "surface") {
        leaveLevel();
        return;
      }
      // One step back at a time: an open sheet first, then the comparison, then the selection.
      if (sheetRef.current) showSheet(null);
      else if (getScenario().placeB) actions.clearComparison();
      else actions.selectPlace(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSheet]);

  /**
   * The part of the screen the panels leave free, as distances from each screen edge to the
   * nearest panel edge (0 where nothing is in the way). Docked: sites on the left, landing
   * site on the right, timeline below. Narrow: the dock below, or the open sheet.
   */
  const panelEdges = useCallback(() => {
    const edges = { top: 0, right: 0, bottom: 0, left: 0 };
    const height = window.innerHeight;
    if (window.innerWidth < DOCKED_MIN_WIDTH) {
      // From its layout, not its rect: while a sheet is open the dock is slid down a little
      // (sheet.css), and the space above it must not change with that.
      const dock = dockRef.current;
      edges.bottom = dock ? dock.offsetHeight + parseFloat(getComputedStyle(dock).bottom) : 0;
      const open = sheetRef.current;
      // Read from the state, not the screen: the sheet may still be sliding in.
      // A fit sheet covers its own height; the others half the screen.
      const fitPanel = open?.id === "timeline" ? timelineRef.current : open?.id === "params" ? paramsRef.current : null;
      if (fitPanel) edges.bottom = Math.max(edges.bottom, fitPanel.parentElement?.offsetHeight ?? 0);
      else if (open) edges.bottom = Math.max(edges.bottom, height / 2);
      return edges;
    }
    const sidebar = layoutBox(sidebarRef.current);
    const inspector = layoutBox(inspectorRef.current);
    const timeline = layoutBox(timelineRef.current);
    if (timeline) edges.bottom = height - timeline.top;
    if (sidebar) edges.left = sidebar.right;
    if (inspector) edges.right = window.innerWidth - inspector.left;
    return edges;
  }, []);

  // The map's own chrome (legends, zoom buttons, attribution) stays in the free part,
  // following the panels as they resize, collapse, open and close.
  useLayoutEffect(() => {
    const app = appRef.current!;
    const update = () => {
      const edges = panelEdges();
      const set = (name: string, px: number) => app.style.setProperty(`--chrome-${name}`, `${Math.round(px)}px`);
      if (window.innerWidth < DOCKED_MIN_WIDTH) {
        for (const name of ["top", "right", "left", "top-left", "top-right"]) set(name, MOBILE_GAP);
        set("bottom", edges.bottom + MOBILE_GAP);
        return;
      }
      const height = window.innerHeight;
      const sidebar = layoutBox(sidebarRef.current);
      const inspector = layoutBox(inspectorRef.current);
      // The bottom chrome steps beside a panel only when that panel reaches down to it
      // (a collapsed sites panel or a short landing-site card leaves the corner free).
      const zoneTop = height - edges.bottom - CHROME_ZONE;
      const beside = (rect: Box | undefined, edge: number) => (rect && rect.bottom > zoneTop ? edge + CHROME_GAP : PANEL_GAP);
      set("bottom", edges.bottom > 0 ? edges.bottom + CHROME_GAP : PANEL_GAP);
      set("left", beside(sidebar, edges.left));
      set("right", beside(inspector, edges.right));
      set("top", PANEL_GAP);
      set("top-left", sidebar ? edges.left + CHROME_GAP : PANEL_GAP);
      set("top-right", inspector ? edges.right + CHROME_GAP : PANEL_GAP);
    };
    update();
    const observer = new ResizeObserver(update);
    // The app itself too: the viewport can change width without a resize event (a scrollbar
    // that comes and goes), and the panels may then only move, not resize.
    for (const ref of [appRef, sidebarRef, inspectorRef, timelineRef, paramsRef, dockRef]) if (ref.current) observer.observe(ref.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [panelEdges, hasInspector, sheet, mobile]);

  const getInsets = useCallback((): Insets => {
    const edges = panelEdges();
    return {
      top: edges.top + PANEL_GAP,
      right: edges.right + PANEL_GAP,
      bottom: edges.bottom + PANEL_GAP,
      left: edges.left + PANEL_GAP,
    };
  }, [panelEdges]);

  /** On narrow screens a place the user picks opens its card, over the lower half. */
  const showCardOnMobile = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) openSheet("inspector");
  }, [openSheet]);

  /** A selection made by the user: assess the place and bring it into view. */
  const choose = useCallback(
    (place: Place) => {
      actions.selectPlace(place);
      showCardOnMobile();
      if (place.lat <= MAP_NORTH_LIMIT_DEG) setFlyTarget({ lat: place.lat, lon: place.lon });
    },
    [showCardOnMobile],
  );

  const siteRisk = useMemo(() => {
    const map = new Map<string, PinRisk>();
    siteScores.byKey.forEach((entry, key) => map.set(key, { overall: entry.score.overall, level: entry.score.level }));
    return map;
  }, [siteScores]);

  // The scored grid around scenario A's place, as heat-map dots.
  const nearbyResult = nearby.state.status === "ready" ? nearby.state.result : null;
  const candidates = useMemo((): MapCandidate[] | null => {
    if (!nearbyResult) return null;
    const { scored, center, grid } = nearbyResult;
    // Marked only when it is worth moving there (the same rule as the suggestion card).
    const best = betterSpot(nearbyResult);
    return scored.map((entry) => ({
      lat: entry.point.lat,
      lon: entry.point.lon,
      level: entry.score.level,
      stepM: grid.step_m,
      best: entry === best,
      center: entry === center,
      label: `${entry === center ? "Here" : offsetText(entry.point)} · Risk ${entry.score.overall.toFixed(0)} · ${entry.score.level}${entry === best ? " · best nearby" : ""}`,
    }));
  }, [nearbyResult]);

  const pickCandidate = useCallback(
    (index: number) => {
      const entry = nearbyResult?.scored[index];
      const origin = getScenario().placeA;
      if (entry && origin) actions.selectPlace(neighbourPlace(origin, entry.point, nearbyResult.grid));
    },
    [nearbyResult],
  );

  // Custom points get their own marker; built-in sites already have a pin.
  const picks = useMemo(() => {
    const list: MapPick[] = [];
    if (placeA?.kind === "custom") list.push({ lat: placeA.lat, lon: placeA.lon, tag: "A" });
    if (placeB?.kind === "custom" && placeB.id !== placeA?.id) list.push({ lat: placeB.lat, lon: placeB.lon, tag: "B" });
    return list;
  }, [placeA, placeB]);

  // Saved points on the map, except the ones on screen as A or B (they have a pick marker).
  const savedPoints = useSavedPoints();
  const savedPins = useMemo(
    (): MapSavedPin[] =>
      savedPoints
        .filter((point) => point.id !== placeA?.id && point.id !== placeB?.id)
        .map((point) => ({ id: point.id, name: point.name, lat: point.lat, lon: point.lon })),
    [savedPoints, placeA, placeB],
  );
  const selectSaved = useCallback(
    (id: string) => {
      const point = getSavedPoint(id);
      if (point) openSavedPoint(point, choose);
    },
    [choose],
  );

  return (
    <div ref={appRef} className="app">
      <MoonMap
        sites={sites}
        selectedKey={placeA?.kind === "site" ? placeA.key : null}
        compareKey={placeB?.kind === "site" ? placeB.key : null}
        hoveredKey={hoveredKey}
        picks={picks}
        savedPins={savedPins}
        onSelectSaved={selectSaved}
        flyTarget={flyTarget}
        views={views}
        siteRisk={siteRisk}
        bestKey={siteScores.bestKey}
        candidates={candidates}
        onPickCandidate={pickCandidate}
        onSelectSite={(key) => {
          const site = sites.find((s) => s.key === key);
          if (site) choose(sitePlace(site));
        }}
        onHoverSite={setHoveredKey}
        onPick={(point) => {
          actions.selectPlace(customPlace(point.lat, point.lon));
          showCardOnMobile();
        }}
        getInsets={getInsets}
      />

      {mode === "explore" ? <Explorer views={views} sites={sites} nearby={nearby} /> : null}

      {mode === "plan" && surfaceOpen && views.length > 0 ? (
        <div className="surface-overlay">
          <SurfaceStage view={views[0]} onClose={leaveLevel} />
        </div>
      ) : null}

      <div className="hud" data-sheet={sheet?.id} hidden={mode === "explore"}>
        <Sheet label="Sites" state={sheetState("sites")} onStateChange={onSheetState("sites")}>
          <SitesPanel
            ref={sidebarRef}
            sites={sites}
            loadError={loadError}
            placeA={placeA}
            placeB={placeB}
            hoveredKey={hoveredKey}
            onHover={setHoveredKey}
            onChoose={choose}
            scores={siteScores}
            views={views}
            mobile={mobile}
          />
        </Sheet>

        {/* Wide screens open these from the sites header as a popover instead. */}
        {mobile ? (
          <Sheet label="Mission parameters" fit state={sheetState("params")} onStateChange={onSheetState("params")}>
            <MissionParametersPanel ref={paramsRef} views={views} />
          </Sheet>
        ) : null}

        {views.length > 0 ? (
          <Sheet label="Details" state={sheetState("inspector")} onStateChange={onSheetState("inspector")}>
            <InspectorPanel ref={inspectorRef} key={views[0].data.place.id} views={views}>
              <RiskBadge views={views} />
              <Recommendations view={views[0]} nearby={nearby} />
            </InspectorPanel>
          </Sheet>
        ) : null}

        <Sheet label="Timeline" fit state={sheetState("timeline")} onStateChange={onSheetState("timeline")}>
          <TimelineBar
            ref={timelineRef}
            a={a}
            b={b}
            macroExtra={views.length > 0 ? <RiskStrip view={views[0]} /> : null}
            summary={views.length > 1 ? <CompareSummary views={views} /> : null}
          />
        </Sheet>

        <MobileDock ref={dockRef} placeA={placeA} onOpen={openSheet} />
        {tablesError ? (
          <p className="hud__error" role="alert">
            Sun and Earth tables could not be loaded ({tablesError}).
          </p>
        ) : null}
      </div>
    </div>
  );
}
