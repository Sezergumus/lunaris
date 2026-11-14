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

/** Window lengths offered by the timeline, hours. 708 h is one mean synodic day of the Moon. */
export const WINDOW_HOURS = { mission: 336, lunarDay: 708 } as const;
/** Playback speeds in simulated hours per second. */
export const SPEEDS = [6, 24, 72] as const;

export interface ScenarioState {
  /** Scenario A's place; null = nothing selected. */
  placeA: Place | null;
  /** Scenario B's place; null = no comparison. */
  placeB: Place | null;
  /** Start (landing) instant of scenario A. */
  startMs: number;
  /** Scenario B starts this many days after A; 0 when two places are compared on one date. */
  slipDays: number;
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

/** Latest start that keeps both windows inside the data. */
function clampStart(startMs: number, s: ScenarioState): number {
  if (!s.limits) return startMs;
  const last = floorToDay(s.limits.maxMs - s.windowHours * HOUR_MS - Math.max(0, s.slipDays) * DAY_MS);
  return Math.min(last, Math.max(s.limits.minMs, startMs));
}

/** Largest slip that keeps scenario B's window inside the data. */
function clampSlip(slipDays: number, s: ScenarioState): number {
  if (!s.limits) return slipDays;
  const room = Math.floor((s.limits.maxMs - s.windowHours * HOUR_MS - s.startMs) / DAY_MS);
  return Math.max(0, Math.min(room, slipDays));
}

export const actions = {
  /** Called once when the tables arrive. `startMs` may come from the URL. */
  init(limits: { minMs: number; maxMs: number }, startMs: number | null, windowHours: number | null) {
    const next = { ...state, limits, windowHours: windowHours ?? state.windowHours };
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
   * place already compared) N days later. Repeated slips add up.
   */
  slip(days: number) {
    if (!state.placeA) return;
    const next = { ...state, placeB: state.placeB ?? state.placeA };
    set({ placeB: next.placeB, slipDays: clampSlip(state.slipDays + days, next) });
  },
  setWindowHours(hours: number) {
    const next = { ...state, windowHours: hours };
    set({ windowHours: hours, offsetMs: Math.min(state.offsetMs, hours * HOUR_MS), startMs: clampStart(state.startMs, next) });
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
  setProfile(profileKey: ProfileKey) {
    set({ profileKey });
  },
};

/** Start instant of scenario B. */
export function startOfB(s: ScenarioState): number {
  return s.startMs + s.slipDays * DAY_MS;
}
