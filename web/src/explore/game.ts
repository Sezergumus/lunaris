// "Keep the lander alive for 14 days": missions, rules and outcomes, all from the engine.
//
// Two rules, both the risk model's own limits stated as game rules:
// - Battery: the lander fails when continuous darkness (no part of the Sun's disk in view)
//   lasts longer than the profile's battery survival time. There is no watt-hour model (no
//   sourced numbers for one); the charge shown is the share of that time still left.
// - Slope: a point whose slope within the landing precision is above the profile's slope
//   limit tips the lander over at touchdown.
import type { Series } from "../engine/risk.ts";
import { sampleIndex } from "../engine/sky.ts";
import { compassDirection, type ScoredPoint, type TerrainPoint } from "../engine/grid.ts";
import type { PlaceData } from "../state/placeData.ts";
import type { Scene } from "./steps.ts";

export const GAME_DAYS = 14;
const HOUR_MS = 3600000;
/** Scout flights per mission: each one shows the Sun forecast of one spot. */
export const SCOUTS_PER_MISSION = 3;
/** The second star: the lander survives within this many landings. */
export const LANDINGS_FOR_STAR = 3;
/** The third star: the spot's longest darkness is within this many hours of the best spot's. */
export const BEST_SPOT_MARGIN_H = 2;

export interface Mission {
  id: string;
  title: string;
  site: string;
  /** Landing date, YYYY-MM-DD (UTC); fixed, so the difficulty is known. */
  date: string;
  blurb: string;
}

/**
 * Three missions, easy to hard. Measured on the 9 x 9 grids with the generic profile
 * (50 h battery, 10 deg): Mons Mouton 18 Dec, 52 of 81 points survive and none is too steep;
 * Malapert A 16 Dec, 65 points too steep and 8 of the other 16 survive; connecting ridge
 * 16 Dec, 26 too steep, 24 survive, 31 run out of battery.
 */
export const MISSIONS: Mission[] = [
  { id: "first", title: "First landing", site: "mons_mouton", date: "2026-12-18", blurb: "Gentle ground on Mons Mouton, but the night is coming. Find a spot where the Sun stays long enough." },
  { id: "rough", title: "Rough ground", site: "malapert_a", date: "2026-12-16", blurb: "Near where IM-1 landed. Most of the ground is too steep: find a flat spot that also keeps the Sun." },
  { id: "ridge", title: "Edge of the crater", site: "connecting_ridge", date: "2026-12-16", blurb: "Next to the south pole: the Sun skims the hills, and a few hundred metres decide between light and shadow." },
];

export function missionScene(mission: Mission): Scene {
  return { site: mission.site, date: mission.date, windowHours: GAME_DAYS * 24, speed: 48, autoplay: false };
}

export type Cause = "terrain" | "horizon" | "slope";

export interface Outcome {
  /** Hours from the landing until the battery ran out, or the whole mission. */
  survivedH: number;
  failed: boolean;
  /** When the last darkness began (battery failures only). */
  darkStartMs: number | null;
  /** Why it failed: terrain hid the Sun, the Sun was below a flat horizon, or the ground was too steep. */
  cause: Cause | null;
  batteryH: number;
  slopeDeg: number | null;
  slopeLimitDeg: number;
  /** Longest continuous darkness the lander went through, hours. */
  longestDarkH: number;
}

export function isTooSteep(point: TerrainPoint | null | undefined, limitDeg: number): boolean {
  return point?.slope_deg !== null && point?.slope_deg !== undefined && point.slope_deg > limitDeg;
}

export function playOutcome(data: PlaceData, landingMs: number, slopeDeg: number | null): Outcome {
  const { series, sky } = data;
  const batteryH = series.profile.battery_survival_h;
  const slopeLimitDeg = series.profile.max_slope_deg;
  const base = { batteryH, slopeDeg, slopeLimitDeg };
  if (slopeDeg !== null && slopeDeg > slopeLimitDeg) {
    return { ...base, survivedH: 0, failed: true, darkStartMs: null, cause: "slope", longestDarkH: 0 };
  }
  const first = sampleIndex(series, landingMs);
  const samples = Math.round((GAME_DAYS * 24) / series.stepHours);
  let run = 0;
  let longest = 0;
  for (let k = 0; k < samples; k++) {
    const i = first + k;
    if (i < 0 || i >= series.count) break;
    run = series.dark[i] ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (run * series.stepHours > batteryH) {
      const start = i - run + 1;
      // The Sun's upper limb above a flat horizon at the start of the darkness: terrain hid it.
      const terrain = sky.sunAlt[start] + series.sunRadius[start] > 0;
      return {
        ...base,
        survivedH: (k + 1) * series.stepHours,
        failed: true,
        darkStartMs: series.startMs + start * series.stepHours * HOUR_MS,
        cause: terrain ? "terrain" : "horizon",
        longestDarkH: run * series.stepHours,
      };
    }
  }
  return { ...base, survivedH: GAME_DAYS * 24, failed: false, darkStartMs: null, cause: null, longestDarkH: longest * series.stepHours };
}

export interface Battery {
  /** Share of the darkness budget still left, 0-1 (1 while the Sun is in view). */
  share: number;
  /** Hours the lander can still go without Sun. */
  leftH: number;
  charging: boolean;
}

/**
 * The battery at a time, counted from the landing: the darkness run up to that sample
 * against the battery survival time. Any Sun in view resets it, as in the risk model.
 */
export function batteryAt(series: Series, landingMs: number, timeMs: number): Battery {
  const batteryH = series.profile.battery_survival_h;
  const first = Math.max(0, sampleIndex(series, landingMs));
  const now = Math.min(series.count - 1, sampleIndex(series, timeMs));
  let run = 0;
  for (let i = now; i >= first && series.dark[i]; i--) run++;
  const darkH = run * series.stepHours;
  return { share: Math.max(0, 1 - darkH / batteryH), leftH: Math.max(0, batteryH - darkH), charging: run === 0 };
}

export interface Stars {
  earned: [boolean, boolean, boolean];
  reasons: [string, string, string];
}

/** Survived; within a few landings; on (one of) the spots with the shortest darkness. */
export function starsFor(outcome: Outcome, landings: number, scored: ScoredPoint[] | null): Stars {
  const alive = !outcome.failed;
  const best = scored ? bestDarkH(scored, outcome.slopeLimitDeg) : null;
  const third = alive && best !== null && outcome.longestDarkH <= best + BEST_SPOT_MARGIN_H;
  return {
    earned: [alive, alive && landings <= LANDINGS_FOR_STAR, third],
    reasons: [
      "The lander lived 14 days",
      `Within ${LANDINGS_FOR_STAR} landings`,
      best === null ? "One of the safest spots" : best === 0 ? "A spot that never goes dark" : `A spot among the safest (longest dark ${Math.round(best)} h or close)`,
    ],
  };
}

/** Shortest "longest darkness" of the points that are not too steep, hours. */
export function bestDarkH(scored: ScoredPoint[], slopeLimitDeg: number): number | null {
  let best: number | null = null;
  for (const entry of scored) {
    if (isTooSteep(entry.point, slopeLimitDeg)) continue;
    const dark = entry.window.power.longest_darkness_h;
    if (best === null || dark < best) best = dark;
  }
  return best;
}

/**
 * A nudge after a failure: the compass direction (no distance) of the nearest point that
 * survives the same date and is flat enough. Null when there is none.
 */
export function directionHint(scored: ScoredPoint[], here: TerrainPoint, batteryH: number, slopeLimitDeg: number): string | null {
  let best: ScoredPoint | null = null;
  let bestD = Infinity;
  for (const entry of scored) {
    if (entry.window.power.longest_darkness_h > batteryH || isTooSteep(entry.point, slopeLimitDeg)) continue;
    const d = Math.hypot(entry.point.east_m - here.east_m, entry.point.north_m - here.north_m);
    if (d > 0 && d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  return best ? compassDirection(best.point.east_m - here.east_m, best.point.north_m - here.north_m) : null;
}

/** Key of a grid point in the attempt log. */
export const pointKey = (point: TerrainPoint) => `${Math.round(point.east_m)},${Math.round(point.north_m)}`;
