import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MousePointerClick, X } from "lucide-react";
import { loadSites, type SiteInfo } from "./data/load.ts";
import { DEM_LIMIT_DEG } from "./map/graticule.ts";
import { MoonMap, type Insets, type MapPoint } from "./map/MoonMap.tsx";
import { finestLayerAt } from "./map/trek.ts";
import { formatDistance, formatLat, formatLon, latLonToXY, surfaceDistanceM } from "./geo/polar.ts";
import { siteSubtitle, siteTitle } from "./sites.ts";
import { IconButton } from "./ui/Button.tsx";

type Focus = { kind: "site"; key: string } | { kind: "point"; point: MapPoint } | null;

const PANEL_GAP = 16;

/** Finest Moon Trek hillshade covering a point. */
function basemapSourceAt(lat: number, lon: number): string {
  const layer = finestLayerAt(...latLonToXY(lat, lon));
  return layer ? `LOLA hillshade, ${layer.sourceResolutionM} m source` : "Outside the basemap";
}

export default function App() {
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    loadSites()
      .then((list) => {
        setSites([...list].sort((a, b) => a.lat - b.lat));
        const fromUrl = new URLSearchParams(window.location.search).get("site");
        if (fromUrl && list.some((s) => s.key === fromUrl)) setFocus({ kind: "site", key: fromUrl });
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  // Keep the selected site in the URL so a view can be shared as a link.
  useEffect(() => {
    if (sites.length === 0) return;
    const url = new URL(window.location.href);
    if (focus?.kind === "site") url.searchParams.set("site", focus.key);
    else url.searchParams.delete("site");
    window.history.replaceState(null, "", url);
  }, [focus, sites.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const getInsets = useCallback((): Insets => {
    const insets: Insets = { top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, left: PANEL_GAP };
    const sidebar = sidebarRef.current?.getBoundingClientRect();
    const inspector = inspectorRef.current?.getBoundingClientRect();
    const docked = window.innerWidth >= 760;
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

  const selectedSite = focus?.kind === "site" ? (sites.find((s) => s.key === focus.key) ?? null) : null;
  const picked = focus?.kind === "point" ? focus.point : null;

  const inspected = useMemo(() => {
    if (selectedSite) {
      return {
        id: selectedSite.key,
        kicker: "Landing site",
        title: siteTitle(selectedSite.name),
        subtitle: siteSubtitle(selectedSite.name),
        lat: selectedSite.lat,
        lon: selectedSite.lon,
      };
    }
    if (picked) {
      return { id: `${picked.lat},${picked.lon}`, kicker: "Custom point", title: "Selected location", subtitle: null, lat: picked.lat, lon: picked.lon };
    }
    return null;
  }, [selectedSite, picked]);

  return (
    <div className="app">
      <MoonMap
        sites={sites}
        selectedKey={selectedSite?.key ?? null}
        hoveredKey={hoveredKey}
        picked={picked}
        onSelectSite={(key) => setFocus({ kind: "site", key })}
        onHoverSite={setHoveredKey}
        onPick={(point) => setFocus({ kind: "point", point })}
        getInsets={getInsets}
      />

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
                    aria-pressed={selectedSite?.key === site.key}
                    data-hovered={hoveredKey === site.key}
                    onClick={() => setFocus({ kind: "site", key: site.key })}
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

      {inspected ? (
        <aside ref={inspectorRef} key={inspected.id} className="inspector glass glass--thick" aria-label={`${inspected.kicker}: ${inspected.title}`}>
          <header className="inspector__header">
            <div>
              <p className="inspector__kicker">{inspected.kicker}</p>
              <h2 className="inspector__title">{inspected.title}</h2>
              {inspected.subtitle ? <p className="inspector__subtitle">{inspected.subtitle}</p> : null}
            </div>
            <IconButton label="Close" size="sm" tipSide="left" onClick={() => setFocus(null)}>
              <X aria-hidden="true" />
            </IconButton>
          </header>
          <dl className="facts">
            <div>
              <dt>Latitude</dt>
              <dd>{formatLat(inspected.lat, 3)}</dd>
            </div>
            <div>
              <dt>Longitude</dt>
              <dd>{formatLon(inspected.lon, 3)}</dd>
            </div>
            <div>
              <dt>Distance to pole</dt>
              <dd>{formatDistance(surfaceDistanceM(inspected.lat, inspected.lon, -90, 0))}</dd>
            </div>
            <div>
              <dt>Terrain data</dt>
              <dd className={inspected.lat <= DEM_LIMIT_DEG ? undefined : "is-warning"}>
                {inspected.lat <= DEM_LIMIT_DEG ? "LOLA 60 m DEM" : "Sphere model only"}
              </dd>
            </div>
            <div>
              <dt>Basemap</dt>
              <dd>{basemapSourceAt(inspected.lat, inspected.lon)}</dd>
            </div>
          </dl>
        </aside>
      ) : null}
    </div>
  );
}
