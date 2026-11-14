// South polar stereographic projection of the Moon, true scale at the pole.
// Same formulas and orientation as latlon_to_xy / xy_to_latlon in lunar_terrain.py
// (+y toward longitude 0, +x toward 90°E), which also match the Moon Trek south pole tiles.

export const MOON_RADIUS_M = 1_737_400;

const DEG = Math.PI / 180;

/** Projected x/y in meters for a latitude/longitude in degrees (longitude east-positive). */
export function latLonToXY(latDeg: number, lonDeg: number): [number, number] {
  const r = 2 * MOON_RADIUS_M * Math.tan(((90 + latDeg) * DEG) / 2);
  return [r * Math.sin(lonDeg * DEG), r * Math.cos(lonDeg * DEG)];
}

/** Latitude and longitude in degrees for projected meters; longitude in (-180, 180]. */
export function xyToLatLon(x: number, y: number): { lat: number; lon: number } {
  const r = Math.hypot(x, y);
  return {
    lat: -90 + (2 * Math.atan(r / (2 * MOON_RADIUS_M))) / DEG,
    lon: Math.atan2(x, y) / DEG,
  };
}

/** Great-circle distance in meters on the reference sphere. */
export function surfaceDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitude normalized to [0, 360), the convention of the site table. */
export function eastLongitude(lonDeg: number): number {
  return ((lonDeg % 360) + 360) % 360;
}

export function formatLat(latDeg: number, digits = 2): string {
  return `${Math.abs(latDeg).toFixed(digits)}° ${latDeg < 0 ? "S" : "N"}`;
}

export function formatLon(lonDeg: number, digits = 2): string {
  return `${eastLongitude(lonDeg).toFixed(digits)}° E`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString("en-US")} km`;
}
