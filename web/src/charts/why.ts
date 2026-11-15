// Why the Sun or the Earth is out of view right now, in one sentence. Shared by the horizon
// chart and the surface view.
import type { Instant } from "../engine/events.ts";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, horizonAt, terrainDiskFraction } from "../engine/risk.ts";
import { formatDistance } from "../geo/polar.ts";
import type { PlaceData } from "../state/placeData.ts";
import { formatAngle } from "../ui/format.ts";

/** Below this visible share of the solar disk, a cut by the terrain is worth a sentence. */
const CUT_WORTH_NAMING = 0.99;

/** What the terrain does to one body right now, if anything worth explaining. */
export interface Obstruction {
  kind: "sun" | "earth";
  az: number;
  /** The terrain hides or cuts the body although it would be up on flat ground. */
  byTerrain: boolean;
  /** Fully hidden (else the Sun's disk is partly cut). */
  hidden: boolean;
  horizonDeg: number;
  alt: number;
  /** Distance of the terrain that sets the horizon there; null where it is not known. */
  rangeKm: number | null;
  /** Visible share of the Sun's disk, for a partial cut. */
  visibleShare: number;
}

export function rangeAt(data: PlaceData, az: number): number | null {
  const ranges = data.terrain?.horizonRangeKm;
  const horizon = data.horizon;
  if (!ranges || !horizon || ranges.length !== horizon.horizonDeg.length) return null;
  const i = Math.round((((az % 360) + 360) % 360) / horizon.stepDeg) % ranges.length;
  return ranges[i];
}

export function obstruction(data: PlaceData, kind: "sun" | "earth", at: Instant): Obstruction | null {
  if (!data.horizon) return null;
  const sun = kind === "sun";
  const az = sun ? at.sunAz : at.earthAz;
  const alt = sun ? at.sunAlt : at.earthAlt;
  const radius = sun ? SUN_RADIUS_DEG : EARTH_RADIUS_DEG;
  const hidden = !(sun ? at.sunVisible : at.earthVisible);
  const horizonDeg = horizonAt(data.horizon, az);
  const visibleShare = sun ? terrainDiskFraction(alt, horizonDeg, radius) : 1;
  if (!hidden && visibleShare >= CUT_WORTH_NAMING) return null;
  // The flat-ground horizon of the sphere model is 0 deg: above it, the terrain is to blame.
  return { kind, az, byTerrain: alt + radius > 0, hidden, horizonDeg, alt, rangeKm: rangeAt(data, az), visibleShare };
}

/** `brief` leaves the angles out (the Explorer's wording). */
export function sentence(o: Obstruction, brief = false): string {
  const name = o.kind === "sun" ? "Sun" : "Earth";
  const where = o.rangeKm !== null ? ` ${formatDistance(o.rangeKm * 1000)} away` : "";
  if (!o.byTerrain) return o.kind === "sun" ? "The Sun is below the horizon." : "The Earth is below the horizon: no direct link.";
  if (!o.hidden) return `Terrain${where} covers ${Math.round((1 - o.visibleShare) * 100)}% of the Sun's disk.`;
  if (brief) return `Terrain${where} hides the ${name}${o.kind === "earth" ? ": no direct link" : ""}.`;
  const consequence = o.kind === "sun" ? "on flat ground it would be up" : "no direct link, though on flat ground it would be up";
  return `Terrain${where} rises to ${formatAngle(o.horizonDeg, 1)} and hides the ${name} at ${formatAngle(o.alt, 1)}: ${consequence}.`;
}

