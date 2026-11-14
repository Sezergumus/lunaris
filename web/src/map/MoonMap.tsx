import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import { Minus, Plus, Scan } from "lucide-react";
import "leaflet/dist/leaflet.css";
import type { SiteInfo } from "../data/load.ts";
import type { RiskLevel } from "../engine/risk.ts";
import { formatLat, formatLon, latLonToXY } from "../geo/polar.ts";
import { sampleAt } from "../engine/events.ts";
import { siteTitle } from "../sites.ts";
import { getScenario, subscribeScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { createCapMask, createGraticule } from "./graticule.ts";
import { MAX_ZOOM, MoonSouthPolarCRS, TREK_LAYERS, ZOOM0_M_PER_PX, createTrekLayer, nativeZoomAt } from "./trek.ts";
import { ScaleBar } from "./ScaleBar.tsx";
import { createSkyArrows } from "./SkyArrows.ts";
import { Tip } from "../ui/Tooltip.tsx";
import "./map.css";

export interface MapPoint {
  lat: number;
  lon: number;
}

/** Marker of a custom point; the tag says which scenario it belongs to. */
export interface MapPick extends MapPoint {
  tag: "A" | "B";
}

/** A scored point near scenario A's place, drawn as a dot of the nearby-spot heat map. */
export interface MapCandidate extends MapPoint {
  level: RiskLevel;
  /** Distance between neighbouring grid points, meters. */
  stepM: number;
  /** The best point of the grid. */
  best: boolean;
  /** The grid's center: the place itself. */
  center: boolean;
  /** Tooltip text, e.g. "354 m NE · Risk 12 · Low". */
  label: string;
}

/** Live risk of a built-in site for the mission on screen. */
export interface PinRisk {
  overall: number;
  level: RiskLevel;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface MoonMapProps {
  sites: SiteInfo[];
  /** Site of scenario A. */
  selectedKey: string | null;
  /** Site of scenario B while comparing. */
  compareKey: string | null;
  hoveredKey: string | null;
  /** Custom points on screen. */
  picks: MapPick[];
  /** View request: the map flies there when the object changes. Null leaves the view alone. */
  flyTarget: MapPoint | null;
  /** Scenarios on screen; each gets Sun and Earth direction arrows at its place. */
  views: ScenarioView[];
  /** Live risk per site key, shown on the pins; the best site is highlighted. */
  siteRisk: Map<string, PinRisk>;
  bestKey: string | null;
  /** Scored points around scenario A's place; null = none. */
  candidates: MapCandidate[] | null;
  /** A candidate dot was clicked (index into `candidates`). */
  onPickCandidate: (index: number) => void;
  onSelectSite: (key: string) => void;
  onHoverSite: (key: string | null) => void;
  onPick: (point: MapPoint) => void;
  /** Screen area covered by floating panels; views are centered in what remains. */
  getInsets: () => Insets;
}

/** Half-width of the area shown on first load: every built-in site lies within 640 km of the pole. */
const OVERVIEW_HALF_M = 680_000;
/** Ground width shown when flying to a site. */
const SITE_VIEW_WIDTH_M = 36_000;
/** Panning stops when the view center is this far from the pole (projected meters). */
const PAN_LIMIT_M = 1_700_000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function pinIcon(site: SiteInfo): L.DivIcon {
  return L.divIcon({
    className: "site-pin",
    html: `<span class="site-pin__dot"></span><span class="site-pin__label">${siteTitle(site.name)}<span class="site-pin__risk"></span></span>`,
    iconSize: [0, 0],
  });
}

/** Heat-map colors of the nearby-spot dots; the same hues as the landing-date strip. */
const CANDIDATE_COLOR: Record<RiskLevel, string> = { low: "#30d158", medium: "#ffd60a", high: "#a8403a" };
const LEVEL_WORD: Record<RiskLevel, string> = { low: "low", medium: "medium", high: "high" };

const pickIcon = (tag: "A" | "B") =>
  L.divIcon({ className: `pick-pin pick-pin--${tag.toLowerCase()}`, html: `<span class="pick-pin__ring"></span>`, iconSize: [0, 0] });

/** Map center that puts the projected point (x, y) in the middle of the uncovered area. */
function centerFor(map: L.Map, x: number, y: number, zoom: number, insets: Insets): L.LatLng {
  const metersPerPixel = ZOOM0_M_PER_PX / 2 ** zoom;
  const cx = x - ((insets.left - insets.right) / 2) * metersPerPixel;
  const cy = y + ((insets.top - insets.bottom) / 2) * metersPerPixel;
  return map.options.crs!.unproject(L.point(cx, cy));
}

/** Zoom at which a square of the given half-width fits the uncovered area. */
function zoomToFit(map: L.Map, halfWidthM: number, insets: Insets): number {
  const size = map.getSize();
  const free = Math.max(160, Math.min(size.x - insets.left - insets.right, size.y - insets.top - insets.bottom));
  // Round down to the zoom snap so the area always fits.
  return Math.floor(Math.log2((ZOOM0_M_PER_PX * free) / (2 * halfWidthM)) * 4) / 4;
}

export function MoonMap({
  sites,
  selectedKey,
  compareKey,
  hoveredKey,
  picks,
  flyTarget,
  views,
  siteRisk,
  bestKey,
  candidates,
  onPickCandidate,
  onSelectSite,
  onHoverSite,
  onPick,
  getInsets,
}: MoonMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const markersRef = useRef(new Map<string, L.Marker>());
  // Leaflet handlers are bound once; they read the latest callbacks through this ref.
  const callbacks = useRef({ onSelectSite, onHoverSite, onPick, onPickCandidate, getInsets });
  useLayoutEffect(() => {
    callbacks.current = { onSelectSite, onHoverSite, onPick, onPickCandidate, getInsets };
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current!;
    const instance = L.map(container, {
      crs: MoonSouthPolarCRS,
      minZoom: 1,
      maxZoom: MAX_ZOOM,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      zoomControl: false,
      attributionControl: false,
      // A square around the pole; its two corners are enough for Leaflet's pixel-space clamp
      // because both have the same latitude. It is wider than the basemap so the clamp never
      // forces the pole to the middle of the screen, which would ignore the panel insets.
      maxBounds: L.latLngBounds(
        MoonSouthPolarCRS.unproject(L.point(-PAN_LIMIT_M, -PAN_LIMIT_M)),
        MoonSouthPolarCRS.unproject(L.point(PAN_LIMIT_M, PAN_LIMIT_M)),
      ),
      maxBoundsViscosity: 0.9,
    });

    let errorStreak = 0;
    TREK_LAYERS.forEach((layer, index) => {
      createTrekLayer(layer, index + 1)
        .on("tileload", () => {
          errorStreak = 0;
          setTilesFailing(false);
        })
        .on("tileerror", () => {
          errorStreak += 1;
          if (errorStreak >= 6) setTilesFailing(true);
        })
        .addTo(instance);
    });

    instance.createPane("mask").style.zIndex = "320";
    createCapMask("mask").addTo(instance);
    instance.createPane("graticule").style.zIndex = "350";
    createGraticule("graticule").addTo(instance);

    const insets = callbacks.current.getInsets();
    const zoom = zoomToFit(instance, OVERVIEW_HALF_M, insets);
    instance.setView(centerFor(instance, 0, 0, zoom, insets), zoom, { animate: false });

    const readout = readoutRef.current!;
    instance.on("mousemove", (event: L.LeafletMouseEvent) => {
      readout.dataset.visible = "true";
      readout.querySelector(".readout__lat")!.textContent = formatLat(event.latlng.lat);
      readout.querySelector(".readout__lon")!.textContent = formatLon(event.latlng.lng);
    });
    const hideReadout = () => (readout.dataset.visible = "false");
    container.addEventListener("mouseleave", hideReadout);
    instance.on("click", (event: L.LeafletMouseEvent) => callbacks.current.onPick({ lat: event.latlng.lat, lon: event.latlng.lng }));

    setMap(instance);
    return () => {
      container.removeEventListener("mouseleave", hideReadout);
      instance.remove();
      setMap(null);
    };
  }, []);

  // Site pins.
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;
    for (const site of sites) {
      const marker = L.marker([site.lat, site.lon], { icon: pinIcon(site), title: site.name, keyboard: true, riseOnHover: true, zIndexOffset: 1000 })
        .on("click", () => callbacks.current.onSelectSite(site.key))
        .on("mouseover", () => callbacks.current.onHoverSite(site.key))
        .on("mouseout", () => callbacks.current.onHoverSite(null))
        .addTo(map);
      markers.set(site.key, marker);
    }
    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
    };
  }, [map, sites]);

  // Pin states and label placement. Labels are placed in priority order (selected, hovered, then
  // list order); a label that would cover another pin or an already placed label is hidden.
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;
    markers.forEach((marker, key) => {
      const element = marker.getElement();
      element?.classList.toggle("is-selected", key === selectedKey);
      element?.classList.toggle("is-compare", key === compareKey && key !== selectedKey);
      element?.classList.toggle("is-hovered", key === hoveredKey);
      // Live risk for the mission on screen: level ring on the dot, score in the label.
      const risk = siteRisk.get(key);
      element?.classList.toggle("is-best", key === bestKey);
      if (element) {
        if (risk) element.dataset.level = risk.level;
        else delete element.dataset.level;
        const text = element.querySelector<HTMLElement>(".site-pin__risk");
        if (text) {
          text.textContent = risk ? `${key === bestKey ? "Best · " : ""}${risk.overall.toFixed(0)}` : "";
          text.title = risk ? `Risk ${risk.overall.toFixed(0)}, ${LEVEL_WORD[risk.level]}` : "";
        }
      }
      marker.setZIndexOffset(key === selectedKey ? 2000 : key === compareKey ? 1800 : key === hoveredKey ? 1500 : key === bestKey ? 1200 : 1000);
    });

    const rank = (key: string) => (key === selectedKey ? 0 : key === compareKey ? 1 : key === hoveredKey ? 2 : key === bestKey ? 3 : 4);
    const layout = () => {
      const entries = sites
        .map((site, index) => ({ site, index, element: markers.get(site.key)?.getElement() }))
        .filter((entry): entry is typeof entry & { element: HTMLElement } => Boolean(entry.element))
        .map((entry) => ({ ...entry, point: map.latLngToContainerPoint([entry.site.lat, entry.site.lon]) }))
        .sort((a, b) => rank(a.site.key) - rank(b.site.key) || a.index - b.index);
      const dots = entries.map(({ site, point }) => ({ key: site.key, box: { x: point.x - 8, y: point.y - 8, w: 16, h: 16 } }));
      const placed: Box[] = [];
      for (const { site, element, point } of entries) {
        const label = element.querySelector<HTMLElement>(".site-pin__label")!;
        const box = { x: point.x + 12, y: point.y - 13, w: label.offsetWidth + 2, h: label.offsetHeight + 2 };
        const blocked = placed.some((other) => overlaps(box, other)) || dots.some((dot) => dot.key !== site.key && overlaps(box, dot.box));
        label.classList.toggle("is-collapsed", blocked);
        if (!blocked) placed.push(box);
      }
    };
    layout();
    map.on("zoom zoomend viewreset", layout);
    return () => {
      map.off("zoom zoomend viewreset", layout);
    };
  }, [selectedKey, compareKey, hoveredKey, sites, map, siteRisk, bestKey]);

  // Nearby-spot heat map: one dot per scored grid point. The dots follow the ground spacing
  // of the grid (a little under half a step in radius, at least 2 px) and are drawn once
  // neighbours are a few pixels apart. The best point always gets a marker of fixed screen
  // size, so it can be found from the whole-region view.
  useEffect(() => {
    if (!map || !candidates || candidates.length === 0) return;
    const pick = (index: number) => () => callbacks.current.onPickCandidate(index);
    const tooltip: L.TooltipOptions = { direction: "top", className: "candidate-tip", offset: [0, -6] };
    const heat = L.layerGroup();
    const dots = candidates.map((candidate, index) => {
      const dot = L.circleMarker([candidate.lat, candidate.lon], {
        radius: 2,
        stroke: candidate.center,
        color: "rgba(255, 255, 255, 0.8)",
        weight: 1,
        fillColor: CANDIDATE_COLOR[candidate.level],
        fillOpacity: 0.6,
        className: "candidate",
        // A click on a dot must not also count as a click on the map.
        bubblingMouseEvents: false,
      });
      dot.bindTooltip(candidate.label, tooltip);
      if (!candidate.center) dot.on("click", pick(index));
      dot.addTo(heat);
      return dot;
    });

    const bestIndex = candidates.findIndex((candidate) => candidate.best && !candidate.center);
    const best = bestIndex >= 0 ? candidates[bestIndex] : null;
    const bestMarker = best
      ? L.circleMarker([best.lat, best.lon], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: CANDIDATE_COLOR[best.level],
          fillOpacity: 1,
          className: "candidate candidate--best",
          bubblingMouseEvents: false,
        })
          .bindTooltip(best.label, tooltip)
          .on("click", pick(bestIndex))
      : null;

    const stepM = candidates[0].stepM;
    const update = () => {
      const stepPx = stepM / (ZOOM0_M_PER_PX / 2 ** map.getZoom());
      const legible = stepPx >= 2.5;
      if (legible) {
        const radius = Math.max(2, stepPx * 0.42);
        dots.forEach((dot) => dot.setRadius(radius));
        if (!map.hasLayer(heat)) heat.addTo(map);
      } else if (map.hasLayer(heat)) heat.remove();
    };
    update();
    bestMarker?.addTo(map);
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
      heat.remove();
      bestMarker?.remove();
    };
  }, [map, candidates]);

  const flyToPoint = useCallback(
    (lat: number, lon: number, widthM: number) => {
      if (!map) return;
      const [x, y] = latLonToXY(lat, lon);
      const insets = callbacks.current.getInsets();
      // Stop one level past the deepest real tiles, so the basemap is never stretched beyond 2×.
      const zoom = Math.min(zoomToFit(map, widthM / 2, insets), nativeZoomAt(x, y) + 1, MAX_ZOOM);
      const center = centerFor(map, x, y, zoom, insets);
      if (prefersReducedMotion()) map.setView(center, zoom, { animate: false });
      else map.flyTo(center, zoom, { duration: 1.4, easeLinearity: 0.2 });
    },
    [map],
  );

  // Fly where the app asks: a site or point the user picked, never the selection made on load.
  useEffect(() => {
    if (flyTarget) flyToPoint(flyTarget.lat, flyTarget.lon, SITE_VIEW_WIDTH_M);
  }, [flyTarget, flyToPoint]);

  // Markers for custom points.
  useEffect(() => {
    if (!map) return;
    const markers = picks.map((pick) =>
      L.marker([pick.lat, pick.lon], { icon: pickIcon(pick.tag), interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(map),
    );
    return () => markers.forEach((marker) => marker.remove());
  }, [map, picks]);

  // Sun and Earth arrows. They follow the timeline cursor through a direct store
  // subscription, so playback turns them without re-rendering React.
  useEffect(() => {
    if (!map) return;
    const arrows = views
      .filter((view) => view.data.place.kind !== "reference")
      .map((view) => ({ view, layer: createSkyArrows(map, view.data.lat, view.data.lon, view.tag === "B") }));
    let lastOffset = NaN;
    const apply = () => {
      const { offsetMs } = getScenario();
      if (offsetMs === lastOffset) return;
      lastOffset = offsetMs;
      for (const { view, layer } of arrows) layer.update(sampleAt(view.data.series, view.data.sky, view.startMs + offsetMs));
    };
    apply();
    const unsubscribe = subscribeScenario(apply);
    return () => {
      unsubscribe();
      arrows.forEach(({ layer }) => layer.remove());
    };
  }, [map, views]);

  const resetView = () => {
    if (!map) return;
    const insets = getInsets();
    const zoom = zoomToFit(map, OVERVIEW_HALF_M, insets);
    const center = centerFor(map, 0, 0, zoom, insets);
    if (prefersReducedMotion()) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: 1.1, easeLinearity: 0.2 });
  };

  return (
    <div className="moon-map">
      <div ref={containerRef} className="moon-map__canvas" aria-label="Map of the lunar south polar region" />
      <div className="moon-map__vignette" aria-hidden="true" />

      <div className="map-controls glass" role="group" aria-label="Map controls">
        <Tip label="Zoom in" side="right">
          <button type="button" className="map-controls__button" onClick={() => map?.zoomIn()} aria-label="Zoom in">
            <Plus aria-hidden="true" />
          </button>
        </Tip>
        <span className="map-controls__divider" />
        <Tip label="Zoom out" side="right">
          <button type="button" className="map-controls__button" onClick={() => map?.zoomOut()} aria-label="Zoom out">
            <Minus aria-hidden="true" />
          </button>
        </Tip>
        <span className="map-controls__divider" />
        <Tip label="Show the whole south polar region" side="right">
          <button type="button" className="map-controls__button" onClick={resetView} aria-label="Show the whole south polar region">
            <Scan aria-hidden="true" />
          </button>
        </Tip>
      </div>

      <div className="map-footer">
        <div ref={readoutRef} className="readout glass" data-visible="false" aria-hidden="true">
          <span className="readout__lat" />
          <span className="readout__lon" />
        </div>
        {map && <ScaleBar map={map} />}
        {views.some((view) => view.data.place.kind !== "reference") ? (
          <div className="arrow-legend glass">
            <span className="arrow-legend__item">
              <svg viewBox="0 0 22 6" aria-hidden="true">
                <path className="arrow-legend__sun" d="M1,3H21" />
              </svg>
              Sun
            </span>
            <span className="arrow-legend__item">
              <svg viewBox="0 0 22 6" aria-hidden="true">
                <path className="arrow-legend__earth" d="M1,3H21" />
              </svg>
              Earth
            </span>
            <span className="arrow-legend__note">faded = below the horizon</span>
          </div>
        ) : null}
      </div>

      <div className="map-attribution">
        {tilesFailing ? (
          <span className="map-attribution__warning" role="status">
            Moon Trek tiles are not responding
          </span>
        ) : null}
        <span>
          Basemap:{" "}
          <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">
            NASA Moon Trek
          </a>{" "}
          · LRO LOLA hillshade
        </span>
      </div>
    </div>
  );
}
