// Checks the TypeScript risk engine against the backend results in ../data/risk_<site>.json.
// Run after build-data: `npm run validate`. Exits with code 1 on any mismatch.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeWindow,
  buildSeries,
  raisedHorizon,
  scanLandingDates,
  scoreWindow,
  type MissionWindow,
  type Profile,
  type Score,
} from "../src/engine/risk.ts";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, DEFAULT_PROFILE } from "../src/engine/risk.ts";
import { findTransitions, limbClearance, nextTransition } from "../src/engine/events.ts";
import { bestPoint, scoreGrid, type TerrainGrid } from "../src/engine/grid.ts";
import { estimateMastHorizon } from "../src/engine/mast.ts";
import { sampleIndex, skyFromVectors, type VectorTable } from "../src/engine/sky.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicData = join(here, "..", "public", "data");
const backendData = join(here, "..", "..", "data");
/** The backend rounds every float to 3 decimals. */
const TOLERANCE = 0.00051;

const manifest = JSON.parse(readFileSync(join(publicData, "manifest.json"), "utf8"));
const count: number = manifest.count;

function int32Columns(file: string, columns: number, scale: number): Float64Array[] {
  const bytes = readFileSync(join(publicData, file));
  const raw = new Int32Array(bytes.buffer, bytes.byteOffset, columns * count);
  return Array.from({ length: columns }, (_, c) => Float64Array.from(raw.subarray(c * count, (c + 1) * count), (v) => v / scale));
}

const dsn = int32Columns("dsn.bin", 3, manifest.dsnScale);
const stationMaxAlt = Float64Array.from({ length: count }, (_, i) => Math.max(dsn[0][i], dsn[1][i], dsn[2][i]));
const parseUtc = (text: string) => Date.parse(text.replace(/Z$/, ":00Z"));

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const same =
    typeof expected === "number" && typeof actual === "number"
      ? Math.abs(actual - expected) <= TOLERANCE
      : Array.isArray(expected) && Array.isArray(actual)
        ? expected.every((v, i) => Math.abs(actual[i] - v) <= TOLERANCE)
        : actual === expected;
  if (!same) {
    failures++;
    if (failures <= 20) console.log(`  MISMATCH ${label}: engine ${JSON.stringify(actual)} backend ${JSON.stringify(expected)}`);
  }
}

function checkWindow(label: string, window: MissionWindow | null, expected: any) {
  if (!window) return check(`${label} window`, null, "a window");
  check(`${label} landing`, window.landingMs, parseUtc(expected.landing));
  for (const [key, value] of Object.entries(expected.power)) check(`${label} power.${key}`, (window.power as any)[key], value);
  for (const [key, value] of Object.entries(expected.comm)) check(`${label} comm.${key}`, (window.comm as any)[key], value);
}

function checkScore(label: string, score: Score, expected: any) {
  for (const [key, value] of Object.entries(expected)) check(`${label} score.${key}`, (score as any)[key], value);
}

for (const site of manifest.sites) {
  const expected = JSON.parse(readFileSync(join(backendData, `risk_${site.key}.json`), "utf8"));
  const horizonDoc = JSON.parse(readFileSync(join(publicData, `horizon_${site.key}.json`), "utf8"));
  const [sunAz, sunAlt, earthAz, earthAlt] = int32Columns(`sky_${site.key}.bin`, 4, manifest.skyScale);
  const profile: Profile = expected.profile;
  const slope: number | null = horizonDoc.surface?.slope_landing_deg?.p95 ?? horizonDoc.surface?.slope_lola_deg?.p95 ?? null;

  const series = buildSeries(
    { startMs: Date.parse(manifest.start), stepHours: manifest.stepMinutes / 60, count, sunAz, sunAlt, earthAz, earthAlt },
    { stepDeg: horizonDoc.azimuth_step_deg, horizonDeg: horizonDoc.horizon_deg },
    stationMaxAlt,
    profile,
  );

  const before = failures;
  const landingMs = parseUtc(expected.window.landing);
  const window = analyzeWindow(series, landingMs);
  checkWindow("window", window, expected.window);
  if (window) checkScore("window", scoreWindow(window, profile, slope), expected.score);

  // The same window with the horizon raised by the map's height error.
  const uncertain = expected.horizon_uncertainty;
  if (uncertain) {
    const raised = raisedHorizon({ stepDeg: horizonDoc.azimuth_step_deg, horizonDeg: horizonDoc.horizon_deg }, horizonDoc.horizon_range_km, uncertain.height_error_m);
    check("map error max margin", raised.maxDeg, uncertain.margin_deg.max);
    const worse = buildSeries(
      { startMs: Date.parse(manifest.start), stepHours: manifest.stepMinutes / 60, count, sunAz, sunAlt, earthAz, earthAlt },
      raised.horizon,
      stationMaxAlt,
      profile,
    );
    const w = analyzeWindow(worse, landingMs);
    checkWindow("map error", w, uncertain.window);
    if (w) checkScore("map error", scoreWindow(w, profile, slope), uncertain.score);
    check("map error low-risk dates", scanLandingDates(worse, slope).filter((row) => row.level === "low").length, uncertain.low_risk_dates);
  }

  for (const slip of expected.slips) {
    const w = analyzeWindow(series, landingMs + slip.slip_days * 86400000);
    checkWindow(`slip +${slip.slip_days}d`, w, slip.window);
    if (w) checkScore(`slip +${slip.slip_days}d`, scoreWindow(w, profile, slope), slip.score);
  }

  const scan = scanLandingDates(series, slope);
  check("scan length", scan.length, expected.scan.length);
  expected.scan.forEach((row: any, i: number) => {
    const mine = scan[i];
    if (!mine) return;
    check(`scan[${i}] landing`, mine.landingMs, parseUtc(row.landing));
    for (const key of ["sunlit_pct", "longest_darkness_h", "comm_pct", "longest_comm_outage_h", "risk_power", "risk_comm", "risk_overall", "level"]) {
      check(`scan[${i}] ${key}`, (mine as any)[key], row[key]);
    }
  });
  console.log(`${site.key}: ${failures === before ? "OK" : `${failures - before} mismatches`} (window, ${expected.slips.length} slips, ${expected.scan.length} scan rows)`);
}

// ---- Site-independent path: vectors table -> angles -> grid of nearby points.
// Angles must reproduce the per-site tables; the center of each precomputed grid, scored from
// the vectors table, must reproduce the backend's mission window for that site.
/** Largest accepted angle difference, degrees (the plan's target). */
const ANGLE_TOLERANCE = 0.01;

if (manifest.vectors) {
  const v = manifest.vectors;
  const bytes = readFileSync(join(publicData, "vectors.bin"));
  const raw = new Float32Array(bytes.buffer, bytes.byteOffset, 6 * v.count);
  const column = (c: number) => raw.subarray(c * v.count, (c + 1) * v.count);
  const vectors: VectorTable = {
    startMs: Date.parse(v.start),
    stepHours: v.stepMinutes / 60,
    count: v.count,
    sun: [column(0), column(1), column(2)],
    earth: [column(3), column(4), column(5)],
  };
  const stationBytes = readFileSync(join(publicData, "stations.bin"));
  const stationRaw = new Int32Array(stationBytes.buffer, stationBytes.byteOffset, 3 * v.count);
  const stationsLong = Float64Array.from({ length: v.count }, (_, i) =>
    Math.max(stationRaw[i], stationRaw[v.count + i], stationRaw[2 * v.count + i]) / manifest.dsnScale,
  );

  for (const site of manifest.sites) {
    const before = failures;
    const table = int32Columns(`sky_${site.key}.bin`, 4, manifest.skyScale);
    const first = sampleIndex(vectors, Date.parse(manifest.start));
    const sky = skyFromVectors(vectors, site.lat, site.lon, 0, { first, count });
    let worst = 0;
    for (let i = 0; i < count; i++) {
      const cosSun = Math.cos((sky.sunAlt[i] * Math.PI) / 180);
      const cosEarth = Math.cos((sky.earthAlt[i] * Math.PI) / 180);
      const wrap = (d: number) => Math.abs(((d + 540) % 360) - 180);
      worst = Math.max(
        worst,
        wrap(sky.sunAz[i] - table[0][i]) * cosSun,
        Math.abs(sky.sunAlt[i] - table[1][i]),
        wrap(sky.earthAz[i] - table[2][i]) * cosEarth,
        Math.abs(sky.earthAlt[i] - table[3][i]),
      );
    }
    if (!(worst <= ANGLE_TOLERANCE)) {
      failures++;
      console.log(`  MISMATCH ${site.key} vectors: angles differ by up to ${worst.toFixed(5)} deg`);
    }

    let gridNote = "no grid file";
    if (site.grid) {
      const expected = JSON.parse(readFileSync(join(backendData, `risk_${site.key}.json`), "utf8"));
      const grid: TerrainGrid = JSON.parse(readFileSync(join(publicData, `grid_${site.key}.json`), "utf8"));
      const scored = scoreGrid(grid, vectors, stationsLong, expected.profile, parseUtc(expected.window.landing));
      if (!scored) {
        check(`${site.key} grid window`, null, "a window");
      } else {
        checkWindow(`${site.key} grid center`, scored[0].window, expected.window);
        check(`${site.key} grid center score.power`, scored[0].score.power, expected.score.power);
        check(`${site.key} grid center score.comm`, scored[0].score.comm, expected.score.comm);
        const best = bestPoint(scored)!;
        gridNote =
          `grid ${scored.length} points, center risk ${scored[0].score.overall.toFixed(0)}, ` +
          `best ${best.point.north_m} m N / ${best.point.east_m} m E risk ${best.score.overall.toFixed(0)} ` +
          `(usable Sun ${best.window.power.sunlit_pct.toFixed(1)}%)`;
      }
    }
    console.log(`${site.key}: ${failures === before ? "OK" : "MISMATCH"} (vectors within ${worst.toFixed(5)} deg; ${gridNote})`);
  }

  // ---- Rise/set events of the UI's data path against the backend's `metrics --terrain`.
  // The UI interpolates the upper-limb clearance linearly between hourly samples; every
  // backend event must have a counterpart of the same direction, and the largest time
  // difference is reported.
  /** Largest accepted difference between an engine event and the backend's, minutes. */
  const EVENT_TOLERANCE_MIN = 5;
  let worstEventMin = 0;
  for (const site of manifest.sites) {
    const metricsPath = join(backendData, `metrics_${site.key}_terrain.json`);
    let metrics: any;
    try {
      metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    } catch {
      console.log(`${site.key}: no metrics file; events not checked`);
      continue;
    }
    const before = failures;
    const horizonDoc = JSON.parse(readFileSync(join(publicData, `horizon_${site.key}.json`), "utf8"));
    const sky = skyFromVectors(vectors, site.lat, site.lon, 0);
    const series = buildSeries(sky, { stepDeg: horizonDoc.azimuth_step_deg, horizonDeg: horizonDoc.horizon_deg }, stationsLong, DEFAULT_PROFILE);
    const periodEnd = sampleIndex(vectors, parseUtc(metrics.period.end));
    let siteWorst = 0;
    let compared = 0;
    const tracks = [
      ["sun", series.sunAboveTerrain, SUN_RADIUS_DEG, "sunrise"],
      ["earth", series.earthAboveTerrain, EARTH_RADIUS_DEG, "earthrise"],
    ] as const;
    for (const [track, above, radius, riseType] of tracks) {
      const transitions = findTransitions(limbClearance(above, radius));
      const mine: { ms: number; rising: boolean }[] = [];
      for (let next = nextTransition(transitions, 0); next && next.position < periodEnd; next = nextTransition(transitions, next.position)) {
        mine.push({ ms: vectors.startMs + next.position * vectors.stepHours * 3600000, rising: next.rising });
      }
      const theirs: { utc: string; type: string }[] = metrics[track].events;
      check(`${site.key} ${track} event count`, mine.length, theirs.length);
      theirs.forEach((event, i) => {
        if (!mine[i]) return;
        check(`${site.key} ${track} event ${i} direction`, mine[i].rising, event.type === riseType);
        const minutes = Math.abs(mine[i].ms - parseUtc(event.utc)) / 60000;
        siteWorst = Math.max(siteWorst, minutes);
        compared++;
      });
    }
    if (siteWorst > EVENT_TOLERANCE_MIN) {
      failures++;
      console.log(`  MISMATCH ${site.key} events: up to ${siteWorst.toFixed(1)} min from the backend`);
    }
    worstEventMin = Math.max(worstEventMin, siteWorst);
    console.log(`${site.key}: ${failures === before ? "OK" : "MISMATCH"} (${compared} rise/set events within ${siteWorst.toFixed(1)} min of the backend)`);
  }
  console.log(`Largest rise/set difference: ${worstEventMin.toFixed(1)} min`);

  // ---- Mast slider: first-order horizon estimate against the backend's `mast` command
  // (which recomputes the horizon from the height map). Reported, not enforced: the estimate
  // is labelled as one in the UI and is expected to lean optimistic.
  let worstMastPts = 0;
  for (const site of manifest.sites) {
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(join(backendData, `mast_${site.key}.json`), "utf8"));
    } catch {
      continue;
    }
    const horizonDoc = JSON.parse(readFileSync(join(publicData, `horizon_${site.key}.json`), "utf8"));
    const base = { stepDeg: horizonDoc.azimuth_step_deg, horizonDeg: horizonDoc.horizon_deg };
    const first = sampleIndex(vectors, parseUtc(doc.period[0]));
    const samples = sampleIndex(vectors, parseUtc(doc.period[1])) - first;
    const sky = skyFromVectors(vectors, site.lat, site.lon, 0, { first, count: samples });
    const parts: string[] = [];
    for (const row of doc.rows) {
      const horizon = row.mast_m === horizonDoc.mast_m ? base : estimateMastHorizon(base, horizonDoc.horizon_range_km, horizonDoc.mast_m, row.mast_m);
      const series = buildSeries(sky, horizon, null, DEFAULT_PROFILE);
      let visible = 0;
      for (let i = 0; i < samples; i++) if (series.sunAboveTerrain[i] + SUN_RADIUS_DEG > 0) visible++;
      const pct = (100 * visible) / samples;
      if (row.mast_m !== horizonDoc.mast_m) worstMastPts = Math.max(worstMastPts, Math.abs(pct - row.sun_visible_pct));
      parts.push(`${row.mast_m} m ${pct.toFixed(1)}% (backend ${row.sun_visible_pct.toFixed(1)}%)`);
    }
    console.log(`${site.key}: mast estimate, Sun visible over the year: ${parts.join(", ")}`);
  }
  console.log(`Largest mast-estimate difference: ${worstMastPts.toFixed(1)} points of yearly Sun visibility`);
} else {
  console.log("vectors table not built; skipped the site-independent checks");
}

if (failures > 0) {
  console.log(`FAILED: ${failures} mismatches`);
  process.exit(1);
}
console.log("Engine matches the backend for every site.");
