// Sun and Earth directions for any point on the Moon, from one site-independent table.
//
// The backend writes the apparent positions of the Sun and Earth centers relative to the
// Moon's center in the Moon-fixed frame (data/ephemeris_vectors.csv). For a site, subtract
// the site's own position vector and project the result on the local east/north/up axes.
// This is a port of vectors_to_altaz in lunar_sky.py and is checked against the per-site
// tables by scripts/validate-engine.ts.
import type { SkySeries } from "./risk.ts";

export const MOON_RADIUS_KM = 1737.4;
/** IAU 2015 nominal solar radius and the Earth's equatorial radius, km (as in lunar_sky.py). */
const SUN_RADIUS_KM = 696000;
const EARTH_RADIUS_KM = 6378.137;
const DEG = Math.PI / 180;

export interface VectorTable {
  /** Time of the first sample, milliseconds since the Unix epoch (UTC). */
  startMs: number;
  stepHours: number;
  count: number;
  /** Columns x, y, z in km, each `count` long. */
  sun: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
  earth: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
}

export interface SampleRange {
  /** Index of the first sample. */
  first: number;
  count: number;
}

/** Sample index of an instant on the table's time axis (not clamped). */
export function sampleIndex(table: { startMs: number; stepHours: number }, timeMs: number): number {
  return Math.round((timeMs - table.startMs) / 3600000 / table.stepHours);
}

/** Last instant covered by a table. */
export function tableEndMs(table: { startMs: number; stepHours: number; count: number }): number {
  return table.startMs + (table.count - 1) * table.stepHours * 3600000;
}

/**
 * Azimuth (clockwise from north) and elevation of the Sun and Earth centers seen from a
 * point `heightM` above the reference sphere. Elevation is relative to the local horizontal
 * plane; no terrain. `range` limits the work to part of the table, for example one mission
 * window when many neighbouring points are compared.
 */
export function skyFromVectors(
  table: VectorTable,
  latDeg: number,
  lonDeg: number,
  heightM = 0,
  range?: SampleRange,
): SkySeries {
  const first = Math.max(0, range?.first ?? 0);
  const count = Math.max(0, Math.min(table.count - first, range?.count ?? table.count));
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const radius = MOON_RADIUS_KM + heightM / 1000;

  const sky = {
    startMs: table.startMs + first * table.stepHours * 3600000,
    stepHours: table.stepHours,
    count,
    sunAz: new Float64Array(count),
    sunAlt: new Float64Array(count),
    earthAz: new Float64Array(count),
    earthAlt: new Float64Array(count),
    sunRadiusDeg: new Float64Array(count),
    earthRadiusDeg: new Float64Array(count),
    sunMoonFromEarthDeg: new Float64Array(count),
  };
  const bodies = [
    [table.sun, sky.sunAz, sky.sunAlt, sky.sunRadiusDeg, SUN_RADIUS_KM],
    [table.earth, sky.earthAz, sky.earthAlt, sky.earthRadiusDeg, EARTH_RADIUS_KM],
  ] as const;
  for (const [[xs, ys, zs], az, alt, disk, bodyKm] of bodies) {
    for (let i = 0; i < count; i++) {
      const x = xs[first + i] - radius * up[0];
      const y = ys[first + i] - radius * up[1];
      const z = zs[first + i] - radius * up[2];
      const e = east[0] * x + east[1] * y + east[2] * z;
      const n = north[0] * x + north[1] * y + north[2] * z;
      const u = up[0] * x + up[1] * y + up[2] * z;
      az[i] = ((Math.atan2(e, n) / DEG) % 360 + 360) % 360;
      alt[i] = Math.atan2(u, Math.hypot(e, n)) / DEG;
      disk[i] = Math.asin(bodyKm / Math.hypot(x, y, z)) / DEG;
    }
  }
  // Sun-Earth-probe angle: from the Earth, the lander and the Sun.
  const [sx, sy, sz] = table.sun;
  const [ex, ey, ez] = table.earth;
  for (let i = 0; i < count; i++) {
    const j = first + i;
    const px = radius * up[0] - ex[j], py = radius * up[1] - ey[j], pz = radius * up[2] - ez[j];
    const qx = sx[j] - ex[j], qy = sy[j] - ey[j], qz = sz[j] - ez[j];
    const cos = (px * qx + py * qy + pz * qz) / (Math.hypot(px, py, pz) * Math.hypot(qx, qy, qz));
    sky.sunMoonFromEarthDeg[i] = Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
  }
  return sky;
}
