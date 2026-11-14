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

// ---------------------------------------------------------------- request queue
//
// The service runs at most two computations at a time and answers HTTP 429 above that. A
// cancelled fetch does not free a slot: the server keeps computing until it is done. So the
// page sends one /horizon request at a time ("single flight"):
//
// - Requests wait in a queue while one is under way.
// - A caller that aborts while its request still waits takes it out of the queue, so the
//   server never sees it. Every new click aborts the previous one, which leaves only the
//   latest point in the queue.
// - A request already sent is never cut off. Its answer is cached (a horizon never changes),
//   and the next request starts only when it has returned.
// - A 429 caused by another visitor is retried once after a short pause.

/** Pause before the single retry of a request the service rejected as busy, milliseconds. */
const BUSY_RETRY_MS = 1500;

interface Job {
  path: string;
  /** Callers still waiting for this answer. */
  waiting: number;
  sent: boolean;
  promise: Promise<TerrainGrid>;
  resolve: (grid: TerrainGrid) => void;
  reject: (error: unknown) => void;
}

/** Answers received; a horizon never changes, so they are kept for the lifetime of the page. */
const answers = new Map<string, TerrainGrid>();
/** Requests waiting or under way, by path. */
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let active: Job | null = null;

const abortError = () => new DOMException("The request was cancelled", "AbortError");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(job: Job) {
  try {
    let grid: TerrainGrid;
    try {
      grid = await request<TerrainGrid>(job.path);
    } catch (error) {
      if (!(error instanceof TerrainError && error.kind === "busy") || job.waiting === 0) throw error;
      await pause(BUSY_RETRY_MS);
      grid = await request<TerrainGrid>(job.path);
    }
    answers.set(job.path, grid);
    job.resolve(grid);
  } catch (error) {
    job.reject(error);
  } finally {
    jobs.delete(job.path);
  }
}

function pump() {
  if (active || queue.length === 0) return;
  const job = queue.shift()!;
  active = job;
  job.sent = true;
  void send(job).finally(() => {
    active = null;
    pump();
  });
}

/** One caller gave up: a request nobody waits for any more is dropped if it was not sent yet. */
function release(job: Job) {
  job.waiting -= 1;
  if (job.waiting > 0 || job.sent) return;
  queue.splice(queue.indexOf(job), 1);
  jobs.delete(job.path);
  job.reject(abortError());
}

function enqueue(path: string): Job {
  let job = jobs.get(path);
  if (!job) {
    let resolve!: Job["resolve"];
    let reject!: Job["reject"];
    const promise = new Promise<TerrainGrid>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Callers get their own promise; this one must not report an unhandled rejection.
    promise.catch(() => undefined);
    job = { path, waiting: 0, sent: false, promise, resolve, reject };
    jobs.set(path, job);
    queue.push(job);
  }
  job.waiting += 1;
  return job;
}

/**
 * Horizon and slope for a point or a square of points around it.
 * Use the `center` of the answer as the position: the service moves the requested point to
 * the nearest 60 m height pixel. Pass an AbortSignal to drop the request on a newer click:
 * the promise then rejects with an AbortError, and a request that was not sent yet never is.
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
  const known = answers.get(path);
  if (known) return Promise.resolve(known);
  if (!apiBase) return Promise.reject(new TerrainError("unconfigured", "No terrain service is configured"));
  if (signal?.aborted) return Promise.reject(abortError());

  const job = enqueue(path);
  pump();
  return new Promise<TerrainGrid>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError());
      release(job);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    job.promise.then(
      (grid) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(grid);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
