// "Keep the lander alive for 14 days": the rule and the outcome, from the engine.
//
// The rule is the risk model's own power test, stated as a game rule: the lander fails when
// continuous darkness (no part of the Sun's disk in view) lasts longer than the profile's
// battery survival time. There is no watt-hour model (no sourced numbers for one).
import type { ScanRow } from "../engine/risk.ts";
import { sampleIndex } from "../engine/sky.ts";
import { compassDirection, pointDistanceM, type ScoredPoint, type TerrainPoint } from "../engine/grid.ts";
import { formatDistance } from "../geo/polar.ts";
import type { PlaceData } from "../state/placeData.ts";

export const GAME_DAYS = 14;
const HOUR_MS = 3600000;

export interface Outcome {
  /** Hours from the landing until the battery ran out, or the whole mission. */
  survivedH: number;
  failed: boolean;
  /** When the last darkness began (failed games only). */
  darkStartMs: number | null;
  /** Why it was dark: terrain in the way, or the Sun below the horizon of a flat Moon. */
  cause: "terrain" | "horizon" | null;
  batteryH: number;
}

export function playOutcome(data: PlaceData, landingMs: number): Outcome {
  const { series, sky } = data;
  const batteryH = series.profile.battery_survival_h;
  const first = sampleIndex(series, landingMs);
  const samples = Math.round((GAME_DAYS * 24) / series.stepHours);
  let run = 0;
  for (let k = 0; k < samples; k++) {
    const i = first + k;
    if (i < 0 || i >= series.count) break;
    run = series.dark[i] ? run + 1 : 0;
    if (run * series.stepHours > batteryH) {
      const start = i - run + 1;
      // The Sun's upper limb above a flat horizon at the start of the darkness: terrain hid it.
      const terrain = sky.sunAlt[start] + series.sunRadius[start] > 0;
      return {
        survivedH: (k + 1) * series.stepHours,
        failed: true,
        darkStartMs: series.startMs + start * series.stepHours * HOUR_MS,
        cause: terrain ? "terrain" : "horizon",
        batteryH,
      };
    }
  }
  return { survivedH: GAME_DAYS * 24, failed: false, darkStartMs: null, cause: null, batteryH };
}

/** Nearest grid point (to `here`) that survives the same landing date, as "try 375 m SE". */
export function pointHint(scored: ScoredPoint[], here: TerrainPoint, batteryH: number): { entry: ScoredPoint; text: string } | null {
  let best: ScoredPoint | null = null;
  let bestD = Infinity;
  for (const entry of scored) {
    if (entry.window.power.longest_darkness_h > batteryH) continue;
    const d = Math.hypot(entry.point.east_m - here.east_m, entry.point.north_m - here.north_m);
    if (d > 0 && d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  if (!best) return null;
  const rel = { ...best.point, east_m: best.point.east_m - here.east_m, north_m: best.point.north_m - here.north_m };
  return { entry: best, text: `${formatDistance(pointDistanceM(rel))} ${compassDirection(rel.east_m, rel.north_m)}` };
}

/** Nearest landing date at the same point whose longest darkness the battery survives. */
export function dateHint(scan: ScanRow[], landingMs: number, batteryH: number): number | null {
  let best: number | null = null;
  for (const row of scan) {
    if (row.longest_darkness_h > batteryH) continue;
    if (best === null || Math.abs(row.landingMs - landingMs) < Math.abs(best - landingMs)) best = row.landingMs;
  }
  return best;
}
