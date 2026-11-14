// NASA Moon Trek south pole basemap (WMTS, IAU2000:30120 polar stereographic).
//
// Every south pole layer on trek.nasa.gov shares one tile matrix set ("default028mm"): top-left
// corner (-1095930, 1095930) m, 256 px tiles, 8561.953125 m/px at zoom 0, halving per level.
// Layers differ only in coverage and in their deepest zoom level, so they stack on one grid.
// Capabilities: https://trek.nasa.gov/tiles/Moon/SP/<layer>/1.0.0/WMTSCapabilities.xml
import L from "leaflet";
import { MOON_RADIUS_M, latLonToXY, surfaceDistanceM, xyToLatLon } from "../geo/polar.ts";

/** Half-width of the tile grid in projected meters (left/top edge of tile 0/0/0). */
export const GRID_HALF_M = 1_095_930;
/** Ground resolution of zoom level 0 in meters per pixel (ScaleDenominator × 0.28 mm). */
export const ZOOM0_M_PER_PX = 8561.953125;

export interface TrekLayer {
  id: string;
  /** Coverage is the square ±halfExtentM around the pole. */
  halfExtentM: number;
  /** Deepest zoom level the service has tiles for. */
  maxNativeZoom: number;
  /** Resolution of the source DEM the hillshade was made from. */
  sourceResolutionM: number;
}

// Ordered from the widest/coarsest to the narrowest/finest; later layers draw on top.
// The names say 45°/75°/87.5°S, but coverage is the square, which reaches past those latitudes
// toward its corners.
export const TREK_LAYERS: TrekLayer[] = [
  { id: "LRO_LOLA_Shade_SPole45_100mp_v04", halfExtentM: 1_095_930, maxNativeZoom: 4, sourceResolutionM: 100 },
  { id: "LRO_LOLA_Shade_SPole75_30mp_v04", halfExtentM: 457_440, maxNativeZoom: 6, sourceResolutionM: 30 },
  { id: "LRO_LOLA_Shade_SPolar875_10m", halfExtentM: 75_840, maxNativeZoom: 8, sourceResolutionM: 10 },
];

export const MAX_ZOOM = 11;

export function trekTileUrl(layerId: string): string {
  return `https://trek.nasa.gov/tiles/Moon/SP/${layerId}/1.0.0/default/default028mm/{z}/{y}/{x}.png`;
}

/** Finest layer covering a projected point, or null outside the basemap. */
export function finestLayerAt(x: number, y: number): TrekLayer | null {
  let best: TrekLayer | null = null;
  for (const layer of TREK_LAYERS) {
    const covers = Math.abs(x) <= layer.halfExtentM && Math.abs(y) <= layer.halfExtentM;
    if (covers && (!best || layer.maxNativeZoom > best.maxNativeZoom)) best = layer;
  }
  return best;
}

/** Deepest native zoom available at a projected point. */
export function nativeZoomAt(x: number, y: number): number {
  return finestLayerAt(x, y)?.maxNativeZoom ?? 0;
}

const projection: L.Projection = {
  project: (latlng: L.LatLng) => {
    const [x, y] = latLonToXY(latlng.lat, latlng.lng);
    return L.point(x, y);
  },
  unproject: (point: L.Point) => {
    const { lat, lon } = xyToLatLon(point.x, point.y);
    return L.latLng(lat, lon);
  },
  bounds: L.bounds([-GRID_HALF_M, -GRID_HALF_M], [GRID_HALF_M, GRID_HALF_M]),
};

/** Leaflet CRS for the Moon Trek south pole tile grid. */
// L.CRS is a plain object at runtime (typed as a class), so it is extended, not subclassed.
export const MoonSouthPolarCRS = L.Util.extend({}, L.CRS, {
  code: "IAU2000:30120",
  projection,
  // pixel = scale × (x + half, half − y): origin at the grid's top-left corner, y down.
  transformation: new L.Transformation(1, GRID_HALF_M, -1, GRID_HALF_M),
  scale: (zoom: number) => 2 ** zoom / ZOOM0_M_PER_PX,
  zoom: (scale: number) => Math.log2(scale * ZOOM0_M_PER_PX),
  distance: (a: L.LatLng, b: L.LatLng) => surfaceDistanceM(a.lat, a.lng, b.lat, b.lng),
  infinite: false,
  wrapLng: undefined,
  wrapLat: undefined,
  R: MOON_RADIUS_M,
}) as unknown as L.CRS;

interface Coords {
  x: number;
  y: number;
  z: number;
}

/**
 * Tile layer that only requests tiles intersecting the layer's coverage square, so the coarse
 * global layer and the fine polar layers never ask the server for tiles that cannot exist.
 */
const BoundedTileLayer = L.TileLayer.extend({
  _isValidTile(this: L.TileLayer & { options: { halfExtentM: number } }, coords: Coords): boolean {
    const size = 256 * (ZOOM0_M_PER_PX / 2 ** coords.z);
    const x0 = -GRID_HALF_M + coords.x * size;
    const y1 = GRID_HALF_M - coords.y * size;
    const h = this.options.halfExtentM;
    return x0 < h && x0 + size > -h && y1 > -h && y1 - size < h;
  },
}) as unknown as new (url: string, options: L.TileLayerOptions & { halfExtentM: number }) => L.TileLayer;

export function createTrekLayer(layer: TrekLayer, zIndex: number): L.TileLayer {
  return new BoundedTileLayer(trekTileUrl(layer.id), {
    halfExtentM: layer.halfExtentM,
    maxNativeZoom: layer.maxNativeZoom,
    maxZoom: MAX_ZOOM,
    tileSize: 256,
    zIndex,
    // Older tiles stay visible until the new level has loaded, which hides the gap on zoom.
    keepBuffer: 4,
    updateWhenZooming: false,
    crossOrigin: true,
  });
}
