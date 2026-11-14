// Loads the precomputed files written by scripts/build-data.mjs.
import type { Horizon, SkySeries } from "../engine/risk.ts";

export interface SiteInfo {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

interface Manifest {
  start: string;
  stepMinutes: number;
  count: number;
  skyScale: number;
  dsnScale: number;
  stations: string[];
  sites: SiteInfo[];
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
  const stationMaxAlt = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let best = -90;
    for (const column of dsn) if (column[i] > best) best = column[i];
    stationMaxAlt[i] = best;
  }
  return { startMs, stepHours, count, endMs: startMs + (count - 1) * stepHours * 3600000, stationMaxAlt, sites };
}
