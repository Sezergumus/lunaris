// Horizon for a raised observer (solar panel or antenna on a mast).
//
// The precomputed horizon of a site is for one observer height (2 m). The file also gives,
// per azimuth, the distance of the terrain point that sets the horizon. Raising the observer
// by dh lowers the direction to that same point by about atan(dh / distance):
//
//   horizon'(az) = horizon(az) - atan((mast - base) / range(az))
//
// This is a first-order estimate, not a recomputation: once the nearest obstruction drops, a
// farther and higher ridge can take over, so the true horizon is the same or higher. Where
// the obstruction is only tens of meters away the formula alone would open a deep notch that
// no real far horizon has, so the result is not allowed below the lowest value of the
// original profile (the most open direction the site already has). The estimate still leans
// optimistic, and the UI labels it as an estimate. The exact profile needs the height map,
// which only the terrain service has.
import type { Horizon } from "./risk.ts";

const DEG = Math.PI / 180;

/** Range of the mast slider, meters. The lower end is the height of the precomputed horizons. */
export const MAST_RANGE_M = { min: 2, max: 15 } as const;

export function estimateMastHorizon(horizon: Horizon, rangeKm: ArrayLike<number>, baseMastM: number, mastM: number): Horizon {
  const raise = mastM - baseMastM;
  const horizonDeg = new Float64Array(horizon.horizonDeg.length);
  let floor = Infinity;
  for (let i = 0; i < horizonDeg.length; i++) floor = Math.min(floor, horizon.horizonDeg[i]);
  for (let i = 0; i < horizonDeg.length; i++) {
    const rangeM = rangeKm[i] * 1000;
    const base = horizon.horizonDeg[i];
    // No obstruction distance (missing data): leave that direction as it is.
    horizonDeg[i] = rangeM > 0 ? Math.min(base, Math.max(floor, base - Math.atan(raise / rangeM) / DEG)) : base;
  }
  return { stepDeg: horizon.stepDeg, horizonDeg };
}

export interface MastSource {
  horizon: Horizon;
  /** Empty when the obstruction distances are unknown (custom points). */
  horizonRangeKm: ArrayLike<number>;
  /** Observer height the horizon was computed for. */
  mastM: number;
}

export interface MastHorizon {
  horizon: Horizon;
  /** "base": the precomputed profile itself; "estimate": the first-order formula above. */
  mode: "base" | "estimate";
}

/** True where the estimate can be made at all. */
export function mastAdjustable(source: MastSource | null): boolean {
  return source !== null && source.horizonRangeKm.length === source.horizon.horizonDeg.length;
}

/**
 * Horizon of a place for a mast height: the single entry point for the UI.
 *
 * TODO(api): this is an estimate until the terrain service is deployed. With a service
 * configured (terrainConfigured() in data/terrain.ts), usePlaceSeries in state/placeData.ts
 * replaces the result with the exact profile from fetchHorizon({ lat, lon, mast }) and the
 * "Estimate" label goes away; nothing else has to change.
 */
export function horizonForMast(source: MastSource, mastM: number): MastHorizon {
  if (mastM === source.mastM || !mastAdjustable(source)) return { horizon: source.horizon, mode: "base" };
  return { horizon: estimateMastHorizon(source.horizon, source.horizonRangeKm, source.mastM, mastM), mode: "estimate" };
}
