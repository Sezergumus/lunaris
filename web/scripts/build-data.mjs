// Converts the backend outputs in ../data into compact files under public/data.
//
//   sky_<site>.bin      Int32 columns [sun_az, sun_alt, earth_az, earth_alt], degrees * 1e5
//   dsn.bin             Int32 columns [goldstone, madrid, canberra] Moon elevation, degrees * 1e3
//   horizon_<site>.json terrain horizon and surface statistics (minified copy)
//   manifest.json       time axis, scales and the list of sites
//
// Integer scaling keeps every decimal the backend wrote, so the browser works on exactly the
// same numbers as the Python code. Nothing here is hard-coded to a date range or site list.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const siteTable = readdirSync(source).find((file) => /^skyfield_.+\.csv$/.test(file));
if (siteTable) dsn.rows.length = Math.min(dsn.rows.length, readCsv(join(source, siteTable)).rows.length);
const utc = dsn.rows.map((r) => r[0]);
const stepMinutes = (Date.parse(toIso(utc[1])) - Date.parse(toIso(utc[0]))) / 60000;
writeFileSync(
  join(target, "dsn.bin"),
  Buffer.from(columnsToInt32(dsn, ["goldstone_alt_deg", "madrid_alt_deg", "canberra_alt_deg"], DSN_SCALE).buffer),
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
  sites.push({ ...horizon.site });
}

const manifest = {
  start: toIso(utc[0]),
  stepMinutes,
  count: utc.length,
  skyScale: SKY_SCALE,
  dsnScale: DSN_SCALE,
  stations: ["goldstone", "madrid", "canberra"],
  sites,
};
writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`data: ${sites.length} sites, ${utc.length} samples from ${utc[0]} to ${utc.at(-1)}`);
