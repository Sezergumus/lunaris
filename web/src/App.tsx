import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadSites, type SiteInfo } from "./data/load.ts";
import { RiskStrip } from "./charts/RiskStrip.tsx";
import { MoonMap, type Insets, type MapCandidate, type MapPick, type MapPoint, type PinRisk } from "./map/MoonMap.tsx";
import { CompareSummary } from "./panels/CompareSummary.tsx";
import { InspectorPanel } from "./panels/InspectorPanel.tsx";
import { Recommendations } from "./panels/Recommendations.tsx";
import { RiskBadge } from "./panels/RiskBadge.tsx";
import { SitesPanel } from "./panels/SitesPanel.tsx";
import { TimelineBar } from "./panels/TimelineBar.tsx";
import { betterSpot, neighbourPlace, offsetText, useNearby } from "./state/nearby.ts";
import { usePlaceSeries, useSkyTables } from "./state/placeData.ts";
import { useSiteScores } from "./state/siteScores.ts";
import { actions, customPlace, getScenario, sitePlace, useScenario, type Place } from "./state/scenario.ts";
import type { LimitKey } from "./state/limits.ts";
import { readUrl, syncUrl } from "./state/url.ts";
import { useViews } from "./state/view.ts";

const PANEL_GAP = 16;
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

  const placeA = useScenario((s) => s.placeA);
  const placeB = useScenario((s) => s.placeB);
  const { tables, error: tablesError } = useSkyTables();
  const mastM = useScenario((s) => s.mastM);
  const a = usePlaceSeries(tables, placeA, mastM);
  const b = usePlaceSeries(tables, placeB, mastM);
  const views = useViews(a, b);
  const siteScores = useSiteScores(tables, sites);
  const nearby = useNearby(tables, a);

  // Start-up: the site list and the tables arrive separately; the scenario in the URL is
  // applied once both are known. The date range comes from the table, never from code.
  useEffect(() => {
    loadSites().then(
      (list) => setSites([...list].sort((x, y) => x.lat - y.lat)),
      (error: Error) => setLoadError(error.message),
    );
  }, []);

  useEffect(() => {
    if (!tables || sites.length === 0) return;
    if (!getScenario().limits) {
      const url = readUrl(sites);
      actions.init({ minMs: tables.vectors.startMs, maxMs: tables.endMs }, url.startMs, url.windowHours);
      if (url.mastM !== null) actions.setMast(url.mastM);
      if (url.profileKey) actions.setProfile(url.profileKey);
      for (const [key, value] of Object.entries(url.limitOverrides)) actions.setLimit(key as LimitKey, value);
      if (url.placeA) actions.selectPlace(url.placeA);
      if (url.placeA && url.placeB) actions.compareWith(url.placeB);
      if (url.placeA && url.slipDays !== 0) actions.slip(url.slipDays);
    }
    return syncUrl();
  }, [tables, sites]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape inside a popover or a menu closes that, not the panel.
      if (event.key !== "Escape" || (event.target as HTMLElement).closest("[role='dialog'], [role='menu']")) return;
      // One step back at a time: the comparison first, then the selection.
      if (getScenario().placeB) actions.clearComparison();
      else actions.selectPlace(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The map's own chrome (scale, zoom buttons, legend) sits just above the timeline.
  useLayoutEffect(() => {
    const app = appRef.current!;
    const timeline = timelineRef.current!;
    const update = () => {
      const docked = window.innerWidth >= 760;
      app.style.setProperty("--hud-bottom", docked ? `${timeline.offsetHeight + 12}px` : "0px");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(timeline);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const getInsets = useCallback((): Insets => {
    const insets: Insets = { top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, left: PANEL_GAP };
    const sidebar = sidebarRef.current?.getBoundingClientRect();
    const inspector = inspectorRef.current?.getBoundingClientRect();
    const timeline = timelineRef.current?.getBoundingClientRect();
    const docked = window.innerWidth >= 760;
    if (timeline) insets.bottom = window.innerHeight - timeline.top + PANEL_GAP;
    if (sidebar) {
      if (docked) insets.left = sidebar.right + PANEL_GAP;
      else insets.bottom = window.innerHeight - sidebar.top + PANEL_GAP;
    }
    if (inspector) {
      if (docked) insets.right = window.innerWidth - inspector.left + PANEL_GAP;
      else insets.top = inspector.bottom + PANEL_GAP;
    }
    return insets;
  }, []);

  /** A selection made by the user: assess the place and bring it into view. */
  const choose = useCallback((place: Place) => {
    actions.selectPlace(place);
    if (place.lat <= MAP_NORTH_LIMIT_DEG) setFlyTarget({ lat: place.lat, lon: place.lon });
  }, []);

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

  return (
    <div ref={appRef} className="app">
      <MoonMap
        sites={sites}
        selectedKey={placeA?.kind === "site" ? placeA.key : null}
        compareKey={placeB?.kind === "site" ? placeB.key : null}
        hoveredKey={hoveredKey}
        picks={picks}
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
        onPick={(point) => actions.selectPlace(customPlace(point.lat, point.lon))}
        getInsets={getInsets}
      />

      <div className="hud">
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
        />

        {views.length > 0 ? (
          <InspectorPanel ref={inspectorRef} key={views[0].data.place.id} views={views}>
            <RiskBadge views={views} />
            <Recommendations view={views[0]} nearby={nearby} />
          </InspectorPanel>
        ) : null}

        <TimelineBar
          ref={timelineRef}
          a={a}
          b={b}
          macroExtra={views.length > 0 ? <RiskStrip view={views[0]} /> : null}
          summary={views.length > 1 ? <CompareSummary views={views} /> : null}
        />
        {tablesError ? (
          <p className="hud__error" role="alert">
            Sun and Earth tables could not be loaded ({tablesError}).
          </p>
        ) : null}
      </div>
    </div>
  );
}
