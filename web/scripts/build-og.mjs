// Builds the Open Graph banner (1200x630): the logo and title on the left, the Moon's
// surface on the right.
//
// Usage (from web/): npm run og
// Writes the HTML to node_modules/.og/og.html and renders public/og-image.png with a
// local Chrome or Edge in headless mode (set CHROME_PATH to use another browser).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(WEB, "node_modules", ".og");
const OUT_HTML = join(OUT_DIR, "og.html");
const OUT_PNG = join(WEB, "public", "og-image.png");

const W = 1200;
const H = 630;
const f1 = (v) => v.toFixed(1);

// Deterministic random numbers so the banner is reproducible.
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

let stars = "";
for (let i = 0; i < 120; i++) {
  const x = rnd() * W * 0.62;
  const y = rnd() * H;
  const r = rnd() < 0.9 ? 0.5 + rnd() * 0.5 : 1.1 + rnd() * 0.5;
  stars += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.1 + rnd() * 0.4).toFixed(2)}"/>`;
}

// The Moon: a large disc that leaves the frame on the right, lit from the upper left.
const MX = 1010;
const MY = 330;
const MR = 360;

// Craters lit from the upper left: the inner wall facing the Sun (lower right) is bright,
// the one under the upper-left rim lies in shadow.
let craters = "";
for (let i = 0; i < 140; i++) {
  const a = rnd() * Math.PI * 2;
  const d = Math.sqrt(rnd()) * MR * 0.97;
  const x = MX + Math.cos(a) * d;
  const y = MY + Math.sin(a) * d;
  const u = rnd();
  const r = u < 0.04 ? 22 + rnd() * 16 : u < 0.25 ? 8 + rnd() * 8 : 1.5 + rnd() * 4;
  // Foreshortening toward the limb.
  const k = Math.sqrt(Math.max(0.2, 1 - (d / MR) ** 2));
  const ang = (Math.atan2(y - MY, x - MX) * 180) / Math.PI;
  const o = r * 0.14;
  craters += `<g transform="translate(${f1(x)},${f1(y)}) rotate(${f1(ang)}) scale(${k.toFixed(2)},1) rotate(${f1(-ang)})">
    <circle cx="${f1(o)}" cy="${f1(o)}" r="${f1(r)}" fill="#fff" opacity="0.13"/>
    <circle cx="${f1(-o * 0.5)}" cy="${f1(-o * 0.5)}" r="${f1(r * 0.93)}" fill="#000" opacity="0.2"/>
    <circle cx="${f1(o * 0.6)}" cy="${f1(o * 0.6)}" r="${f1(r * 0.72)}" fill="#000" opacity="0.06"/>
  </g>`;
}

// A few dark maria-like patches.
let maria = "";
for (const [dx, dy, rx, ry, rot] of [
  [-150, -120, 120, 80, -20],
  [-40, 40, 150, 95, 15],
  [-210, 120, 90, 60, 35],
  [60, -210, 80, 50, -10],
]) {
  maria += `<ellipse cx="${MX + dx}" cy="${MY + dy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${MX + dx} ${MY + dy})" fill="#000" opacity="0.18" filter="url(#blur)"/>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#050507}
svg{display:block;font-family:"Segoe UI Variable Display","SF Pro Display","Segoe UI","Inter",system-ui,sans-serif}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="halo" cx="${MX}" cy="${MY}" r="${MR * 1.35}" gradientUnits="userSpaceOnUse">
    <stop offset="0.72" stop-color="#9fb4d8" stop-opacity="0.16"/><stop offset="1" stop-color="#9fb4d8" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="body" cx="${MX - MR * 0.45}" cy="${MY - MR * 0.4}" r="${MR * 1.55}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#d9d8d3"/><stop offset="0.45" stop-color="#9c9b97"/><stop offset="0.8" stop-color="#3c3c3f"/><stop offset="1" stop-color="#121214"/>
  </radialGradient>
  <radialGradient id="floor"><stop offset="0" stop-color="#000" stop-opacity="0.32"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/></radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0.35"/>
  </linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="5" seed="4"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.15"/>
  </filter>
  <filter id="fine" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="9"/>
    <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 -0.1"/>
  </filter>
  <filter id="blur"><feGaussianBlur stdDeviation="22"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="0.7"/></filter>
  <clipPath id="moon"><circle cx="${MX}" cy="${MY}" r="${MR}"/></clipPath>
  <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#050507" stop-opacity="0.45"/><stop offset="0.25" stop-color="#050507" stop-opacity="0"/>
  </linearGradient>
</defs>
${stars}
<circle cx="${MX}" cy="${MY}" r="${MR * 1.35}" fill="url(#halo)"/>
<g clip-path="url(#moon)">
  <circle cx="${MX}" cy="${MY}" r="${MR}" fill="url(#body)"/>
  ${maria}
  <rect x="${MX - MR}" y="${MY - MR}" width="${MR * 2}" height="${MR * 2}" filter="url(#grain)" opacity="0.35"/>
  <g filter="url(#soft)">${craters}</g>
  <rect x="${MX - MR}" y="${MY - MR}" width="${MR * 2}" height="${MR * 2}" filter="url(#fine)" opacity="0.18"/>
  <circle cx="${MX + MR * 0.55}" cy="${MY + MR * 0.5}" r="${MR * 1.05}" fill="#050507" opacity="0.55" filter="url(#blur)"/>
  <rect x="${MX - MR}" y="${MY - MR}" width="${MR * 2}" height="${MR * 2}" fill="url(#fade)"/>
</g>

<g transform="translate(80,0)">
  <g transform="translate(0,212)">
    <circle cx="36" cy="36" r="34" fill="#050507" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
    <circle cx="36" cy="36" r="24" fill="none" stroke="#fff" stroke-width="3.6"/>
    <path d="M36 12a24 24 0 0 0 0 48z" fill="#fff"/>
    <text x="96" y="64" font-size="88" font-weight="700" letter-spacing="-3" fill="#fff">Lunaris</text>
  </g>
  <text y="350" font-size="30" font-weight="500" letter-spacing="-0.4" fill="rgba(235,235,245,0.72)">Lunar south pole landing site comparison</text>
</g>
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
