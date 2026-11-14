// Rise/set events and instantaneous state between the hourly samples.
//
// The risk model (risk.ts) works on whole samples. The panels also need "how long until
// sunset" to the minute and a smooth position while the timeline plays, so the helpers here
// interpolate linearly between two samples. A body counts as visible while its upper limb is
// above the horizon in its direction (the convention of the backend's `metrics` command), so
// the quantity that changes sign at an event is `clearance = center above terrain + radius`.
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, type Series, type SkySeries } from "./risk.ts";

const DEG = Math.PI / 180;

/** Upper-limb clearance per sample; positive = visible. */
export function limbClearance(centerAboveTerrain: ArrayLike<number>, radiusDeg: number): Float64Array {
  const out = new Float64Array(centerAboveTerrain.length);
  for (let i = 0; i < out.length; i++) out[i] = centerAboveTerrain[i] + radiusDeg;
  return out;
}

/** Every sign change of a clearance series, as fractional sample positions in rising order. */
export interface Transitions {
  positions: Float64Array;
  /** 1 = the body appears at this event, 0 = it disappears. */
  rising: Uint8Array;
  /** Visibility at the first sample, for series without any event. */
  initiallyVisible: boolean;
}

export function findTransitions(clearance: ArrayLike<number>): Transitions {
  const positions: number[] = [];
  const rising: number[] = [];
  for (let i = 0; i + 1 < clearance.length; i++) {
    const a = clearance[i];
    const b = clearance[i + 1];
    if (a > 0 !== b > 0) {
      positions.push(i + a / (a - b));
      rising.push(b > 0 ? 1 : 0);
    }
  }
  return { positions: Float64Array.from(positions), rising: Uint8Array.from(rising), initiallyVisible: clearance[0] > 0 };
}

export interface Transition {
  /** Fractional sample position of the event. */
  position: number;
  rising: boolean;
}

/**
 * First event strictly after `fromPosition` (binary search), or null if the body keeps its
 * state to the end of the data: "Always visible" or "Never rises" for the caller.
 */
export function nextTransition(transitions: Transitions, fromPosition: number): Transition | null {
  const { positions } = transitions;
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] > fromPosition) hi = mid;
    else lo = mid + 1;
  }
  return lo < positions.length ? { position: positions[lo], rising: transitions.rising[lo] === 1 } : null;
}

/** Visibility at a fractional position, from the event list alone. */
export function visibleAt(transitions: Transitions, position: number): boolean {
  const next = nextTransition(transitions, position);
  if (next) return !next.rising;
  const n = transitions.positions.length;
  return n === 0 ? transitions.initiallyVisible : transitions.rising[n - 1] === 1;
}

/** Runs of set flags inside [first, first + count), as [start, end) offsets from `first`. */
export function runs(flags: ArrayLike<number>, first: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let k = 0; k < count; k++) {
    const set = Boolean(flags[first + k]);
    if (set && start < 0) start = k;
    else if (!set && start >= 0) {
      out.push([start, k]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, count]);
  return out;
}

export type LinkBlock = "terrain" | "station" | "conjunction";

/** State at one instant, interpolated between the two neighbouring samples. */
export interface Instant {
  ms: number;
  /** Fractional sample position, clamped to the data. */
  position: number;
  sunAz: number;
  /** Elevation of the Sun's center above the local horizontal plane. */
  sunAlt: number;
  earthAz: number;
  earthAlt: number;
  /** Elevation of the body's center above the terrain in its direction. */
  sunAboveTerrain: number;
  earthAboveTerrain: number;
  /** Usable share of the solar disk (terrain and Earth-caused eclipse). */
  solarFraction: number;
  sunVisible: boolean;
  earthVisible: boolean;
  /** Direct-to-Earth link available. */
  link: boolean;
  /** Why the link is down, null while it is up. */
  linkBlock: LinkBlock | null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolation of an azimuth along the shorter way around the circle. */
function lerpAzimuth(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (((a + delta * t) % 360) + 360) % 360;
}

export function sampleAt(series: Series, sky: SkySeries, timeMs: number): Instant {
  const raw = (timeMs - series.startMs) / 3600000 / series.stepHours;
  const position = Math.min(series.count - 1, Math.max(0, raw));
  const i = Math.min(series.count - 2, Math.floor(position));
  const t = position - i;
  // Flags are per sample; the nearest one stands for the instant.
  const near = Math.round(position);

  const sunAboveTerrain = lerp(series.sunAboveTerrain[i], series.sunAboveTerrain[i + 1], t);
  const earthAboveTerrain = lerp(series.earthAboveTerrain[i], series.earthAboveTerrain[i + 1], t);
  const earthVisible = earthAboveTerrain + EARTH_RADIUS_DEG > 0;
  const linkBlock: LinkBlock | null = !earthVisible
    ? "terrain"
    : !series.stationOk[near]
      ? "station"
      : series.conjunction[near]
        ? "conjunction"
        : null;

  return {
    ms: series.startMs + position * series.stepHours * 3600000,
    position,
    sunAz: lerpAzimuth(sky.sunAz[i], sky.sunAz[i + 1], t),
    sunAlt: lerp(sky.sunAlt[i], sky.sunAlt[i + 1], t),
    earthAz: lerpAzimuth(sky.earthAz[i], sky.earthAz[i + 1], t),
    earthAlt: lerp(sky.earthAlt[i], sky.earthAlt[i + 1], t),
    sunAboveTerrain,
    earthAboveTerrain,
    solarFraction: lerp(series.solarFraction[i], series.solarFraction[i + 1], t),
    sunVisible: sunAboveTerrain + SUN_RADIUS_DEG > 0,
    earthVisible,
    link: linkBlock === null,
    linkBlock,
  };
}

/**
 * Share of full output for the two simplest panel mountings, 0-1. A vertical panel that tracks
 * the Sun in azimuth collects cos(elevation); a horizontal panel collects sin(elevation). Both
 * are scaled by the visible share of the solar disk. No thermal or electrical model.
 */
export function panelYield(elevationDeg: number, solarFraction: number): { vertical: number; horizontal: number } {
  const elevation = elevationDeg * DEG;
  return {
    vertical: Math.max(0, Math.cos(elevation)) * solarFraction,
    horizontal: Math.max(0, Math.sin(elevation)) * solarFraction,
  };
}
