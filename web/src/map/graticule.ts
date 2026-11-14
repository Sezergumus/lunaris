// Latitude rings and meridians drawn over the basemap for orientation.
import L from "leaflet";
import { xyToLatLon } from "../geo/polar.ts";

const RINGS_DEG = [-85, -80, -75, -70, -65];
/** Southern limit of the LOLA DEM used for terrain horizons. */
export const DEM_LIMIT_DEG = -60;
const MERIDIAN_STEP_DEG = 30;

function ring(lat: number): L.LatLng[] {
  const points: L.LatLng[] = [];
  for (let lon = 0; lon <= 360; lon += 1) points.push(L.latLng(lat, lon));
  return points;
}

function label(latlng: L.LatLngExpression, text: string, className: string): L.Marker {
  return L.marker(latlng, {
    icon: L.divIcon({ className: `graticule-label ${className}`, html: `<span>${text}</span>`, iconSize: [0, 0] }),
    interactive: false,
    keyboard: false,
  });
}

/**
 * Fills everything north of the basemap's coverage with the page background, so the map reads
 * as a polar cap with a round edge instead of a square of tiles.
 */
// The widest Moon Trek layer is a square of ±1095.93 km, whose sides reach only 55°S.
export function createCapMask(pane: string, edgeLatDeg = -56): L.Polygon {
  const half = 2_400_000;
  const square = [
    [-half, -half],
    [-half, half],
    [half, half],
    [half, -half],
  ].map(([x, y]) => {
    const { lat, lon } = xyToLatLon(x, y);
    return L.latLng(lat, lon);
  });
  return L.polygon([square, ring(edgeLatDeg)], { pane, interactive: false, className: "cap-mask", weight: 1, fillOpacity: 1 });
}

export function createGraticule(pane: string): L.LayerGroup {
  const group = L.layerGroup();
  const line = { pane, interactive: false, className: "graticule-line", weight: 1 } satisfies L.PolylineOptions;

  for (const lat of RINGS_DEG) {
    L.polyline(ring(lat), line).addTo(group);
    // Ring labels sit on the 0° meridian, below the line, where the map is usually upright.
    label([lat, 0], `${Math.abs(lat)}°S`, "graticule-label--ring").addTo(group);
  }

  L.polyline(ring(DEM_LIMIT_DEG), { ...line, className: "graticule-line graticule-line--limit" }).addTo(group);
  label([DEM_LIMIT_DEG, 0], "60°S · terrain data limit", "graticule-label--limit").addTo(group);

  for (let lon = 0; lon < 360; lon += MERIDIAN_STEP_DEG) {
    L.polyline([L.latLng(-89.5, lon), L.latLng(DEM_LIMIT_DEG, lon)], line).addTo(group);
    if (lon !== 0) label([-63.5, lon], `${lon}°E`, "graticule-label--meridian").addTo(group);
  }
  return group;
}
