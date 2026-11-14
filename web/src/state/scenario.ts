// What is on screen: up to two scenarios (a place and a start date each) and one shared
// position on the timeline.
//
// The state lives in a small external store instead of React state so that, while the
// timeline plays, only the components that read the cursor re-render (useSyncExternalStore
// with a selector), not the whole tree.
import { useSyncExternalStore } from "react";
import type { SiteInfo } from "../data/load.ts";
import type { ProfileKey } from "../engine/risk.ts";
import { siteTitle } from "../sites.ts";
import type { LimitKey, LimitOverrides } from "./limits.ts";

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** A point on the Moon that can be assessed. */
export type Place =
  | { kind: "site"; id: string; key: string; name: string; lat: number; lon: number }
  | { kind: "custom"; id: string; name: string; lat: number; lon: number }
  /** Shown for contrast only: outside the map and the terrain data, sphere model. */
  | { kind: "reference"; id: string; name: string; lat: number; lon: number };

export function sitePlace(site: SiteInfo): Place {
  return { kind: "site", id: `site:${site.key}`, key: site.key, name: site.name, lat: site.lat, lon: site.lon };
}

export function customPlace(lat: number, lon: number): Place {
  const east = ((lon % 360) + 360) % 360;
  return { kind: "custom", id: `custom:${lat.toFixed(4)},${east.toFixed(4)}`, name: "Custom point", lat, lon: east };
}

/** Coordinates from the project's site table (not checked against a primary source). */
export const APOLLO_11: Place = { kind: "reference", id: "ref:apollo11", name: "Apollo 11", lat: 0.674, lon: 23.473 };

export function placeTitle(place: Place): string {
  return place.kind === "site" ? siteTitle(place.name) : place.name;
}

/** Quick choices for the mission length, hours; any whole number of days in WINDOW_DAYS also works. */
export const WINDOW_HOURS = { mission: 336, month: 720 } as const;
/** Mission length the user can type, days. */
export const WINDOW_DAYS = { min: 1, max: 60 } as const;

/** Mission length within WINDOW_DAYS, hours; null for anything else. */
export function validWindowHours(hours: number): number | null {
  return Number.isFinite(hours) && hours >= WINDOW_DAYS.min * 24 && hours <= WINDOW_DAYS.max * 24 ? Math.round(hours) : null;
}
/** Playback speeds in simulated hours per second. */
export const SPEEDS = [6, 24, 72] as const;

export interface ScenarioState {
  /** Scenario A's place; null = nothing selected. */
  placeA: Place | null;
  /** Scenario B's place; null = no comparison. */
  placeB: Place | null;
  /** Start (landing) instant of scenario A. */
  startMs: number;
  /**
   * Scenario B starts this many days after A (negative: before); 0 when two places are
   * compared on one date.
   */
  slipDays: number;
  /** Mission length, hours; also the length of the timeline window. */
  windowHours: number;
  /** Cursor, measured from the start of each scenario's window. */
  offsetMs: number;
  playing: boolean;
  /** Simulated hours per second. */
  speed: number;
  /** Observer (solar panel / antenna) height above ground, meters. */
  mastM: number;
  /** Mission profile: the limits the risk score is judged against. */
  profileKey: ProfileKey;
  /** Limits changed by hand on top of the profile; empty = the profile as it is. */
  limitOverrides: LimitOverrides;
  /** First and last instant of the data; null until the tables have loaded. */
  limits: { minMs: number; maxMs: number } | null;
}

let state: ScenarioState = {
  placeA: null,
  placeB: null,
  startMs: 0,
  slipDays: 0,
  windowHours: WINDOW_HOURS.mission,
  offsetMs: 0,
  playing: false,
  speed: SPEEDS[1],
  mastM: 2,
  profileKey: "generic",
  limitOverrides: {},
  limits: null,
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(patch: Partial<ScenarioState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getScenario(): ScenarioState {
  return state;
}

export { subscribe as subscribeScenario };

/** Subscribe to one value of the store; the component re-renders only when it changes. */
export function useScenario<T>(selector: (state: ScenarioState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

const floorToDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Start that keeps both windows inside the data. */
function clampStart(startMs: number, s: ScenarioState): number {
  if (!s.limits) return startMs;
  const first = s.limits.minMs + Math.max(0, -s.slipDays) * DAY_MS;
  const last = floorToDay(s.limits.maxMs - s.windowHours * HOUR_MS - Math.max(0, s.slipDays) * DAY_MS);
  return Math.min(last, Math.max(first, startMs));
}

/** Slip that keeps scenario B's window inside the data. */
function clampSlip(slipDays: number, s: ScenarioState): number {
  if (!s.limits) return slipDays;
  const later = Math.floor((s.limits.maxMs - s.windowHours * HOUR_MS - s.startMs) / DAY_MS);
  const earlier = -Math.floor((s.startMs - s.limits.minMs) / DAY_MS);
  return Math.max(earlier, Math.min(later, Math.round(slipDays)));
}

export const actions = {
  /** Called once when the tables arrive. `startMs` may come from the URL. */
  init(limits: { minMs: number; maxMs: number }, startMs: number | null, windowHours: number | null) {
    const next = { ...state, limits, windowHours: (windowHours !== null ? validWindowHours(windowHours) : null) ?? state.windowHours };
    // Without a date in the URL, start half a month into the data: the first day rarely
    // shows a whole day/night cycle from its beginning.
    set({ ...next, startMs: clampStart(floorToDay(startMs ?? limits.minMs + 15 * DAY_MS), next) });
  },
  selectPlace(place: Place | null) {
    // Closing A while comparing promotes B, so the screen never shows a lone "B".
    if (!place && state.placeB) set({ placeA: state.placeB, placeB: null, startMs: state.startMs + state.slipDays * DAY_MS, slipDays: 0 });
    else set({ placeA: place, ...(place ? {} : { playing: false }) });
  },
  compareWith(place: Place) {
    if (!state.placeA) set({ placeA: place });
    else set({ placeB: place });
  },
  clearComparison() {
    set({ placeB: null, slipDays: 0 });
  },
  setStart(ms: number) {
    set({ startMs: clampStart(floorToDay(ms), state) });
  },
  /**
   * "The mission slipped": scenario A keeps the original date, B is the same place (or the
   * place already compared) `days` after A's date. The value is set, not added: slipping by
   * 10 shows A + 10 days however often it is pressed.
   */
  slip(days: number) {
    if (!state.placeA) return;
    const next = { ...state, placeB: state.placeB ?? state.placeA };
    set({ placeB: next.placeB, slipDays: clampSlip(days, next) });
  },
  setWindowHours(hours: number) {
    const valid = validWindowHours(hours);
    if (valid === null) return;
    const next = { ...state, windowHours: valid };
    next.slipDays = clampSlip(state.slipDays, next);
    set({
      windowHours: valid,
      slipDays: next.slipDays,
      offsetMs: Math.min(state.offsetMs, valid * HOUR_MS),
      startMs: clampStart(state.startMs, next),
    });
  },
  /**
   * Swap a place on screen for another one, keeping its role (A or B), dates and cursor:
   * a point that was just saved, or a saved point that was renamed.
   */
  replacePlace(id: string, place: Place) {
    const swap = (current: Place | null) => (current && current.id === id ? place : current);
    if (state.placeA?.id === id || state.placeB?.id === id) set({ placeA: swap(state.placeA), placeB: swap(state.placeB) });
  },
  setOffsetMs(ms: number) {
    set({ offsetMs: Math.min(state.windowHours * HOUR_MS, Math.max(0, ms)) });
  },
  setPlaying(playing: boolean) {
    // Play at the end of the window starts over.
    if (playing && state.offsetMs >= state.windowHours * HOUR_MS) set({ playing, offsetMs: 0 });
    else set({ playing });
  },
  setSpeed(speed: number) {
    set({ speed });
  },
  setMast(mastM: number) {
    set({ mastM });
  },
  /** Choosing a profile drops the limits changed by hand. */
  setProfile(profileKey: ProfileKey) {
    set({ profileKey, limitOverrides: {} });
  },
  setLimit(key: LimitKey, value: number) {
    set({ limitOverrides: { ...state.limitOverrides, [key]: value } });
  },
  resetLimits() {
    set({ limitOverrides: {} });
  },
};

/** Start instant of scenario B. */
export function startOfB(s: ScenarioState): number {
  return s.startMs + s.slipDays * DAY_MS;
}
