// Nearby-spot comparison: score every point of a terrain grid for one mission window.
//
// A grid is the answer of the terrain service (or a precomputed grid_<site>.json): a square
// of points around a center, each with its own horizon profile and slope. Sun and Earth
// directions come from the vectors table, so nothing here needs the server.
import {
  analyzeWindow,
  buildSeries,
  scoreWindow,
  type Horizon,
  type MissionWindow,
  type Profile,
  type Score,
  type StationElevation,
} from "./risk.ts";
import { sampleIndex, skyFromVectors, type VectorTable } from "./sky.ts";

/** One point of a terrain grid, as sent by the terrain service. */
export interface TerrainPoint {
  lat: number;
  lon: number;
  /** Offsets from the grid center, meters. */
  east_m: number;
  north_m: number;
  ground_height_m: number | null;
  mast_m: number;
  azimuth_step_deg: number;
  horizon_deg: number[];
  /** Distance of the terrain that sets the horizon at each azimuth, km. Absent in answers of an older service. */
  horizon_range_km?: number[];
  /** 95th-percentile slope within the landing precision; the value used for the surface score. */
  slope_deg: number | null;
  slope_at_point_deg: number | null;
  /** Same statistic derived from the 60 m height grid. */
  slope_derived_deg: number | null;
  /** Roughness at a 100 m baseline (80S to the pole only); informational, not scored. */
  roughness: number | null;
}

export interface TerrainGrid {
  /** Present in precomputed files of built-in sites only. */
  site?: { key: string; name: string; lat: number; lon: number };
  /** Center actually used; the service moves a requested point to the nearest height pixel. */
  center: { lat: number; lon: number };
  grid: number;
  step_m: number;
  mast_m: number;
  precision_m: number;
  source: string;
  slope_source: string;
  /** False when terrain beyond the edge of the map may be missing from the horizons. */
  horizon_coverage_complete: boolean;
  /** Center first, then row by row from the south-west. */
  points: TerrainPoint[];
}

export interface ScoredPoint {
  point: TerrainPoint;
  window: MissionWindow;
  score: Score;
}

export function pointHorizon(point: TerrainPoint): Horizon {
  return { stepDeg: point.azimuth_step_deg, horizonDeg: point.horizon_deg };
}

/** Distance of a grid point from the grid center, meters. */
export function pointDistanceM(point: TerrainPoint): number {
  return Math.hypot(point.east_m, point.north_m);
}

/** Samples of one mission window on the vectors time axis, with the station column cut to match. */
interface WindowSlice {
  range: { first: number; count: number };
  stations: StationElevation;
}

function windowSlice(vectors: VectorTable, stationMaxAlt: StationElevation, profile: Profile, landingMs: number): WindowSlice | null {
  const first = sampleIndex(vectors, landingMs);
  const count = Math.round((profile.duration_days * 24) / vectors.stepHours);
  if (first < 0 || first + count > vectors.count) return null;
  const stations = stationMaxAlt === null ? null : Array.prototype.slice.call(stationMaxAlt, first, first + count);
  return { range: { first, count }, stations };
}

function scoreInSlice(slice: WindowSlice, vectors: VectorTable, lat: number, lon: number, horizon: Horizon | null, slopeDeg: number | null, profile: Profile) {
  const sky = skyFromVectors(vectors, lat, lon, 0, slice.range);
  const series = buildSeries(sky, horizon, slice.stations, profile);
  const window = analyzeWindow(series, sky.startMs);
  return window ? { window, score: scoreWindow(window, profile, slopeDeg) } : null;
}

/**
 * Indicators and score of one place for the mission window starting at `landingMs`, computed
 * over that window only (a few hundred samples instead of the whole table). Gives the same
 * numbers as buildSeries over the whole table followed by analyzeWindow. `horizon` null =
 * sphere model. Returns null if the window leaves the vectors table.
 */
export function scorePlace(
  vectors: VectorTable,
  stationMaxAlt: StationElevation,
  lat: number,
  lon: number,
  horizon: Horizon | null,
  slopeDeg: number | null,
  profile: Profile,
  landingMs: number,
): { window: MissionWindow; score: Score } | null {
  const slice = windowSlice(vectors, stationMaxAlt, profile, landingMs);
  return slice ? scoreInSlice(slice, vectors, lat, lon, horizon, slopeDeg, profile) : null;
}

/**
 * Score every grid point for the mission window starting at `landingMs`.
 * `stationMaxAlt` must be on the time axis of `vectors` (null = always available).
 * Returns null if the window leaves the vectors table. Order follows `grid.points`.
 */
export function scoreGrid(
  grid: TerrainGrid,
  vectors: VectorTable,
  stationMaxAlt: StationElevation,
  profile: Profile,
  landingMs: number,
): ScoredPoint[] | null {
  const slice = windowSlice(vectors, stationMaxAlt, profile, landingMs);
  if (!slice) return null;
  const scored: ScoredPoint[] = [];
  for (const point of grid.points) {
    const result = scoreInSlice(slice, vectors, point.lat, point.lon, pointHorizon(point), point.slope_deg, profile);
    if (!result) return null;
    scored.push({ point, ...result });
  }
  return scored;
}

/** Eight-point compass direction of a grid offset: "N", "NE", ... */
export function compassDirection(eastM: number, northM: number): string {
  const bearing = (Math.atan2(eastM, northM) * 180) / Math.PI;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][((Math.round(bearing / 45) % 8) + 8) % 8];
}

/**
 * Best point of a scored grid: lowest risk, then most usable Sun, then closest to the center.
 * The same order as the backend's `grid` command.
 */
export function bestPoint(scored: ScoredPoint[]): ScoredPoint | null {
  let best: ScoredPoint | null = null;
  for (const candidate of scored) {
    if (!best) {
      best = candidate;
      continue;
    }
    const byRisk = candidate.score.overall - best.score.overall;
    const bySun = best.window.power.sunlit_pct - candidate.window.power.sunlit_pct;
    const byDistance = pointDistanceM(candidate.point) - pointDistanceM(best.point);
    if (byRisk < 0 || (byRisk === 0 && (bySun < 0 || (bySun === 0 && byDistance < 0)))) best = candidate;
  }
  return best;
}
