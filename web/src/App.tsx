import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { loadSites, type SiteInfo } from "./data/load.ts";
import { MoonMap, type Insets, type MapPoint } from "./map/MoonMap.tsx";
import { formatLat, formatLon } from "./geo/polar.ts";
import { InspectorPanel } from "./panels/InspectorPanel.tsx";
import { TimelineBar } from "./panels/TimelineBar.tsx";
import { siteSubtitle, siteTitle } from "./sites.ts";
import { usePlaceSeries, useSkyTables } from "./state/placeData.ts";
import { actions, customPlace, sitePlace, useScenario, type Place } from "./state/scenario.ts";
import { useViews } from "./state/view.ts";

const PANEL_GAP = 16;

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
  const ready = useScenario((s) => s.limits !== null);
  const { tables, error: tablesError } = useSkyTables();
  const a = usePlaceSeries(tables, placeA);
  const b = usePlaceSeries(tables, placeB);
  const views = useViews(a, b);

  useEffect(() => {
    loadSites()
      .then((list) => {
        setSites([...list].sort((x, y) => x.lat - y.lat));
        const fromUrl = new URLSearchParams(window.location.search).get("site");
        const initial = list.find((s) => s.key === fromUrl);
        if (initial) actions.selectPlace(sitePlace(initial));
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  // The date range comes from the table, never from code.
  useEffect(() => {
    if (!tables || ready) return;
    const date = new URLSearchParams(window.location.search).get("date");
    const parsed = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
    actions.init({ minMs: tables.vectors.startMs, maxMs: tables.endMs }, Number.isNaN(parsed) ? null : parsed, null);
  }, [tables, ready]);

  // Keep the selected site in the URL so a view can be shared as a link.
  useEffect(() => {
    if (sites.length === 0) return;
    const url = new URL(window.location.href);
    if (placeA?.kind === "site") url.searchParams.set("site", placeA.key);
    else url.searchParams.delete("site");
    window.history.replaceState(null, "", url);
  }, [placeA, sites.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape inside a popover closes the popover, not the panel.
      if (event.key === "Escape" && !(event.target as HTMLElement).closest("[role='dialog']")) actions.selectPlace(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The map's own chrome (scale, zoom buttons, attribution) sits just above the timeline.
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
    if (place.kind !== "reference") setFlyTarget({ lat: place.lat, lon: place.lon });
  }, []);

  const picked = useMemo(() => (placeA?.kind === "custom" ? { lat: placeA.lat, lon: placeA.lon } : null), [placeA]);
  const selectedKey = placeA?.kind === "site" ? placeA.key : null;

  return (
    <div ref={appRef} className="app">
      <MoonMap
        sites={sites}
        selectedKey={selectedKey}
        hoveredKey={hoveredKey}
        picked={picked}
        flyTarget={flyTarget}
        onSelectSite={(key) => {
          const site = sites.find((s) => s.key === key);
          if (site) choose(sitePlace(site));
        }}
        onHoverSite={setHoveredKey}
        onPick={(point) => actions.selectPlace(customPlace(point.lat, point.lon))}
        getInsets={getInsets}
      />

      <div className="hud">
        <aside ref={sidebarRef} className="sidebar glass glass--thick">
          <header className="brand">
            <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 0 0 18" />
            </svg>
            <div>
              <h1 className="brand__name">Lunaris</h1>
              <p className="brand__tagline">Lunar south pole landing sites</p>
            </div>
          </header>

          <section className="site-list" aria-labelledby="site-list-heading">
            <h2 id="site-list-heading" className="section-label">
              Sites
            </h2>
            {loadError ? <p className="site-list__error">Site list could not be loaded ({loadError}).</p> : null}
            <ul>
              {sites.map((site) => {
                const subtitle = siteSubtitle(site.name);
                return (
                  <li key={site.key}>
                    <button
                      type="button"
                      className="site-row"
                      aria-pressed={selectedKey === site.key}
                      data-hovered={hoveredKey === site.key}
                      onClick={() => choose(sitePlace(site))}
                      onPointerEnter={() => setHoveredKey(site.key)}
                      onPointerLeave={() => setHoveredKey(null)}
                      onFocus={() => setHoveredKey(site.key)}
                      onBlur={() => setHoveredKey(null)}
                    >
                      <span className="site-row__dot" aria-hidden="true" />
                      <span className="site-row__text">
                        <span className="site-row__title">{siteTitle(site.name)}</span>
                        {subtitle ? <span className="site-row__subtitle">{subtitle}</span> : null}
                      </span>
                      <span className="site-row__coords">
                        <span>{formatLat(site.lat)}</span>
                        <span>{formatLon(site.lon)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="sidebar__hint">
            <MousePointerClick aria-hidden="true" />
            Click anywhere on the map to inspect a location.
          </p>
        </aside>

        {views.length > 0 ? <InspectorPanel ref={inspectorRef} key={views[0].data.place.id} views={views} /> : null}

        <TimelineBar ref={timelineRef} a={a} b={b} />
        {tablesError ? (
          <p className="hud__error" role="alert">
            Sun and Earth tables could not be loaded ({tablesError}).
          </p>
        ) : null}
      </div>
    </div>
  );
}
