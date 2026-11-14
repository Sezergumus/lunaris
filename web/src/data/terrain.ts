// Client of the terrain service (api/main.py): horizon profiles for coordinates that have
// no precomputed file. Everything else (Sun/Earth angles, risk, date scans) is computed in
// the browser, so the page keeps working on the sphere model when the service is down.
//
// The service address comes from the build-time variable VITE_TERRAIN_API, for example
// VITE_TERRAIN_API=http://localhost:8000 in web/.env.local. Without it the service counts
// as unavailable.
import type { TerrainGrid } from "../engine/grid.ts";

const apiBase: string | undefined = import.meta.env.VITE_TERRAIN_API?.replace(/\/+$/, "");

/** Largest grid the service computes on request. */
export const MAX_LIVE_GRID = 5;

export interface HorizonQuery {
  lat: number;
  lon: number;
  /** Points per side of the square (odd, at most MAX_LIVE_GRID). Default 1: the point only. */
  grid?: number;
  /** Distance between neighbouring points, meters. */
  step?: number;
  /** Observer height above ground, meters. */
  mast?: number;
  /** Landing precision: radius in which slope is judged, meters. */
  precision?: number;
}

export interface TerrainHealth {
  status: string;
  height: "local" | "remote";
  slope: string;
  roughness: string;
  max_grid: number;
  coverage: string;
}

export type TerrainErrorKind = "unconfigured" | "outside" | "busy" | "unavailable";

export class TerrainError extends Error {
  kind: TerrainErrorKind;
  constructor(kind: TerrainErrorKind, message: string) {
    super(message);
    this.name = "TerrainError";
    this.kind = kind;
  }
}

export function terrainConfigured(): boolean {
  return Boolean(apiBase);
}

/** True where the terrain files have data (60S to the pole, a square in the projection). */
export function insideTerrainCoverage(latDeg: number, lonDeg: number): boolean {
  if (latDeg >= 0) return false;
  const r = 2 * 1_737_400 * Math.tan(((90 + latDeg) * Math.PI) / 360);
  const lon = (lonDeg * Math.PI) / 180;
  return Math.max(Math.abs(r * Math.sin(lon)), Math.abs(r * Math.cos(lon))) < 931_200;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!apiBase) throw new TerrainError("unconfigured", "No terrain service is configured");
  let response: Response;
  try {
    response = await fetch(apiBase + path, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TerrainError("unavailable", "The terrain service cannot be reached");
  }
  if (response.status === 422) throw new TerrainError("outside", "No terrain data for this point");
  if (response.status === 429) throw new TerrainError("busy", "The terrain service is busy");
  if (!response.ok) throw new TerrainError("unavailable", `Terrain service error (HTTP ${response.status})`);
  return (await response.json()) as T;
}

/** Service status; also wakes a sleeping host. Rejects with TerrainError when it is down. */
export function fetchTerrainHealth(signal?: AbortSignal): Promise<TerrainHealth> {
  return request<TerrainHealth>("/health", signal);
}

// A horizon never changes for a coordinate, so answers are kept for the lifetime of the page.
const cache = new Map<string, Promise<TerrainGrid>>();

/**
 * Horizon and slope for a point or a square of points around it.
 * Use the `center` of the answer as the position: the service moves the requested point to
 * the nearest 60 m height pixel. Pass an AbortSignal to drop the request on a newer click.
 */
export function fetchHorizon(query: HorizonQuery, signal?: AbortSignal): Promise<TerrainGrid> {
  const params = new URLSearchParams({
    lat: query.lat.toFixed(6),
    lon: query.lon.toFixed(6),
    grid: String(query.grid ?? 1),
    step: String(query.step ?? 125),
    mast: String(query.mast ?? 2),
    precision: String(query.precision ?? 100),
  });
  const path = `/horizon?${params}`;
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = request<TerrainGrid>(path, signal);
  cache.set(path, pending);
  // A failed or cancelled request must not be remembered.
  pending.catch(() => cache.delete(path));
  return pending;
}
