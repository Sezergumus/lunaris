// Coordinate frames of the surface view.
//
// Scene frame: x = east, y = up, z = -north, meters, origin on the ground at the site (the
// observer stands `eyeHeight` above it). Directions are azimuth clockwise from north and
// elevation above the local horizontal plane, as everywhere else in the app.
//
// Terrain vertices come from the south polar stereographic grid of the LOLA heights: a
// projected point (x, y) becomes a Moon-fixed unit vector (the inverse of
// lunar_terrain.latlon_to_xy), the vertex is (R + h) times that vector, and the result is
// expressed in the site's east / up / north axes relative to the site's ground point. The
// curvature of the Moon and the scale of the projection are therefore exact. Computed in
// Float64; stored as Float32 by the callers.

/** Reference sphere of the LOLA heights, meters. */
export const MOON_RADIUS_M = 1737400;
const DEG = Math.PI / 180;

/** Unit vector of a direction in the scene frame. */
export function directionToScene(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** Azimuth (0-360) and elevation of a scene-frame vector, degrees. */
export function sceneToDirection(x: number, y: number, z: number): { azimuthDeg: number; elevationDeg: number } {
  const horizontal = Math.hypot(x, z);
  return {
    azimuthDeg: ((Math.atan2(x, -z) / DEG) % 360 + 360) % 360,
    elevationDeg: Math.atan2(y, horizontal) / DEG,
  };
}

/** Site frame: turns projected points with a height into scene coordinates. */
export interface SiteFrame {
  /** Writes the scene position of projected (x, y) at height `h` (m above the sphere) into `out` at `offset`. */
  toScene(x: number, y: number, h: number, out: Float32Array, offset: number): void;
  /** Scene-frame vector from the site's ground point to the Moon's center. */
  moonCenter: [number, number, number];
}

export function siteFrame(latDeg: number, lonDeg: number, groundHeightM: number): SiteFrame {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const r0 = MOON_RADIUS_M + groundHeightM;
  const site = [r0 * up[0], r0 * up[1], r0 * up[2]];
  const four = 4 * MOON_RADIUS_M * MOON_RADIUS_M;
  return {
    toScene(x, y, h, out, offset) {
      const s = x * x + y * y;
      const k = (MOON_RADIUS_M + h) / (s + four);
      // Moon-fixed position: +y of the projection points to longitude 0 (X), +x to 90 E (Y).
      const px = k * 4 * MOON_RADIUS_M * y - site[0];
      const py = k * 4 * MOON_RADIUS_M * x - site[1];
      const pz = k * (s - four) - site[2];
      out[offset] = east[0] * px + east[1] * py + east[2] * pz;
      out[offset + 1] = up[0] * px + up[1] * py + up[2] * pz;
      out[offset + 2] = -(north[0] * px + north[1] * py + north[2] * pz);
    },
    moonCenter: [0, -r0, 0],
  };
}

/** Projected south polar stereographic coordinates of a point (port of lunar_terrain.latlon_to_xy). */
export function latLonToProjected(latDeg: number, lonDeg: number): { x: number; y: number } {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + lat / 2);
  return { x: rho * Math.sin(lon), y: rho * Math.cos(lon) };
}
