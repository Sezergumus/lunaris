// Numbers the Explorer's captions quote, all computed from the engine's series at run time.
// No result is ever typed into a sentence.
import { analyzeWindow, scoreWindow, type MissionWindow, type Score } from "../engine/risk.ts";
import { sampleIndex } from "../engine/sky.ts";
import type { ScenarioView } from "../state/view.ts";

const HOUR_MS = 3600000;
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Sample range of a window of `hours` from the view's start, clamped to the data. */
function range(view: ScenarioView, hours: number): { first: number; last: number } {
  const series = view.data.series;
  const first = Math.max(0, sampleIndex(series, view.startMs));
  const last = Math.min(series.count - 1, first + Math.round(hours / series.stepHours));
  return { first, last };
}

export interface SunFacts {
  /** Highest elevation of the Sun's center above the local horizontal plane, degrees. */
  maxElevationDeg: number;
  /** Hours with the Sun's upper limb above the skyline (terrain or flat horizon). */
  upHours: number;
  /** Longest stretch without any of the Sun above the skyline, hours. */
  longestDarkH: number;
  hours: number;
}

export function sunFacts(view: ScenarioView, hours: number): SunFacts {
  const { sky, series } = view.data;
  const { first, last } = range(view, hours);
  let max = -Infinity;
  let up = 0;
  let run = 0;
  let longest = 0;
  for (let i = first; i <= last; i++) {
    max = Math.max(max, sky.sunAlt[i]);
    const visible = series.sunAboveTerrain[i] + series.sunRadius[i] > 0;
    if (visible) up++;
    run = visible ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return { maxElevationDeg: max, upHours: up * series.stepHours, longestDarkH: longest * series.stepHours, hours: (last - first) * series.stepHours };
}

export interface EarthFacts {
  /** Compass direction of the Earth's mean azimuth, in words. */
  direction: string;
  minElevationDeg: number;
  maxElevationDeg: number;
  /** Share of the window with the Earth's upper limb above the skyline, 0-1. */
  visibleShare: number;
}

export function earthFacts(view: ScenarioView, hours: number): EarthFacts {
  const { sky, series } = view.data;
  const { first, last } = range(view, hours);
  let sx = 0;
  let sy = 0;
  let min = Infinity;
  let max = -Infinity;
  let visible = 0;
  for (let i = first; i <= last; i++) {
    const az = (sky.earthAz[i] * Math.PI) / 180;
    sx += Math.sin(az);
    sy += Math.cos(az);
    min = Math.min(min, sky.earthAlt[i]);
    max = Math.max(max, sky.earthAlt[i]);
    if (series.earthVisible[i]) visible++;
  }
  const mean = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
  return { direction: COMPASS[Math.round(mean / 45) % 8], minElevationDeg: min, maxElevationDeg: max, visibleShare: visible / Math.max(1, last - first + 1) };
}

/** The mission that lands at the view's start, scored as the risk card does; null outside the data. */
export function missionScore(view: ScenarioView): { window: MissionWindow; score: Score } | null {
  const { series, slopeP95Deg } = view.data;
  const window = analyzeWindow(series, view.startMs);
  return window ? { window, score: scoreWindow(window, series.profile, slopeP95Deg) } : null;
}

/** Hours to days with one decimal, for captions. */
export function days(hours: number): string {
  const d = hours / 24;
  return d >= 10 ? d.toFixed(0) : d.toFixed(1);
}

export function degrees(value: number, digits = 1): string {
  return `${value.toFixed(digits)}°`;
}

export { HOUR_MS };
