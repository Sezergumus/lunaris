// Custom points the user saved, kept in the browser (localStorage), at most MAX_SAVED_POINTS.
//
// Each point keeps the terrain the service returned for it (horizon profile and slope,
// about 4 KB), so opening it again, on any date, sends no request to the terrain service.
// It also keeps the landing date and mission length it was saved with.
import { useSyncExternalStore } from "react";
import type { SiteTerrain } from "../data/load.ts";
import { actions, customPlace, type Place } from "./scenario.ts";

export const MAX_SAVED_POINTS = 10;
const STORAGE_KEY = "lunaris.savedPoints.v1";

export interface SavedPoint {
  /** Same id as the custom place: `custom:<lat>,<lon>`. */
  id: string;
  name: string;
  /** Position assessed (the service's snapped center when there was one). */
  lat: number;
  lon: number;
  /** Landing date and mission length on screen when the point was saved. */
  savedStartMs: number;
  savedWindowHours: number;
  /** Terrain from the service; null = the point was assessed on the sphere model. */
  terrain: SiteTerrain | null;
}

/** Plain JSON shape of a terrain: typed arrays and ArrayLike values become arrays. */
function storableTerrain(terrain: SiteTerrain): SiteTerrain {
  return {
    ...terrain,
    horizon: { stepDeg: terrain.horizon.stepDeg, horizonDeg: Array.from(terrain.horizon.horizonDeg) },
    horizonRangeKm: Array.from(terrain.horizonRangeKm),
  };
}

function isSavedPoint(value: unknown): value is SavedPoint {
  const p = value as SavedPoint;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Number.isFinite(p.savedStartMs) &&
    Number.isFinite(p.savedWindowHours) &&
    (p.terrain === null || (typeof p.terrain === "object" && Array.isArray(p.terrain.horizon?.horizonDeg)))
  );
}

function read(): SavedPoint[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedPoint).slice(0, MAX_SAVED_POINTS) : [];
  } catch {
    return [];
  }
}

let points: SavedPoint[] = read();
const listeners = new Set<() => void>();

function commit(next: SavedPoint[]) {
  points = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode): the list still works for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab saved or deleted a point.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  points = read();
  listeners.forEach((listener) => listener());
});

export function useSavedPoints(): SavedPoint[] {
  return useSyncExternalStore(subscribe, () => points);
}

export function getSavedPoint(id: string): SavedPoint | undefined {
  return points.find((point) => point.id === id);
}

/** The place a saved point stands for: a custom point with the saved name. */
export function savedPlace(point: SavedPoint): Place {
  return { ...customPlace(point.lat, point.lon), id: point.id, name: point.name };
}

/**
 * Open a saved point as scenario A on the date and with the mission length it was saved
 * with. `choose` is the app's selection (assess, open the card on phones, fly there).
 */
export function openSavedPoint(point: SavedPoint, choose: (place: Place) => void) {
  choose(savedPlace(point));
  actions.setWindowHours(point.savedWindowHours);
  actions.setStart(point.savedStartMs);
}

/** First "Saved point N" not taken yet. */
function defaultName(): string {
  for (let n = 1; ; n++) {
    const name = `Saved point ${n}`;
    if (!points.some((point) => point.name === name)) return name;
  }
}

export const savedPointActions = {
  /**
   * Save a point; returns the saved entry, or null when the list is full. Saving a point
   * that is already in the list refreshes its terrain, date and length and keeps its name.
   */
  save(entry: { lat: number; lon: number; startMs: number; windowHours: number; terrain: SiteTerrain | null; name?: string }): SavedPoint | null {
    const id = customPlace(entry.lat, entry.lon).id;
    const existing = getSavedPoint(id);
    if (!existing && points.length >= MAX_SAVED_POINTS) return null;
    const point: SavedPoint = {
      id,
      name: existing?.name ?? entry.name ?? defaultName(),
      lat: entry.lat,
      lon: customPlace(entry.lat, entry.lon).lon,
      savedStartMs: entry.startMs,
      savedWindowHours: entry.windowHours,
      terrain: entry.terrain ? storableTerrain(entry.terrain) : (existing?.terrain ?? null),
    };
    commit(existing ? points.map((p) => (p.id === id ? point : p)) : [...points, point]);
    return point;
  },
  rename(id: string, name: string) {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    commit(points.map((point) => (point.id === id ? { ...point, name: trimmed } : point)));
  },
  remove(id: string) {
    commit(points.filter((point) => point.id !== id));
  },
};
