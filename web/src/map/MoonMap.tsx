import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SiteInfo } from "../data/load.ts";
import { formatLat, formatLon, latLonToXY } from "../geo/polar.ts";
import { siteTitle } from "../sites.ts";
import { createCapMask, createGraticule } from "./graticule.ts";
import { MAX_ZOOM, MoonSouthPolarCRS, TREK_LAYERS, ZOOM0_M_PER_PX, createTrekLayer, nativeZoomAt } from "./trek.ts";
import { ScaleBar } from "./ScaleBar.tsx";
import "./map.css";

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface MoonMapProps {
  sites: SiteInfo[];
  selectedKey: string | null;
  hoveredKey: string | null;
  picked: MapPoint | null;
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
    html: `<span class="site-pin__dot"></span><span class="site-pin__label">${siteTitle(site.name)}</span>`,
    iconSize: [0, 0],
  });
}

const pickIcon = L.divIcon({ className: "pick-pin", html: `<span class="pick-pin__ring"></span>`, iconSize: [0, 0] });

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

export function MoonMap({ sites, selectedKey, hoveredKey, picked, onSelectSite, onHoverSite, onPick, getInsets }: MoonMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const markersRef = useRef(new Map<string, L.Marker>());
  // Leaflet handlers are bound once; they read the latest callbacks through this ref.
  const callbacks = useRef({ onSelectSite, onHoverSite, onPick, getInsets });
  useLayoutEffect(() => {
    callbacks.current = { onSelectSite, onHoverSite, onPick, getInsets };
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
      element?.classList.toggle("is-hovered", key === hoveredKey);
      marker.setZIndexOffset(key === selectedKey ? 2000 : key === hoveredKey ? 1500 : 1000);
    });

    const rank = (key: string) => (key === selectedKey ? 0 : key === hoveredKey ? 1 : 2);
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
  }, [selectedKey, hoveredKey, sites, map]);

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

  // Fly to the selected site.
  useEffect(() => {
    const site = sites.find((s) => s.key === selectedKey);
    if (site) flyToPoint(site.lat, site.lon, SITE_VIEW_WIDTH_M);
  }, [selectedKey, sites, flyToPoint]);

  // Marker for a clicked point.
  useEffect(() => {
    if (!map || !picked) return;
    const marker = L.marker([picked.lat, picked.lon], { icon: pickIcon, interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, picked]);

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
        <button type="button" className="map-controls__button" onClick={() => map?.zoomIn()} aria-label="Zoom in">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
        <span className="map-controls__divider" />
        <button type="button" className="map-controls__button" onClick={() => map?.zoomOut()} aria-label="Zoom out">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </button>
        <span className="map-controls__divider" />
        <button type="button" className="map-controls__button" onClick={resetView} aria-label="Show the whole south polar region">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5" />
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
          </svg>
        </button>
      </div>

      <div className="map-footer">
        <div ref={readoutRef} className="readout glass" data-visible="false" aria-hidden="true">
          <span className="readout__lat" />
          <span className="readout__lon" />
        </div>
        {map && <ScaleBar map={map} />}
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
