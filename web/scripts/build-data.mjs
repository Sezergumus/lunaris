// Converts the backend outputs in ../data into compact files under public/data.
//
//   sky_<site>.bin      Int32 columns [sun_az, sun_alt, earth_az, earth_alt], degrees * 1e5
//   dsn.bin             Int32 columns [goldstone, madrid, canberra] Moon elevation, degrees * 1e3
//   horizon_<site>.json terrain horizon and surface statistics (minified copy)
//   vectors.bin         Float32 columns [sun x, y, z, earth x, y, z], km, Moon-fixed frame;
//                       one table for every coordinate (custom points, nearby spots)
//   stations.bin        like dsn.bin, on the time axis of vectors.bin
//   grid_<site>.json    horizon and slope for a square of points around each site (copy)
//   manifest.json       time axes, scales and the list of sites
//
// Integer scaling keeps every decimal the backend wrote, so the browser works on exactly the
// same numbers as the Python code. Nothing here is hard-coded to a date range or site list.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "data");
const target = join(here, "..", "public", "data");
const SKY_SCALE = 1e5;
const DSN_SCALE = 1e3;

function readCsv(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((line) => line.split(","));
  return { header, rows };
}

function columnsToInt32(csv, names, scale) {
  const count = csv.rows.length;
  const out = new Int32Array(names.length * count);
  names.forEach((name, c) => {
    const index = csv.header.indexOf(name);
    if (index < 0) throw new Error(`missing column ${name}`);
    for (let i = 0; i < count; i++) out[c * count + i] = Math.round(Number(csv.rows[i][index]) * scale);
  });
  return out;
}

function toIso(utc) {
  // "2026-12-01T00:00Z" -> "2026-12-01T00:00:00Z"
  return utc.replace(/Z$/, ":00Z");
}

mkdirSync(target, { recursive: true });

// The station table may run longer than the per-site tables (it shares its date range with
// ephemeris_vectors.csv). The files written here cover the per-site range, so it is cut to
// that length; both tables must start at the same instant.
const dsn = readCsv(join(source, "dsn_moon.csv"));
const stationColumns = ["goldstone_alt_deg", "madrid_alt_deg", "canberra_alt_deg"];

// Site-independent table. It has its own, longer time axis; the station table must cover it.
let vectors = null;
const vectorPath = join(source, "ephemeris_vectors.csv");
if (existsSync(vectorPath)) {
  const csv = readCsv(vectorPath);
  const count = csv.rows.length;
  if (dsn.rows.length < count || dsn.rows[0][0] !== csv.rows[0][0] || dsn.rows[count - 1][0] !== csv.rows[count - 1][0]) {
    throw new Error("ephemeris_vectors.csv and dsn_moon.csv do not share one time axis");
  }
  const names = ["sun_x_km", "sun_y_km", "sun_z_km", "earth_x_km", "earth_y_km", "earth_z_km"];
  const out = new Float32Array(names.length * count);
  names.forEach((name, c) => {
    const index = csv.header.indexOf(name);
    if (index < 0) throw new Error(`missing column ${name}`);
    for (let i = 0; i < count; i++) out[c * count + i] = Number(csv.rows[i][index]);
  });
  writeFileSync(join(target, "vectors.bin"), Buffer.from(out.buffer));
  writeFileSync(
    join(target, "stations.bin"),
    Buffer.from(columnsToInt32({ header: dsn.header, rows: dsn.rows.slice(0, count) }, stationColumns, DSN_SCALE).buffer),
  );
  vectors = {
    start: toIso(csv.rows[0][0]),
    stepMinutes: (Date.parse(toIso(csv.rows[1][0])) - Date.parse(toIso(csv.rows[0][0]))) / 60000,
    count,
    frame: "MOON_ME_DE421",
    unit: "km",
  };
}
const siteTable = readdirSync(source).find((file) => /^skyfield_.+\.csv$/.test(file));
if (siteTable) dsn.rows.length = Math.min(dsn.rows.length, readCsv(join(source, siteTable)).rows.length);
const utc = dsn.rows.map((r) => r[0]);
const stepMinutes = (Date.parse(toIso(utc[1])) - Date.parse(toIso(utc[0]))) / 60000;
writeFileSync(
  join(target, "dsn.bin"),
  Buffer.from(columnsToInt32(dsn, stationColumns, DSN_SCALE).buffer),
);

const sites = [];
for (const file of readdirSync(source).sort()) {
  const match = /^horizon_(.+)\.json$/.exec(file);
  if (!match) continue;
  const key = match[1];
  const horizon = JSON.parse(readFileSync(join(source, file), "utf8"));
  const sky = readCsv(join(source, `skyfield_${key}.csv`));
  if (sky.rows.length !== utc.length || sky.rows[0][0] !== utc[0]) {
    throw new Error(`skyfield_${key}.csv and dsn_moon.csv do not share one time axis`);
  }
  writeFileSync(
    join(target, `sky_${key}.bin`),
    Buffer.from(columnsToInt32(sky, ["sun_az_deg", "sun_alt_deg", "earth_az_deg", "earth_alt_deg"], SKY_SCALE).buffer),
  );
  writeFileSync(join(target, `horizon_${key}.json`), JSON.stringify(horizon));
  const gridPath = join(source, `grid_${key}.json`);
  const hasGrid = existsSync(gridPath);
  if (hasGrid) writeFileSync(join(target, `grid_${key}.json`), JSON.stringify(JSON.parse(readFileSync(gridPath, "utf8"))));
  sites.push({ ...horizon.site, grid: hasGrid });
}

const manifest = {
  start: toIso(utc[0]),
  stepMinutes,
  count: utc.length,
  skyScale: SKY_SCALE,
  dsnScale: DSN_SCALE,
  stations: ["goldstone", "madrid", "canberra"],
  vectors,
  sites,
};
writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`data: ${sites.length} sites, ${utc.length} samples from ${utc[0]} to ${utc.at(-1)}`);
if (vectors) console.log(`data: vectors table, ${vectors.count} samples from ${vectors.start}`);
