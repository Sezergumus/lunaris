// Mission risk model: a TypeScript port of the backend module lunar_risk.py.
//
// Per time sample it derives the power and communication state of a lander from the Sun and
// Earth directions, the terrain horizon and the ground-station table; over a mission window
// it summarizes them into indicators and a 0-100 risk score per category.
//
// The port is checked against the backend's risk_<site>.json files by scripts/validate-engine.ts.
// Keep the two implementations in step: any change here must still pass that check.

export const SUN_RADIUS_DEG = 0.27;
export const EARTH_RADIUS_DEG = 0.95;
/** Up to this share of a limit counts as no risk. */
const COMFORT_FRACTION = 0.5;
const DEG = Math.PI / 180;

export interface Profile {
  duration_days: number;
  /** Longest darkness the lander survives. */
  battery_survival_h: number;
  /** Required share of the mission with usable Sun. */
  min_sunlit_pct: number;
  /** Visible fraction of the solar disk that counts as usable Sun. */
  min_solar_fraction: number;
  /** Longest tolerable loss of contact. */
  max_comm_outage_h: number;
  /** Required share of the mission with contact. */
  min_comm_pct: number;
  station_min_elevation_deg: number;
  /** Sun-Earth separation below which solar radio noise jams the link. */
  conjunction_deg: number;
  /** Earth center this close to the terrain counts as a degraded link. */
  low_elevation_deg: number;
  max_slope_deg: number;
  /** Radius in which slope is judged when nearby spots are compared, meters. */
  landing_precision_m: number;
  /** Extra elevation margin added to every horizon. */
  mask_deg: number;
}

/** Placeholder mission assumptions, identical to DEFAULT_PROFILE in the backend. */
export const DEFAULT_PROFILE: Profile = {
  duration_days: 14,
  battery_survival_h: 50,
  min_sunlit_pct: 50,
  min_solar_fraction: 0.5,
  max_comm_outage_h: 24,
  min_comm_pct: 50,
  station_min_elevation_deg: 10,
  conjunction_deg: 2,
  low_elevation_deg: 2,
  max_slope_deg: 10,
  landing_precision_m: 100,
  mask_deg: 0,
};

/** A named mission profile: overrides of DEFAULT_PROFILE taken from a real mission. */
export interface ProfilePreset {
  label: string;
  /** Short name for the selector. */
  short: string;
  /** Where the numbers come from and how well they are sourced. */
  basis: string;
  overrides: Partial<Profile>;
}

/** Identical to PROFILE_PRESETS in the backend (lunar_risk.py); change both. */
export const PROFILE_PRESETS = {
  generic: {
    label: "Generic lander",
    short: "Generic",
    basis: "Project defaults (placeholder assumptions).",
    overrides: {},
  },
  solar_lander: {
    label: "Solar lander, no night survival",
    short: "Solar lander",
    basis:
      "IM-1 Odysseus and Chandrayaan-3 were not designed to survive the lunar night. The 24 h darkness limit is our assumption for a short shadow, not a night; the 10° slope is the landing tolerance stated by Intuitive Machines for Nova-C.",
    overrides: { battery_survival_h: 24, max_slope_deg: 10 },
  },
  battery_rover: {
    label: "Battery rover (VIPER class)",
    short: "Battery rover",
    basis: "NASA VIPER lunar operations: no more than 50 h of continuous darkness, drives on slopes up to 15°.",
    overrides: { battery_survival_h: 50, max_slope_deg: 15 },
  },
} as const satisfies Record<string, ProfilePreset>;

export type ProfileKey = keyof typeof PROFILE_PRESETS;

export function presetProfile(key: ProfileKey): Profile {
  return { ...DEFAULT_PROFILE, ...PROFILE_PRESETS[key].overrides };
}

/** Terrain horizon elevation per azimuth, starting at north, clockwise, in equal steps. */
export interface Horizon {
  stepDeg: number;
  horizonDeg: ArrayLike<number>;
}

export interface SkySeries {
  /** Time of the first sample, milliseconds since the Unix epoch (UTC). */
  startMs: number;
  stepHours: number;
  count: number;
  sunAz: ArrayLike<number>;
  sunAlt: ArrayLike<number>;
  earthAz: ArrayLike<number>;
  earthAlt: ArrayLike<number>;
}

/** Highest Moon elevation over the ground stations per sample; null = always available. */
export type StationElevation = ArrayLike<number> | null;

export interface Series {
  startMs: number;
  stepHours: number;
  count: number;
  profile: Profile;
  sunAboveTerrain: Float64Array;
  earthAboveTerrain: Float64Array;
  terrainFraction: Float64Array;
  earthCover: Float64Array;
  solarFraction: Float64Array;
  sunlit: Uint8Array;
  dark: Uint8Array;
  earthVisible: Uint8Array;
  stationOk: Uint8Array;
  conjunction: Uint8Array;
  comm: Uint8Array;
  lowElevation: Uint8Array;
}

export interface PowerIndicators {
  sunlit_pct: number;
  mean_solar_fraction_pct: number;
  longest_darkness_h: number;
  dark_at_landing: boolean;
  partial_disk_h: number;
  earth_eclipse_h: number;
  max_earth_cover_pct: number;
  sun_above_terrain_deg: [number, number];
}

export interface CommIndicators {
  available_pct: number;
  longest_outage_h: number;
  terrain_occultation_h: number;
  station_gap_h: number;
  conjunction_h: number;
  low_elevation_h: number;
  earth_above_terrain_deg: [number, number];
}

export interface MissionWindow {
  landingMs: number;
  endMs: number;
  duration_days: number;
  power: PowerIndicators;
  comm: CommIndicators;
}

export type RiskLevel = "low" | "medium" | "high";
export type RiskCategory = "power" | "comm" | "surface";

export interface Score {
  power: number;
  comm: number;
  /** null when no surface statistics are available (sphere model). */
  surface: number | null;
  overall: number;
  level: RiskLevel;
  driver: RiskCategory;
}

export interface ScanRow {
  landingMs: number;
  sunlit_pct: number;
  longest_darkness_h: number;
  comm_pct: number;
  longest_comm_outage_h: number;
  risk_power: number;
  risk_comm: number;
  risk_overall: number;
  level: RiskLevel;
}

// ---------------------------------------------------------------- geometry

/** Horizon elevation at an arbitrary azimuth (linear interpolation, periodic). */
export function horizonAt(horizon: Horizon, azimuthDeg: number): number {
  const n = horizon.horizonDeg.length;
  const position = (((azimuthDeg % 360) + 360) % 360) / horizon.stepDeg;
  const i = Math.floor(position);
  const t = position - i;
  const a = horizon.horizonDeg[i % n];
  const b = horizon.horizonDeg[(i + 1) % n];
  return a + (b - a) * t;
}

export function angularSeparationDeg(az1: number, alt1: number, az2: number, alt2: number): number {
  const a1 = alt1 * DEG;
  const a2 = alt2 * DEG;
  const cosSep = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos((az1 - az2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG;
}

/** Fraction of the small disk's area covered by the big disk (circle overlap). */
export function coveredFraction(
  separationDeg: number,
  rSmall = SUN_RADIUS_DEG,
  rBig = EARTH_RADIUS_DEG,
): number {
  const d = separationDeg;
  if (d <= rBig - rSmall) return 1;
  if (d >= rBig + rSmall) return 0;
  const a1 = rSmall ** 2 * Math.acos((d * d + rSmall ** 2 - rBig ** 2) / (2 * d * rSmall));
  const a2 = rBig ** 2 * Math.acos((d * d + rBig ** 2 - rSmall ** 2) / (2 * d * rBig));
  const a3 =
    0.5 * Math.sqrt((-d + rSmall + rBig) * (d + rSmall - rBig) * (d - rSmall + rBig) * (d + rSmall + rBig));
  return (a1 + a2 - a3) / (Math.PI * rSmall ** 2);
}

/** Visible fraction of a disk whose center is `centerAlt` and which is cut by a flat horizon. */
export function terrainDiskFraction(centerAlt: number, horizon: number, radius: number): number {
  const x = Math.min(1, Math.max(-1, (centerAlt - horizon) / radius));
  return 0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI;
}

// ------------------------------------------------------------------ series

/**
 * Per-sample state of power and communication.
 * `horizon` null = ideal sphere; `stationMaxAlt` null = a ground station is always available.
 */
/**
 * Angle by which a height error can raise the horizon, per azimuth (degrees): a terrain
 * point `heightErrorM` too low in the map, at the distance of the obstruction that sets
 * the horizon, raises it by atan(error / distance). Port of horizon_uncertainty_deg.
 */
export function horizonUncertaintyDeg(rangeKm: ArrayLike<number>, heightErrorM: number, minRangeM = 60): number[] {
  return Array.from(rangeKm, (km) => (Math.atan2(heightErrorM, Math.max(km * 1000, minRangeM)) * 180) / Math.PI);
}

/** The horizon raised by its height-error angle, and the largest angle added. */
export function raisedHorizon(horizon: Horizon, rangeKm: ArrayLike<number>, heightErrorM: number): { horizon: Horizon; maxDeg: number } {
  const margin = horizonUncertaintyDeg(rangeKm, heightErrorM);
  return {
    horizon: { stepDeg: horizon.stepDeg, horizonDeg: Array.from(horizon.horizonDeg, (v, i) => v + margin[i]) },
    maxDeg: Math.max(...margin),
  };
}

export function buildSeries(
  sky: SkySeries,
  horizon: Horizon | null,
  stationMaxAlt: StationElevation,
  profile: Profile,
): Series {
  const n = sky.count;
  const s: Series = {
    startMs: sky.startMs,
    stepHours: sky.stepHours,
    count: n,
    profile,
    sunAboveTerrain: new Float64Array(n),
    earthAboveTerrain: new Float64Array(n),
    terrainFraction: new Float64Array(n),
    earthCover: new Float64Array(n),
    solarFraction: new Float64Array(n),
    sunlit: new Uint8Array(n),
    dark: new Uint8Array(n),
    earthVisible: new Uint8Array(n),
    stationOk: new Uint8Array(n),
    conjunction: new Uint8Array(n),
    comm: new Uint8Array(n),
    lowElevation: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const sunAlt = sky.sunAlt[i];
    const earthAlt = sky.earthAlt[i];
    const sunHor = (horizon ? horizonAt(horizon, sky.sunAz[i]) : 0) + profile.mask_deg;
    const earthHor = (horizon ? horizonAt(horizon, sky.earthAz[i]) : 0) + profile.mask_deg;

    const separation = angularSeparationDeg(sky.sunAz[i], sunAlt, sky.earthAz[i], earthAlt);
    const earthVisible = earthAlt + EARTH_RADIUS_DEG > earthHor;
    const terrainFraction = terrainDiskFraction(sunAlt, sunHor, SUN_RADIUS_DEG);
    // The Earth only blocks sunlight if it is itself above the terrain.
    const earthCover = earthVisible ? coveredFraction(separation) : 0;
    const solarFraction = terrainFraction * (1 - earthCover);

    const stationOk = stationMaxAlt === null || stationMaxAlt[i] > profile.station_min_elevation_deg;
    const conjunction = earthVisible && separation < profile.conjunction_deg;
    const comm = earthVisible && stationOk && !conjunction;

    s.sunAboveTerrain[i] = sunAlt - sunHor;
    s.earthAboveTerrain[i] = earthAlt - earthHor;
    s.terrainFraction[i] = terrainFraction;
    s.earthCover[i] = earthCover;
    s.solarFraction[i] = solarFraction;
    s.sunlit[i] = solarFraction >= profile.min_solar_fraction ? 1 : 0;
    s.dark[i] = solarFraction <= 0 ? 1 : 0;
    s.earthVisible[i] = earthVisible ? 1 : 0;
    s.stationOk[i] = stationOk ? 1 : 0;
    s.conjunction[i] = conjunction ? 1 : 0;
    s.comm[i] = comm ? 1 : 0;
    s.lowElevation[i] = comm && earthAlt - earthHor < profile.low_elevation_deg ? 1 : 0;
  }
  return s;
}

// ------------------------------------------------------------------ window

/** Index range [first, first + samples) of a mission window, or null if it leaves the data. */
export function windowRange(
  series: Series,
  landingMs: number,
  durationDays: number,
): { first: number; samples: number } | null {
  const first = Math.round((landingMs - series.startMs) / 3600000 / series.stepHours);
  const samples = Math.round((durationDays * 24) / series.stepHours);
  if (first < 0 || first + samples > series.count) return null;
  return { first, samples };
}

/** Indicators over the mission window starting at `landingMs`; null outside the data. */
export function analyzeWindow(series: Series, landingMs: number, durationDays?: number): MissionWindow | null {
  const duration = durationDays ?? series.profile.duration_days;
  const range = windowRange(series, landingMs, duration);
  if (!range) return null;
  const { first, samples } = range;
  const step = series.stepHours;
  const total = samples * step;

  let sunlit = 0, solarSum = 0, darkRun = 0, darkLongest = 0, partial = 0, eclipse = 0, coverMax = 0;
  let comm = 0, outageRun = 0, outageLongest = 0, hidden = 0, gap = 0, conjunction = 0, low = 0;
  let sunMin = Infinity, sunMax = -Infinity, earthMin = Infinity, earthMax = -Infinity;

  for (let i = first; i < first + samples; i++) {
    sunlit += series.sunlit[i];
    solarSum += series.solarFraction[i];
    darkRun = series.dark[i] ? darkRun + 1 : 0;
    if (darkRun > darkLongest) darkLongest = darkRun;
    const tf = series.terrainFraction[i];
    if (tf > 0 && tf < 1) partial++;
    const cover = series.earthCover[i];
    if (cover > 0) eclipse++;
    if (cover > coverMax) coverMax = cover;
    const sunAbove = series.sunAboveTerrain[i];
    if (sunAbove < sunMin) sunMin = sunAbove;
    if (sunAbove > sunMax) sunMax = sunAbove;

    comm += series.comm[i];
    outageRun = series.comm[i] ? 0 : outageRun + 1;
    if (outageRun > outageLongest) outageLongest = outageRun;
    if (!series.earthVisible[i]) hidden++;
    else if (!series.stationOk[i]) gap++;
    conjunction += series.conjunction[i];
    low += series.lowElevation[i];
    const earthAbove = series.earthAboveTerrain[i];
    if (earthAbove < earthMin) earthMin = earthAbove;
    if (earthAbove > earthMax) earthMax = earthAbove;
  }

  return {
    landingMs,
    endMs: landingMs + duration * 86400000,
    duration_days: duration,
    power: {
      sunlit_pct: (100 * sunlit * step) / total,
      mean_solar_fraction_pct: (100 * solarSum) / samples,
      longest_darkness_h: darkLongest * step,
      dark_at_landing: series.dark[first] === 1,
      partial_disk_h: partial * step,
      earth_eclipse_h: eclipse * step,
      max_earth_cover_pct: 100 * coverMax,
      sun_above_terrain_deg: [sunMin, sunMax],
    },
    comm: {
      available_pct: (100 * comm * step) / total,
      longest_outage_h: outageLongest * step,
      terrain_occultation_h: hidden * step,
      station_gap_h: gap * step,
      conjunction_h: conjunction * step,
      low_elevation_h: low * step,
      earth_above_terrain_deg: [earthMin, earthMax],
    },
  };
}

// ------------------------------------------------------------------- score

/** 0 up to half the limit, rising linearly to 100 at the limit or beyond. */
function limitRisk(value: number, limit: number): number {
  const used = value / limit;
  return 100 * Math.min(1, Math.max(0, (used - COMFORT_FRACTION) / (1 - COMFORT_FRACTION)));
}

/** 0 when the requirement is met, 100 when nothing of it is delivered. */
function shortfallRisk(value: number, required: number): number {
  return 100 * Math.min(1, Math.max(0, (required - value) / required));
}

export function riskLevel(score: number): RiskLevel {
  return score < 33 ? "low" : score < 66 ? "medium" : "high";
}

/**
 * Risk scores (0-100) for a mission window. Each category is the worse of its two tests;
 * the overall score is the worst category, because any single one can end the mission.
 * `slopeP95Deg` null = no surface statistics, the surface score is then left out.
 */
export function scoreWindow(window: MissionWindow, profile: Profile, slopeP95Deg: number | null): Score {
  const power = Math.max(
    limitRisk(window.power.longest_darkness_h, profile.battery_survival_h),
    shortfallRisk(window.power.sunlit_pct, profile.min_sunlit_pct),
  );
  const comm = Math.max(
    limitRisk(window.comm.longest_outage_h, profile.max_comm_outage_h),
    shortfallRisk(window.comm.available_pct, profile.min_comm_pct),
  );
  const surface = slopeP95Deg === null ? null : limitRisk(slopeP95Deg, profile.max_slope_deg);
  let overall = power;
  let driver: RiskCategory = "power";
  if (comm > overall) {
    overall = comm;
    driver = "comm";
  }
  if (surface !== null && surface > overall) {
    overall = surface;
    driver = "surface";
  }
  return { power, comm, surface, overall, level: riskLevel(overall), driver };
}

/** Score every possible landing date in the data, one row per `stepDays`. */
export function scanLandingDates(series: Series, slopeP95Deg: number | null, stepDays = 1): ScanRow[] {
  const profile = series.profile;
  const lastMs = series.startMs + (series.count - 1) * series.stepHours * 3600000;
  const rows: ScanRow[] = [];
  for (
    let landingMs = series.startMs;
    landingMs + profile.duration_days * 86400000 <= lastMs;
    landingMs += stepDays * 86400000
  ) {
    const window = analyzeWindow(series, landingMs);
    if (!window) break;
    const score = scoreWindow(window, profile, slopeP95Deg);
    rows.push({
      landingMs,
      sunlit_pct: window.power.sunlit_pct,
      longest_darkness_h: window.power.longest_darkness_h,
      comm_pct: window.comm.available_pct,
      longest_comm_outage_h: window.comm.longest_outage_h,
      risk_power: score.power,
      risk_comm: score.comm,
      risk_overall: score.overall,
      level: score.level,
    });
  }
  return rows;
}
