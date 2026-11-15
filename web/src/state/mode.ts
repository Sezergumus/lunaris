// Which face of the app is on screen: the Planner (map and panels) or the Explorer (one stage
// for a first-time visitor), whether the first-person surface view is open, the tour step,
// and where the surface camera looks.
//
// A small external store like state/scenario.ts. state/url.ts writes `mode`, `view` and `step`
// to the address bar and pushes a history entry when the user goes one level deeper, so the
// browser's back button leaves the Explorer or the surface view again.
import { useSyncExternalStore } from "react";

export type Mode = "plan" | "explore";
export type SurfaceState = "map" | "surface";

export interface ModeState {
  mode: Mode;
  /** "surface" = the first-person view is open (over the map in the Planner). */
  view: SurfaceState;
  /** Tour step in the Explorer, 0-based; null = the introduction (or no tour). */
  step: number | null;
  /** Camera of the surface view: azimuth clockwise from north and elevation, degrees. */
  headingDeg: number;
  pitchDeg: number;
  /** Vertical field of view of the surface camera, degrees. */
  fovDeg: number;
}

export const PITCH_LIMIT_DEG = 85;
export const FOV_RANGE_DEG = { min: 8, max: 90 } as const;

let state: ModeState = { mode: "plan", view: "map", step: null, headingDeg: 0, pitchDeg: 2, fovDeg: 60 };

const listeners = new Set<() => void>();

function set(patch: Partial<ModeState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getMode(): ModeState {
  return state;
}

export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMode<T>(selector: (state: ModeState) => T): T {
  return useSyncExternalStore(subscribeMode, () => selector(state));
}

const wrap = (deg: number) => ((deg % 360) + 360) % 360;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export const modeActions = {
  setMode(mode: Mode) {
    // The surface view is part of the Explorer's stage; leaving the Explorer closes it.
    set(mode === "plan" ? { mode, step: null, view: "map" } : { mode });
  },
  setView(view: SurfaceState) {
    set({ view });
  },
  setStep(step: number | null) {
    set({ step });
  },
  /** Replace mode, view and step at once (from the URL or the browser's history). */
  restore(patch: Pick<ModeState, "mode" | "view" | "step">) {
    set(patch);
  },
  look(headingDeg: number, pitchDeg: number) {
    set({ headingDeg: wrap(headingDeg), pitchDeg: clamp(pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG) });
  },
  setFov(fovDeg: number) {
    set({ fovDeg: clamp(fovDeg, FOV_RANGE_DEG.min, FOV_RANGE_DEG.max) });
  },
};

/**
 * Leave the innermost level (surface view, then the Explorer). Goes back in the browser's
 * history when that level was entered with a pushed entry, so back and Escape agree.
 */
export function leaveLevel() {
  const entry = window.history.state as { lunarisPushed?: boolean } | null;
  if (entry?.lunarisPushed) {
    window.history.back();
    return;
  }
  if (state.view === "surface") modeActions.setView("map");
  else if (state.mode === "explore") modeActions.setMode("plan");
}
