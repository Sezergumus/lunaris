// Loads the precomputed files written by scripts/build-data.mjs.
import type { TerrainGrid } from "../engine/grid.ts";
import type { Horizon, SkySeries } from "../engine/risk.ts";
import type { VectorTable } from "../engine/sky.ts";

export interface SiteInfo {
  key: string;
  name: string;
  lat: number;
  lon: number;
  /** True if a precomputed grid of nearby points exists (see loadSiteGrid). */
  grid?: boolean;
}

interface Manifest {
  start: string;
  stepMinutes: number;
  count: number;
  skyScale: number;
  dsnScale: number;
  stations: string[];
  /** Time axis of the site-independent vectors table; null if it was not built. */
  vectors: { start: string; stepMinutes: number; count: number } | null;
  sites: SiteInfo[];
}

/** Site-independent inputs for custom coordinates and nearby-spot comparison. */
export interface SkyTables {
  vectors: VectorTable;
  /** Highest Moon elevation over the DSN complexes per sample, on the vectors time axis. */
  stationMaxAlt: Float64Array;
  /** Last instant covered; the date picker takes its limits from startMs and endMs. */
  endMs: number;
}

export interface SiteData {
  info: SiteInfo;
  sky: SkySeries;
  horizon: Horizon;
  groundHeightM: number;
  /** 95th-percentile slope inside the landing ellipse, from the LOLA slope map. */
  slopeP95Deg: number | null;
  slopeRadiusM: number | null;
}

export interface Dataset {
  startMs: number;
  stepHours: number;
  count: number;
  /** Last instant covered by the data. */
  endMs: number;
  /** Highest Moon elevation over the DSN complexes per sample. */
  stationMaxAlt: Float64Array;
  sites: SiteData[];
}

const base = `${import.meta.env.BASE_URL}data/`;

async function fetchColumns(file: string, columns: number, count: number, scale: number): Promise<Float64Array[]> {
  const response = await fetch(base + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const raw = new Int32Array(await response.arrayBuffer());
  if (raw.length !== columns * count) throw new Error(`${file}: unexpected size`);
  return Array.from({ length: columns }, (_, c) =>
    Float64Array.from(raw.subarray(c * count, (c + 1) * count), (v) => v / scale),
  );
}

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(base + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function highestPerSample(columns: Float64Array[], count: number): Float64Array {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let best = -90;
    for (const column of columns) if (column[i] > best) best = column[i];
    out[i] = best;
  }
  return out;
}

/**
 * Sun/Earth vectors and the station table for the whole date range (about 1.3 MB).
 * With these, engine/sky.ts gives the sky of any coordinate without a per-site file.
 */
export async function loadSkyTables(): Promise<SkyTables> {
  const manifest = await fetchJson<Manifest>("manifest.json");
  if (!manifest.vectors) throw new Error("the vectors table was not built");
  const { count } = manifest.vectors;
  const startMs = Date.parse(manifest.vectors.start);
  const stepHours = manifest.vectors.stepMinutes / 60;
  const [response, dsn] = await Promise.all([
    fetch(base + "vectors.bin"),
    fetchColumns("stations.bin", manifest.stations.length, count, manifest.dsnScale),
  ]);
  if (!response.ok) throw new Error(`vectors.bin: HTTP ${response.status}`);
  const raw = new Float32Array(await response.arrayBuffer());
  if (raw.length !== 6 * count) throw new Error("vectors.bin: unexpected size");
  const column = (c: number) => raw.subarray(c * count, (c + 1) * count);
  return {
    vectors: {
      startMs,
      stepHours,
      count,
      sun: [column(0), column(1), column(2)],
      earth: [column(3), column(4), column(5)],
    },
    stationMaxAlt: highestPerSample(dsn, count),
    endMs: startMs + (count - 1) * stepHours * 3600000,
  };
}

/** Terrain of a built-in site: what horizon_<site>.json holds, without the sky binaries. */
export interface SiteTerrain {
  horizon: Horizon;
  /** Distance of the obstruction that sets the horizon at each azimuth, kilometers. */
  horizonRangeKm: number[];
  /** Observer height above ground the horizon was computed for, meters. */
  mastM: number;
  groundHeightM: number;
  /** 95th-percentile slope inside the landing ellipse, from the LOLA slope map. */
  slopeP95Deg: number | null;
  slopeRadiusM: number | null;
  /** Largest LOLA height error inside the landing ellipse, meters; null when unknown. */
  heightErrorM: number | null;
}

const terrainCache = new Map<string, Promise<SiteTerrain>>();

/** Horizon profile, obstruction distances and slope statistics of a built-in site. */
export function loadSiteTerrain(key: string): Promise<SiteTerrain> {
  let pending = terrainCache.get(key);
  if (!pending) {
    pending = fetchJson<any>(`horizon_${key}.json`).then((doc) => ({
      horizon: { stepDeg: doc.azimuth_step_deg, horizonDeg: doc.horizon_deg },
      horizonRangeKm: doc.horizon_range_km,
      mastM: doc.mast_m,
      groundHeightM: doc.ground_height_m,
      slopeP95Deg: doc.surface?.slope_lola_deg?.p95 ?? null,
      slopeRadiusM: doc.surface?.radius_m ?? null,
      heightErrorM: doc.surface?.height_error_m?.max ?? null,
    }));
    terrainCache.set(key, pending);
    pending.catch(() => terrainCache.delete(key));
  }
  return pending;
}

/** Precomputed 9 x 9 grid of points around a built-in site (about 0.45 MB). */
export function loadSiteGrid(key: string): Promise<TerrainGrid> {
  return fetchJson<TerrainGrid>(`grid_${key}.json`);
}

/** Site list only (one small file), so the map can show pins before the tables arrive. */
export async function loadSites(): Promise<SiteInfo[]> {
  return (await fetchJson<Manifest>("manifest.json")).sites;
}

export async function loadDataset(): Promise<Dataset> {
  const manifest = await fetchJson<Manifest>("manifest.json");
  const { count } = manifest;
  const startMs = Date.parse(manifest.start);
  const stepHours = manifest.stepMinutes / 60;

  const dsnPromise = fetchColumns("dsn.bin", manifest.stations.length, count, manifest.dsnScale);
  const sitePromises = manifest.sites.map(async (info): Promise<SiteData> => {
    const [columns, doc] = await Promise.all([
      fetchColumns(`sky_${info.key}.bin`, 4, count, manifest.skyScale),
      fetchJson<any>(`horizon_${info.key}.json`),
    ]);
    const [sunAz, sunAlt, earthAz, earthAlt] = columns;
    return {
      info,
      sky: { startMs, stepHours, count, sunAz, sunAlt, earthAz, earthAlt },
      horizon: { stepDeg: doc.azimuth_step_deg, horizonDeg: doc.horizon_deg },
      groundHeightM: doc.ground_height_m,
      slopeP95Deg: doc.surface?.slope_lola_deg?.p95 ?? null,
      slopeRadiusM: doc.surface?.radius_m ?? null,
    };
  });

  const [dsn, sites] = await Promise.all([dsnPromise, Promise.all(sitePromises)]);
  const stationMaxAlt = highestPerSample(dsn, count);
  return { startMs, stepHours, count, endMs: startMs + (count - 1) * stepHours * 3600000, stationMaxAlt, sites };
}
