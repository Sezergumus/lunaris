// Nearby spots: every point of a terrain grid around scenario A's place, scored for the
// mission on screen. Feeds the candidate dots on the map and the "Better nearby spot" card.
//
// Built-in sites have a precomputed 9 x 9 grid (125 m apart, +-500 m) and are scored at once.
// For a custom point the terrain service computes a 5 x 5 grid (250 m apart) only when the
// user asks, because it takes about 8 s on the live service.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSiteGrid, type SkyTables } from "../data/load.ts";
import { TerrainError, fetchHorizon, insideTerrainCoverage, terrainConfigured } from "../data/terrain.ts";
import { bestPoint, compassDirection, pointDistanceM, scoreGrid, type ScoredPoint, type TerrainGrid, type TerrainPoint } from "../engine/grid.ts";
import { formatDistance } from "../geo/polar.ts";
import { useEffectiveProfile } from "./limits.ts";
import { rememberTerrain, terrainFromPoint, type PlaceData } from "./placeData.ts";
import { customPlace, placeTitle, useScenario, type Place } from "./scenario.ts";

/** Grid the terrain service computes for a custom point: 5 x 5 points, 250 m apart (+-500 m). */
export const LIVE_GRID = { grid: 5, step: 250 } as const;

export interface NearbyResult {
  grid: TerrainGrid;
  scored: ScoredPoint[];
  /** The grid's own center, scored with the same rules as its neighbours. */
  center: ScoredPoint;
  best: ScoredPoint;
}

export type NearbyState =
  /** No grid for this place (reference, outside the terrain data, no service). */
  | { status: "none" }
  /** A custom point: the grid can be requested. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: NearbyResult };

export interface Nearby {
  state: NearbyState;
  /** Ask the terrain service for the grid of a custom point. */
  scan: () => void;
}

/** Grids already received, by place id, for the lifetime of the page. */
const customGrids = new Map<string, TerrainGrid>();

/** Where a hopped-to point came from: the place whose grid it belongs to, and its own grid point. */
export interface HopOrigin {
  origin: Place;
  grid: TerrainGrid;
  point: TerrainPoint;
}

/** Grid points opened as places of their own, by place id (lifetime of the page). */
const hops = new Map<string, HopOrigin>();

/** The grid a place was hopped to from, if any: its nearby search keeps the same points. */
export function hopOrigin(placeId: string): HopOrigin | null {
  return hops.get(placeId) ?? null;
}

/** The grid point nearest to a position (the place itself, after a hop). */
function nearestScored(scored: ScoredPoint[], lat: number | null, lon: number | null): ScoredPoint {
  if (lat === null || lon === null) return scored[0];
  let best = scored[0];
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const entry of scored) {
    const d = (entry.point.lat - lat) ** 2 + ((entry.point.lon - lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  return best;
}

interface GridState {
  placeId: string;
  grid: TerrainGrid | null;
  error: string | null;
  /** The request this answer belongs to (custom points). */
  attempt?: number;
}

export function useNearby(tables: SkyTables | null, data: PlaceData | null): Nearby {
  const place = data?.place ?? null;
  const [loaded, setLoaded] = useState<GridState | null>(null);
  /** The last "Scan nearby spots" press; a new attempt after an error retries. */
  const [requested, setRequested] = useState<{ placeId: string; attempt: number } | null>(null);
  const startMs = useScenario((s) => s.startMs);
  const profile = useEffectiveProfile();

  const precision = profile.landing_precision_m;
  const scannable = Boolean(place && place.kind === "custom" && !hopOrigin(place.id) && data && terrainConfigured() && insideTerrainCoverage(data.lat, data.lon));
  const lat = data?.lat ?? null;
  const lon = data?.lon ?? null;

  // Built-in sites: the precomputed file.
  useEffect(() => {
    if (!place || place.kind !== "site") return;
    let alive = true;
    loadSiteGrid(place.key).then(
      (grid) => alive && setLoaded({ placeId: place.id, grid, error: null }),
      () => alive && setLoaded({ placeId: place.id, grid: null, error: null }),
    );
    return () => {
      alive = false;
    };
  }, [place]);

  // Custom points: the terrain service, once the user asked.
  const attempt = place && requested?.placeId === place.id ? requested.attempt : null;
  useEffect(() => {
    if (!place || place.kind !== "custom" || attempt === null || lat === null || lon === null || customGrids.has(place.id)) return;
    const controller = new AbortController();
    fetchHorizon({ lat, lon, ...LIVE_GRID, precision }, controller.signal).then(
      (grid) => {
        customGrids.set(place.id, grid);
        if (!controller.signal.aborted) setLoaded({ placeId: place.id, grid, error: null, attempt });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof TerrainError ? error.message : "The terrain service cannot be reached";
        setLoaded({ placeId: place.id, grid: null, error: message, attempt });
      },
    );
    return () => controller.abort();
  }, [place, attempt, lat, lon, precision]);

  const scan = useCallback(() => {
    if (place) setRequested((last) => ({ placeId: place.id, attempt: (last?.attempt ?? 0) + 1 }));
  }, [place]);

  const current = place && loaded?.placeId === place.id ? loaded : null;
  const hop = place ? hopOrigin(place.id) : null;
  const grid = hop?.grid ?? current?.grid ?? (place?.kind === "custom" ? (customGrids.get(place.id) ?? null) : null);
  // A custom point waits for the answer to its latest press.
  const waiting = place?.kind === "custom" && attempt !== null && !grid && current?.attempt !== attempt;

  const result = useMemo((): NearbyResult | null => {
    if (!tables || !grid) return null;
    const scored = scoreGrid(grid, tables.vectors, tables.stationMaxAlt, profile, startMs);
    if (!scored || scored.length === 0) return null;
    // After a hop the grid's center is elsewhere: "here" is the point the place stands on.
    return { grid, scored, center: hop ? nearestScored(scored, lat, lon) : scored[0], best: bestPoint(scored)! };
  }, [tables, grid, profile, startMs, hop, lat, lon]);

  const error = current?.error ?? null;
  // One object per change, so the map redraws its dots only when the scores move.
  return useMemo((): Nearby => {
    let state: NearbyState;
    if (result) state = { status: "ready", result };
    else if (waiting) state = { status: "loading" };
    else if (error) state = { status: "error", message: error };
    else if (scannable && !grid) state = { status: "idle" };
    else state = { status: "none" };
    return { state, scan };
  }, [result, waiting, error, scannable, grid, scan]);
}

/**
 * The best neighbour, if it beats the grid's center: a lower risk, or the same low risk with
 * more usable Sun. At the same medium or high risk more Sun alone is not worth a move.
 */
export function betterSpot(result: NearbyResult): ScoredPoint | null {
  const { best, center } = result;
  if (best === center) return null;
  const riskGain = Math.round(center.score.overall) - Math.round(best.score.overall);
  const sunGain = best.window.power.sunlit_pct - center.window.power.sunlit_pct;
  return riskGain > 0 || (riskGain === 0 && best.score.level === "low" && sunGain >= 1) ? best : null;
}

/** "354 m NE" */
export function offsetText(point: TerrainPoint): string {
  return `${formatDistance(pointDistanceM(point))} ${compassDirection(point.east_m, point.north_m)}`;
}

/**
 * A grid point as a place of its own, named after the place it was found from. Its terrain
 * is remembered, so selecting it needs no request.
 */
export function neighbourPlace(origin: Place, point: TerrainPoint, grid: TerrainGrid): Place {
  // A hop from a hopped-to point is still named after (and offset from) the grid's own place.
  const root = hopOrigin(origin.id)?.origin ?? origin;
  const center = point.east_m === 0 && point.north_m === 0;
  if (center && root.kind === "site") return root;
  const place = { ...customPlace(point.lat, point.lon), name: center ? placeTitle(root) : `${placeTitle(root)} · ${offsetText(point)}` };
  rememberTerrain(place.id, terrainFromPoint(point, grid), { lat: point.lat, lon: point.lon });
  hops.set(place.id, { origin: root, grid, point });
  return place;
}
