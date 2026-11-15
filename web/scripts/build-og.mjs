// Builds the Open Graph banner (1200x630) from the project's own data:
// the five sites on the south polar map, and the LOLA terrain horizon at Mons Mouton
// with the Sun and Earth tracks over a 14-day mission.
//
// Usage (from web/): node scripts/build-og.mjs
// Writes og/og.html next to this script's output and renders public/og-image.png with
// a local Chrome or Edge in headless mode.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(WEB, "..", "data");
const OUT_DIR = join(WEB, "node_modules", ".og");
const OUT_HTML = join(OUT_DIR, "og.html");
const OUT_PNG = join(WEB, "public", "og-image.png");
const readJson = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

const DEG = Math.PI / 180;
const W = 1200;
const H = 630;
const f1 = (v) => v.toFixed(1);

// Stars, deterministic so the banner is reproducible.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let stars = "";
for (let i = 0; i < 140; i++) {
  const x = rnd() * W;
  const y = rnd() * H;
  const r = rnd() < 0.9 ? 0.6 + rnd() * 0.5 : 1.2 + rnd() * 0.5;
  stars += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.12 + rnd() * 0.4).toFixed(2)}"/>`;
}

// Polar disc: south polar stereographic, longitude 0 up, as on the app's map.
const CX = 905;
const CY = 300;
const R = 285;
const MAX_COLAT = 22; // colatitude at the rim of the disc
const proj = (lat, lon) => {
  const t = Math.tan(((90 + lat) * DEG) / 2) / Math.tan((MAX_COLAT * DEG) / 2);
  return [CX + R * t * Math.sin(lon * DEG), CY - R * t * Math.cos(lon * DEG)];
};

let graticule = "";
for (const co of [5, 10, 15, 20]) {
  const [, y] = proj(-90 + co, 0);
  const [lx, ly] = proj(-90 + co, 195); // labels in the empty lower half, between meridians
  graticule += `<circle cx="${CX}" cy="${CY}" r="${f1(CY - y)}" fill="none" stroke="#fff" stroke-opacity="0.09"/>`;
  graticule += `<text x="${f1(lx)}" y="${f1(ly - 5)}" text-anchor="middle" font-size="11" fill="rgba(235,235,245,0.3)" class="mono">${90 - co}°S</text>`;
}
for (let lon = 0; lon < 360; lon += 30) {
  const [x0, y0] = proj(-89.4, lon);
  const [x1, y1] = proj(-90 + MAX_COLAT, lon);
  graticule += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="#fff" stroke-opacity="0.07"/>`;
}

const ranking = readJson("ranking.json");
const levelColor = { low: "#30d158", moderate: "#ffd60a", medium: "#ffd60a", high: "#ff453a" };
const label = {
  mons_mouton: ["Mons Mouton", "r"],
  chandrayaan3: ["Chandrayaan-3", "r"],
  shackleton: ["Shackleton", "r"],
  connecting_ridge: ["Connecting Ridge", "l"],
  malapert_a: ["Malapert A", "r"],
};
let sites = "";
for (const s of ranking.sites) {
  const [x, y] = proj(s.lat, s.lon);
  const c = levelColor[s.score.level] ?? "#0a84ff";
  const [name, side] = label[s.key] ?? [s.name, "r"];
  const tx = side === "r" ? x + 14 : x - 14;
  sites += `<circle cx="${f1(x)}" cy="${f1(y)}" r="14" fill="${c}" opacity="0.16"/>
  <circle cx="${f1(x)}" cy="${f1(y)}" r="5.5" fill="${c}" stroke="#050507" stroke-width="2"/>
  <text x="${f1(tx)}" y="${f1(y + 5)}" text-anchor="${side === "r" ? "start" : "end"}" font-size="15" font-weight="600" fill="rgba(255,255,255,0.92)" paint-order="stroke" stroke="#050507" stroke-width="4" stroke-linejoin="round">${name}</text>`;
}

// Horizon panorama for Mons Mouton with the Sun and Earth tracks.
const PX = 64;
const PY = 458;
const PW = 560;
const PH = 118;
const EL_LO = -2.5;
const EL_HI = 11.5;
const px = (az) => PX + (az / 360) * PW;
const py = (el) => PY + PH - ((el - EL_LO) / (EL_HI - EL_LO)) * PH;

const horizon = readJson("horizon_mons_mouton.json");
const step = horizon.azimuth_step_deg;
let ground = `M${PX},${PY + PH}`;
horizon.horizon_deg.forEach((e, i) => (ground += `L${f1(px(i * step))},${f1(py(e))}`));
ground += `L${PX + PW},${f1(py(horizon.horizon_deg[0]))}L${PX + PW},${PY + PH}Z`;

const landing = ranking.landing.slice(0, 10);
const end = new Date(Date.parse(ranking.landing) + 14 * 864e5).toISOString().slice(0, 10);
const rows = readFileSync(join(DATA, "skyfield_mons_mouton.csv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => l.split(","))
  .filter((r) => r[0] >= landing && r[0] < end)
  .map((r) => r.slice(1).map(Number));
const track = (ai, ei) => {
  let d = "";
  let prev = null;
  for (const r of rows) {
    const az = ((r[ai] % 360) + 360) % 360;
    d += (prev === null || Math.abs(az - prev) > 180 ? "M" : "L") + f1(px(az)) + "," + f1(py(r[ei]));
    prev = az;
  }
  return d;
};
const sun = track(0, 1);
const earth = track(2, 3);

let azTicks = "";
for (const [az, t] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]]) {
  azTicks += `<text x="${f1(px(az))}" y="${PY + PH + 19}" text-anchor="middle" font-size="11" fill="rgba(235,235,245,0.4)" class="mono">${t}</text>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#050507}
svg{display:block;font-family:"Segoe UI Variable Display","SF Pro Display","Segoe UI","Inter",system-ui,sans-serif}
.mono{font-family:"Cascadia Mono","SF Mono",Consolas,monospace}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="glow" cx="${CX}" cy="${CY}" r="${R * 1.6}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#0a84ff" stop-opacity="0.16"/><stop offset="0.55" stop-color="#0a84ff" stop-opacity="0.04"/><stop offset="1" stop-color="#0a84ff" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="disc" cx="${CX - R * 0.35}" cy="${CY - R * 0.4}" r="${R * 1.5}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2a2a30"/><stop offset="0.6" stop-color="#141418"/><stop offset="1" stop-color="#0a0a0d"/>
  </radialGradient>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a2e" stop-opacity="0"/><stop offset="1" stop-color="#0d1a2e" stop-opacity="0.9"/></linearGradient>
  <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset="1" stop-color="#121216"/></linearGradient>
  <clipPath id="pc"><rect x="${PX}" y="${PY - 6}" width="${PW}" height="${PH + 6}"/></clipPath>
  <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
</defs>
${stars}
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#disc)" stroke="rgba(255,255,255,0.12)"/>
${graticule}
<circle cx="${CX}" cy="${CY}" r="3" fill="none" stroke="rgba(255,255,255,0.5)"/>
${sites}

<g transform="translate(64,0)">
  <g transform="translate(0,84)">
    <circle cx="20" cy="20" r="19" fill="#050507" stroke="rgba(255,255,255,0.18)"/>
    <circle cx="20" cy="20" r="13" fill="none" stroke="#fff" stroke-width="2.2"/>
    <path d="M20 7a13 13 0 0 0 0 26z" fill="#fff"/>
    <text x="54" y="26" font-size="15" font-weight="600" letter-spacing="2.4" fill="rgba(235,235,245,0.55)">NASA SPACE APPS 2026</text>
  </g>
  <text x="-5" y="222" font-size="100" font-weight="700" letter-spacing="-3.5" fill="#fff">Lunaris</text>
  <text y="276" font-size="27" font-weight="600" letter-spacing="-0.4" fill="rgba(255,255,255,0.92)">Lunar south pole landing site comparison</text>
  <text y="316" font-size="19" fill="rgba(235,235,245,0.6)">Sunlight, Earth visibility and terrain risk,</text>
  <text y="342" font-size="19" fill="rgba(235,235,245,0.6)">computed from LOLA elevation data.</text>
</g>

<rect x="${PX}" y="${PY - 6}" width="${PW}" height="${PH + 6}" fill="url(#sky)" opacity="0.7"/>
<g clip-path="url(#pc)">
  <line x1="${PX}" x2="${PX + PW}" y1="${f1(py(0))}" y2="${f1(py(0))}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3 4"/>
  <path d="${earth}" fill="none" stroke="#64d2ff" stroke-width="5" opacity="0.35" filter="url(#soft)"/>
  <path d="${earth}" fill="none" stroke="#64d2ff" stroke-width="2"/>
  <path d="${sun}" fill="none" stroke="#ffb340" stroke-width="6" opacity="0.4" filter="url(#soft)"/>
  <path d="${sun}" fill="none" stroke="#ffb340" stroke-width="2.4"/>
  <path d="${ground}" fill="url(#gnd)" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>
</g>
${azTicks}
<text x="${PX}" y="${PY - 18}" font-size="13" font-weight="600" letter-spacing="1.2" fill="rgba(235,235,245,0.5)">MONS MOUTON · TERRAIN HORIZON · 14 DAYS</text>
<g transform="translate(${PX + PW - 120},${PY - 23})" font-size="13" fill="rgba(235,235,245,0.7)">
  <rect width="14" height="3" fill="#ffb340" rx="1.5"/><text x="20" y="5">Sun</text>
  <rect x="62" width="14" height="3" fill="#64d2ff" rx="1.5"/><text x="82" y="5">Earth</text>
</g>
<text x="${W - 40}" y="${H - 32}" text-anchor="end" font-size="15" fill="rgba(235,235,245,0.45)" class="mono">lunaris-lovat.vercel.app</text>
</svg></body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_HTML, html);

const browsers = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const browser = browsers.find((b) => existsSync(b));
if (!browser) {
  console.log(`No Chrome or Edge found (set CHROME_PATH). HTML written to ${OUT_HTML}`);
  process.exit(1);
}
execFileSync(browser, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  `--window-size=${W},${H}`,
  `--screenshot=${OUT_PNG}`,
  pathToFileURL(OUT_HTML).href,
]);
console.log(`Wrote ${OUT_PNG}`);
