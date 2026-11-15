// Renderer, camera and draw order of the surface view.
//
// Draw order instead of one deep depth buffer: the sky (stars, glare, Sun, Earth, skyline
// curtain), then the terrain levels from the outermost to the innermost with the depth
// buffer cleared before each and the near / far planes set for that level. The levels are
// nested squares around the observer, so an outer level always lies behind an inner one
// along any line of sight. Frames are drawn on demand only.
//
// Light: terrain shadows come from the shadow pass (shadow.ts), recomputed only when the
// Sun moves and at most SHADOW_INTERVAL_MS apart. The ground under the observer follows the
// engine instead (its visible share of the Sun's disk), so the view and the metric cards
// never disagree about whether the observer stands in sunlight.
import * as THREE from "three";
import type { TerrainPatch } from "../data/load.ts";
import type { Horizon } from "../engine/risk.ts";
import { horizonAt } from "../engine/risk.ts";
import { destination, directionToScene, latLonToProjected, siteFrame, type SiteFrame } from "./geometry.ts";
import { ShadowPass } from "./shadow.ts";
import { SKY_DISTANCE, SkyLayer, type BodyState } from "./sky.ts";
import { buildLevels, type LevelMesh } from "./terrain.ts";

const DEG = Math.PI / 180;
/** Shadows are recomputed at most this often while the Sun moves (playback). */
const SHADOW_INTERVAL_MS = 50;
/** Ground within this distance of the observer takes the engine's light, meters (blend zone). */
const OBSERVER_ZONE_M = [60, 150] as const;
/** The lander's shadow is drawn up to this length; the label gives the true one. */
const LANDER_SHADOW_CAP_M = 90;
const LANDER_SHADOW_WIDTH_M = 1.6;
/** The drone camera stays at least this far above the ground under it, meters. */
const DRONE_CLEARANCE_M = 20;

export interface ViewState {
  sun: BodyState;
  earth: BodyState;
  /** Visible share of the Sun's disk at the observer, from the engine (0-1). */
  observerLit: number;
  /** Observer height above the ground, meters. */
  eyeHeightM: number;
  /** Camera position while flying to another point; default: eyeHeightM above the origin. */
  eye?: [number, number, number];
  /**
   * Drone view: the camera stands this far from the observer's position, back along the
   * direction it looks in (heading, pitch), and looks at it. Null = first person.
   */
  droneDistanceM?: number | null;
  headingDeg: number;
  pitchDeg: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /** Latitude of the place and the instant shown: they orient and turn the Earth's globe. */
  latDeg: number;
  timeMs: number;
}

const TERRAIN_VERTEX = /* glsl */ `
  attribute vec2 shadowUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vShadowUv;
  void main() {
    vPosition = position;
    vNormal = normal;
    vShadowUv = shadowUv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Lambert mixed with Lommel-Seeliger (mu0 / (mu0 + mu)), one grey albedo, a small fill
// light, and an exposure that follows the Sun's elevation. Tuned by eye; illustrative.
// The lit share comes from the shadow texture, and near the observer from the engine.
const TERRAIN_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float sunUp;
  uniform float exposure;
  uniform float fill;
  uniform sampler2D shadowMap;
  uniform float hasShadow;
  uniform float observerLit;
  uniform float observerBlend;
  uniform sampler2D heatMap;
  uniform float heatOn;
  uniform vec2 heatOrigin;
  uniform vec2 heatRowX;
  uniform vec2 heatRowY;
  uniform float heatSize;
  uniform float heatStep;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vShadowUv;

  // Fine surface detail below the 60 m height pixels: illustrative, not measured. It only
  // tilts the shading normal and tints the albedo; heights, shadows and the skyline are
  // untouched. Every scale fades out before it gets smaller than a screen pixel.
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Value noise: x = value (0-1), yz = gradient per unit of p.
  vec3 noised(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * vec2(b - a + (a - b - c + d) * u.y, c - a + (a - b - c + d) * u.x));
  }

  // Weight of a feature of this size (m) for a screen pixel covering "footprint" m of ground.
  float visible(float sizeM, float footprint) {
    return 1.0 - smoothstep(0.3, 0.7, footprint / sizeM);
  }

  // One bowl-shaped crater with a raised rim in some cells of a grid; returns the slope
  // (height gradient) at p.
  vec2 craters(vec2 p, float cell, float seed) {
    vec2 q = p / cell;
    vec2 i = floor(q);
    vec2 f = q - i;
    float pick = hash(i + seed);
    if (pick > 0.6) return vec2(0.0);
    vec2 center = 0.3 + 0.4 * vec2(hash(i + seed + 17.0), hash(i + seed + 31.0));
    float radius = 0.07 + 0.15 * hash(i + seed + 47.0);
    vec2 d = f - center;
    // An uneven outline, so the rims are not perfect circles.
    float t = length(d) / radius * (1.0 + 0.14 * (noised(q * 5.0 + seed).x - 0.5));
    // Slope along the radius: a flat floor, a wall that steepens toward the rim, and the
    // rim's outer flank falling away.
    float slope = t < 1.0 ? 0.3 * t * t * t : -0.13 * exp(-4.0 * (t - 1.0));
    float edge = 1.0 - smoothstep(0.38, 0.5, max(abs(f.x - 0.5), abs(f.y - 0.5)));
    // Older craters are softer.
    float age = 0.35 + 0.65 * hash(i + seed + 59.0);
    return normalize(d + 1e-6) * slope * edge * age;
  }

  // Slope of the fine relief at a ground position (m) and an albedo factor around 1.
  vec3 surfaceDetail(vec2 p, float footprint) {
    vec2 slope = vec2(0.0);
    float tone = 1.0;
    // Broad tone patches: ejecta and regolith maturity differ from place to place.
    tone += 0.10 * (noised(p / 900.0).x - 0.5) * visible(900.0, footprint);
    tone += 0.08 * (noised(p / 130.0 + 7.3).x - 0.5) * visible(130.0, footprint);
    if (footprint > 40.0) return vec3(slope, tone);
    // Rolling relief and grain, six scales from 45 m down to 0.35 m. The broad scales stay
    // gentle: the Sun is a few degrees up here, and a steeper swell would have to cast a
    // shadow, which only the measured terrain does.
    float size = 45.0;
    float steep = 0.008;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    // Each scale is turned against the last so no grid shows; "frame" takes p to that scale's
    // axes, and (v * frame) brings a gradient back.
    mat2 frame = mat2(1.0, 0.0, 0.0, 1.0);
    for (int k = 0; k < 6; k++) {
      float w = visible(size, footprint);
      if (w > 0.0) {
        vec3 n = noised((frame * p) / size + float(k) * 19.7);
        slope += w * steep * (n.yz * frame);
        tone += w * 0.035 * (n.x - 0.5);
      }
      frame = turn * frame;
      size *= 0.38;
      steep = min(steep * 1.6, 0.06);
    }
    mat2 turn2 = turn * turn;
    slope += craters(p, 95.0, 3.0) * visible(20.0, footprint);
    slope += (craters(turn * p, 24.0, 11.0) * turn) * visible(6.0, footprint);
    slope += (craters(turn2 * p, 6.5, 23.0) * turn2) * visible(1.6, footprint);
    slope += craters(p + 40.0, 1.7, 37.0) * visible(0.45, footprint);
    return vec3(slope, tone);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float footprint = max(length(dFdx(vPosition.xz)), length(dFdy(vPosition.xz)));
    vec3 detail = surfaceDetail(vPosition.xz, footprint);
    n = normalize(n - vec3(detail.x, 0.0, detail.y));
    float mu0 = max(dot(n, sunDirection), 0.0);
    float mu = max(dot(n, normalize(cameraPosition - vPosition)), 0.0);
    float lommel = mu0 / (mu0 + mu + 1e-3);
    float lit = hasShadow > 0.5 ? texture2D(shadowMap, vShadowUv).r : 1.0;
    float near = observerBlend * (1.0 - smoothstep(${OBSERVER_ZONE_M[0]}.0, ${OBSERVER_ZONE_M[1]}.0, length(vPosition.xz)));
    lit = mix(lit, observerLit, near);
    float direct = sunUp * lit * (0.38 * (1.0 - exp(-mu0 * exposure)) + 0.3 * lommel);
    vec3 albedo = vec3(0.62, 0.61, 0.6) * detail.z;
    // The fill light (scattered light, earthshine; illustrative) is a little stronger on
    // surfaces that face up, so slopes in shadow keep their shape.
    vec3 color = albedo * (fill * (0.45 + 0.55 * max(n.y, 0.0)) + direct);
    if (heatOn > 0.5) {
      // Scores of the nearby grid points as a tint on the ground: g counts grid cells from
      // the south-west point, the texture holds one texel per point. The tint keeps some
      // brightness of its own, so it can be read in shadow and at night.
      vec2 q = vPosition.xz - heatOrigin;
      vec2 g = vec2(dot(heatRowX, q), dot(heatRowY, q));
      float inside = min(min(g.x, g.y), min(heatSize - 1.0 - g.x, heatSize - 1.0 - g.y)) + 0.5;
      float cover = smoothstep(0.0, 0.12, inside);
      if (cover > 0.0) {
        vec3 heat = texture2D(heatMap, (g + 0.5) / heatSize).rgb;
        float glow = 0.2 + 0.75 * min(direct * 1.5, 1.0);
        color = mix(color, heat * glow, 0.6 * cover);
        // A dot at every grid point: there the colour is the score of that point itself.
        float radius = max(2.5, 1.2 * footprint);
        float node = 1.0 - smoothstep(radius, radius * 1.35, length((g - floor(g + 0.5)) * heatStep));
        color = mix(color, heat * (0.45 + 0.55 * glow) + 0.08, node * cover);
      }
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

function terrainMaterial(level: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      sunUp: { value: 1 },
      exposure: { value: 8 },
      fill: { value: 0.025 },
      shadowMap: { value: null },
      hasShadow: { value: 0 },
      observerLit: { value: 1 },
      // Only the innermost level holds the ground under the observer.
      observerBlend: { value: level === 0 ? 1 : 0 },
      heatMap: { value: null },
      heatOn: { value: 0 },
      heatOrigin: { value: new THREE.Vector2() },
      heatRowX: { value: new THREE.Vector2() },
      heatRowY: { value: new THREE.Vector2() },
      heatSize: { value: 1 },
      heatStep: { value: 1 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });
}

export interface Projection {
  /** Position in the canvas, 0..1 from the left / top; may lie outside for a point out of view. */
  x: number;
  y: number;
  /** In front of the camera and inside the canvas. */
  inView: boolean;
}

/** An upright marker for a nearby grid point. */
export interface BeaconSpec {
  lat: number;
  lon: number;
  groundHeightM: number;
  color: string;
  /** The best spot: taller. */
  best: boolean;
}

/** Scores of a square grid of nearby points, drawn as a tint on the ground. */
export interface HeatSpec {
  /** Points per side. */
  size: number;
  /** Distance between neighbouring points, meters. */
  stepM: number;
  /** RGBA bytes (sRGB), one texel per point, row by row from the south-west point. */
  colors: Uint8Array;
  /** Three corner points of the grid: they place it on the terrain. */
  southWest: { lat: number; lon: number };
  southEast: { lat: number; lon: number };
  northWest: { lat: number; lon: number };
}

/** Height of a beacon pole above the ground, meters (taller for the best spot). */
export const BEACON_HEIGHT_M = { normal: 8, best: 14 } as const;

export interface LanderShadow {
  /** True length on flat ground, meters; Infinity with the Sun on or below the horizontal. */
  lengthM: number;
  /** Where the drawn tip lands on screen. */
  tip: Projection;
}

export class SurfaceScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e4);
  private readonly sky = new SkyLayer();
  private levels: LevelMesh[] = [];
  private readonly levelScenes: THREE.Scene[] = [];
  private shadows: ShadowPass | null = null;
  private readonly shadowSun = new THREE.Vector3(Infinity, 0, 0);
  private shadowRadius = 0;
  private lastShadowMs = -Infinity;
  private shadowTimer = 0;
  private readonly landerScene = new THREE.Scene();
  private siteFrame: SiteFrame | null = null;
  private site = { latDeg: 0, lonDeg: 0, groundHeightM: 0 };
  private heat: HeatSpec | null = null;
  private heatTexture: THREE.DataTexture | null = null;
  /** Drone view: a pole at the observer's position, sized with the camera's distance. */
  private readonly marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly beacons = new THREE.Group();
  private beaconTops: THREE.Vector3[] = [];
  private patch: TerrainPatch | null = null;
  private horizon: Horizon | null = null;
  /** Planner labels: the stretch of skyline that blocks a body, drawn over the terrain. */
  private readonly blockerScene = new THREE.Scene();
  private readonly landerShadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private frame = 0;
  private state: ViewState | null = null;
  private width = 1;
  private height = 1;
  /** Lowest point of the skyline: below it the Sun lights no terrain at all. */
  private lowestSkylineDeg = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // The mast's shadow: thin at the observer's feet, as wide as the panel at the far end
    // (unit length along -z, scaled to the shadow's length).
    const geometry = new THREE.BufferGeometry();
    const w = LANDER_SHADOW_WIDTH_M / 2;
    const mast = 0.15;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-mast, 0, 0, mast, 0, 0, -w, 0, -1, w, 0, -1]), 3));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    this.landerShadow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.landerShadow.frustumCulled = false;
    this.landerScene.add(this.landerShadow);

    // Unit pole standing on the origin; scaled every frame.
    this.marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.marker.frustumCulled = false;
    this.marker.visible = false;
  }

  /** The engine's skyline for the curtain; null = flat. */
  setHorizon(horizon: Horizon | null) {
    this.sky.setHorizon(horizon);
    this.horizon = horizon;
    let lowest = 0;
    if (horizon) {
      lowest = Infinity;
      for (let i = 0; i < horizon.horizonDeg.length; i++) lowest = Math.min(lowest, horizon.horizonDeg[i]);
    }
    this.lowestSkylineDeg = lowest;
    this.requestRender();
  }

  /** Height patches around (lat, lon), the observer's ground point; null = curtain only. */
  setTerrain(patch: TerrainPatch | null, latDeg: number, lonDeg: number, groundHeightM: number) {
    this.clearTerrain();
    this.siteFrame = siteFrame(latDeg, lonDeg, groundHeightM);
    this.site = { latDeg, lonDeg, groundHeightM };
    this.patch = patch;
    if (patch) {
      const frame = this.siteFrame;
      this.levels = buildLevels(patch, frame, terrainMaterial);
      for (const level of this.levels) {
        const scene = new THREE.Scene();
        scene.add(level.mesh);
        this.levelScenes.push(scene);
      }
      // Beacons stand on the innermost level and are hidden by terrain in front of them.
      this.levelScenes[0]?.add(this.beacons, this.marker);
      try {
        this.shadows = new ShadowPass(patch, this.levels, latDeg, lonDeg, groundHeightM);
        this.levels.forEach((level, k) => {
          const uniforms = (level.mesh.material as THREE.ShaderMaterial).uniforms;
          uniforms.shadowMap.value = this.shadows!.targets[k].texture;
        });
      } catch {
        // Without float textures there are no terrain shadows; the ground near the observer
        // still follows the engine.
        this.shadows = null;
      }
      this.shadowSun.set(Infinity, 0, 0);
    }
    this.applyHeat();
    this.requestRender();
  }

  /** Tints the ground around the place with the scores of the nearby grid; null = off. */
  setHeat(spec: HeatSpec | null) {
    this.heat = spec;
    this.heatTexture?.dispose();
    this.heatTexture = null;
    if (spec) {
      const texture = new THREE.DataTexture(spec.colors, spec.size, spec.size, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      this.heatTexture = texture;
    }
    this.applyHeat();
    this.requestRender();
  }

  /** Hands the grid's place in the current site frame to the innermost level (the grid is +-500 m). */
  private applyHeat() {
    const uniforms = (this.levels[0]?.mesh.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!uniforms) return;
    const spec = this.heat;
    const at = (p: { lat: number; lon: number }) => this.groundToScene(p.lat, p.lon, this.site.groundHeightM);
    const origin = spec ? at(spec.southWest) : null;
    const east = spec ? at(spec.southEast) : null;
    const north = spec ? at(spec.northWest) : null;
    if (!spec || !this.heatTexture || !origin || !east || !north || spec.size < 2) {
      uniforms.heatOn.value = 0;
      return;
    }
    // One grid cell along each side, in scene x / z; the inverse turns a ground position
    // into grid coordinates.
    const cells = spec.size - 1;
    const [ex, ez] = [(east.x - origin.x) / cells, (east.z - origin.z) / cells];
    const [nx, nz] = [(north.x - origin.x) / cells, (north.z - origin.z) / cells];
    const det = ex * nz - nx * ez;
    if (Math.abs(det) < 1e-9) {
      uniforms.heatOn.value = 0;
      return;
    }
    uniforms.heatMap.value = this.heatTexture;
    uniforms.heatOrigin.value.set(origin.x, origin.z);
    uniforms.heatRowX.value.set(nz / det, -nx / det);
    uniforms.heatRowY.value.set(-ez / det, ex / det);
    uniforms.heatSize.value = spec.size;
    uniforms.heatStep.value = spec.stepM;
    uniforms.heatOn.value = 1;
  }

  /** Height of the terrain surface under a scene position (scene y); null outside the patch. */
  private groundYAt(x: number, z: number): number | null {
    const distance = Math.hypot(x, z);
    const spot = distance < 1e-3 ? { lat: this.site.latDeg, lon: this.site.lonDeg } : destination(this.site.latDeg, this.site.lonDeg, Math.atan2(x, -z) / DEG, distance);
    return this.terrainPointAt(spot.lat, spot.lon)?.y ?? null;
  }

  /** Scene position of a point on the ground (or above it); null before a frame is known. */
  groundToScene(latDeg: number, lonDeg: number, heightM: number): THREE.Vector3 | null {
    if (!this.siteFrame) return null;
    const { x, y } = latLonToProjected(latDeg, lonDeg);
    const out = new Float32Array(3);
    this.siteFrame.toScene(x, y, heightM, out, 0);
    return new THREE.Vector3(out[0], out[1], out[2]);
  }

  /** Scene position of the terrain surface at (lat, lon) from the finest patch level that holds it. */
  terrainPointAt(latDeg: number, lonDeg: number): THREE.Vector3 | null {
    if (!this.patch) return null;
    const { x, y } = latLonToProjected(latDeg, lonDeg);
    for (const level of this.patch.levels) {
      const u = (x - level.x0) / level.pixelM - 0.5;
      const v = (level.y0 - y) / level.pixelM - 0.5;
      if (u < 0 || v < 0 || u >= level.size - 1 || v >= level.size - 1) continue;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fu = u - i;
      const fv = v - j;
      const h = level.heights;
      const n = level.size;
      const top = h[j * n + i] * (1 - fu) + h[j * n + i + 1] * fu;
      const bottom = h[(j + 1) * n + i] * (1 - fu) + h[(j + 1) * n + i + 1] * fu;
      return this.groundToScene(latDeg, lonDeg, top * (1 - fv) + bottom * fv);
    }
    return null;
  }

  /** Where a scene point lands in the canvas for the current camera. */
  projectPoint(point: THREE.Vector3): Projection {
    return this.projectVector(point.clone().sub(this.cameraPosition()));
  }

  /** Planner labels: guide lines, the bodies' tracks, and the stretches of skyline that block them. */
  setGuides(visible: boolean) {
    this.sky.setGuides(visible);
    this.blockerScene.visible = visible;
    this.requestRender();
  }

  setTracks(sun: [number, number][], earth: [number, number][]) {
    this.sky.setTracks(sun, earth);
    this.requestRender();
  }

  /** Highlights the skyline +-spanDeg around each azimuth (a body the terrain hides). */
  setBlockers(blockers: { azimuthDeg: number; color: number }[], spanDeg = 7) {
    for (const child of [...this.blockerScene.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.blockerScene.remove(line);
    }
    if (!this.horizon) return;
    for (const { azimuthDeg, color } of blockers) {
      const positions: number[] = [];
      for (let off = -spanDeg; off <= spanDeg; off += 0.25) {
        const az = azimuthDeg + off;
        positions.push(...directionToScene(az, horizonAt(this.horizon, az)).map((v) => v * SKY_DISTANCE * 0.9));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 }));
      line.frustumCulled = false;
      this.blockerScene.add(line);
    }
  }

  /** Upright markers at nearby grid points; replaces the previous set. */
  setBeacons(specs: BeaconSpec[]) {
    for (const child of [...this.beacons.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.beacons.remove(mesh);
    }
    this.beaconTops = [];
    for (const spec of specs) {
      const base = this.groundToScene(spec.lat, spec.lon, spec.groundHeightM);
      if (!base) continue;
      const height = spec.best ? BEACON_HEIGHT_M.best : BEACON_HEIGHT_M.normal;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, height, 8), new THREE.MeshBasicMaterial({ color: spec.color }));
      pole.position.set(base.x, base.y + height / 2, base.z);
      this.beacons.add(pole);
      this.beaconTops.push(new THREE.Vector3(base.x, base.y + height, base.z));
    }
    this.requestRender();
  }

  /** Beacons step aside while the camera flies to one of them. */
  setBeaconsVisible(visible: boolean) {
    this.beacons.visible = visible;
    this.requestRender();
  }

  /** Screen positions of the beacon tops, in the order of the last setBeacons call. */
  beaconProjections(): Projection[] {
    const eye = this.cameraPosition();
    return this.beaconTops.map((top) => this.projectVector(top.clone().sub(eye)));
  }

  get hasTerrain(): boolean {
    return this.levels.length > 0;
  }

  setState(state: ViewState) {
    this.state = state;
    this.requestRender();
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.requestRender();
  }

  /** Horizontal field of view, degrees. */
  get horizontalFovDeg(): number {
    const v = (this.state?.fovDeg ?? 60) * DEG;
    return (2 * Math.atan(Math.tan(v / 2) * (this.width / this.height))) / DEG;
  }

  /** Where the observer's position lands in the canvas (the drone view's "you are here"). */
  observerProjection(): Projection {
    return this.projectPoint(this.observerPosition());
  }

  /** Distance of the camera from the observer's position, meters (0 in first person). */
  get cameraDistanceM(): number {
    return this.cameraPosition().distanceTo(this.observerPosition());
  }

  /** Where a direction lands in the canvas for the current camera. */
  project(azimuthDeg: number, elevationDeg: number): Projection {
    const [x, y, z] = directionToScene(azimuthDeg, elevationDeg);
    return this.projectVector(new THREE.Vector3(x, y, z));
  }

  /** The lander's shadow, or null while the observer is not in sunlight or has no terrain. */
  landerShadowInfo(): LanderShadow | null {
    const s = this.state;
    if (!s || !this.landerShadow.visible) return null;
    const elevation = s.sun.elevationDeg;
    const lengthM = elevation > 0 ? s.eyeHeightM / Math.tan(elevation * DEG) : Infinity;
    const drawn = Math.min(lengthM, LANDER_SHADOW_CAP_M);
    const away = directionToScene(s.sun.azimuthDeg + 180, 0);
    const tip = new THREE.Vector3(away[0] * drawn, 0, away[2] * drawn).sub(this.cameraPosition());
    return { lengthM, tip: this.projectVector(tip) };
  }

  private projectVector(v: THREE.Vector3): Projection {
    this.placeCamera();
    const local = v.clone().applyQuaternion(this.camera.quaternion.clone().invert());
    const tanV = Math.tan(((this.state?.fovDeg ?? 60) * DEG) / 2);
    const tanH = tanV * (this.width / this.height);
    if (local.z >= -1e-6) {
      // Behind the camera: push it far out in its sideways direction.
      const side = Math.sign(local.x) || 1;
      return { x: side > 0 ? 10 : -10, y: 0.5 - local.y, inView: false };
    }
    const px = 0.5 + local.x / -local.z / tanH / 2;
    const py = 0.5 - local.y / -local.z / tanV / 2;
    return { x: px, y: py, inView: px >= 0 && px <= 1 && py >= 0 && py <= 1 };
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Where the observer stands (or flies, during a hop). */
  private observerPosition(): THREE.Vector3 {
    const s = this.state;
    if (!s) return new THREE.Vector3();
    return s.eye ? new THREE.Vector3(...s.eye) : new THREE.Vector3(0, s.eyeHeightM, 0);
  }

  /** The drone camera is on only with a terrain mesh to look at. */
  private get drone(): boolean {
    return Boolean(this.state?.droneDistanceM) && this.levels.length > 0;
  }

  private cameraPosition(): THREE.Vector3 {
    const s = this.state;
    const eye = this.observerPosition();
    if (!s || !this.drone) return eye;
    const [dx, dy, dz] = directionToScene(s.headingDeg, s.pitchDeg);
    const d = s.droneDistanceM!;
    eye.set(eye.x - dx * d, eye.y - dy * d, eye.z - dz * d);
    // Never under the ground: a ridge behind the place lifts the camera over it.
    const ground = this.groundYAt(eye.x, eye.z);
    if (ground !== null) eye.y = Math.max(eye.y, ground + DRONE_CLEARANCE_M);
    return eye;
  }

  private placeCamera() {
    const s = this.state;
    if (!s) return;
    this.camera.fov = s.fovDeg;
    this.camera.aspect = this.width / this.height;
    const eye = this.cameraPosition();
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    if (this.drone) this.camera.lookAt(this.observerPosition());
    else {
      const [dx, dy, dz] = directionToScene(s.headingDeg, s.pitchDeg);
      this.camera.lookAt(eye.x + dx, eye.y + dy, eye.z + dz);
    }
    this.camera.updateMatrixWorld();
  }

  /** Recomputes the shadows if the Sun moved, but not more often than SHADOW_INTERVAL_MS. */
  private refreshShadows(sunDir: THREE.Vector3, radiusDeg: number, sunUp: number) {
    if (!this.shadows || sunUp <= 0) return;
    const moved = this.shadowSun.angleTo(sunDir) > 1e-5 || Math.abs(this.shadowRadius - radiusDeg) > 1e-5 || !Number.isFinite(this.shadowSun.x);
    if (!moved) return;
    const now = performance.now();
    if (now - this.lastShadowMs < SHADOW_INTERVAL_MS) {
      if (!this.shadowTimer) {
        this.shadowTimer = window.setTimeout(() => {
          this.shadowTimer = 0;
          this.requestRender();
        }, SHADOW_INTERVAL_MS - (now - this.lastShadowMs));
      }
      return;
    }
    this.shadows.update(this.renderer, sunDir, radiusDeg);
    this.shadowSun.copy(sunDir);
    this.shadowRadius = radiusDeg;
    this.lastShadowMs = now;
  }

  private render() {
    const s = this.state;
    if (!s) return;
    this.placeCamera();
    const sunDir = new THREE.Vector3(...directionToScene(s.sun.azimuthDeg, s.sun.elevationDeg));
    // The Sun against the lowest point of the skyline: below it no terrain can be sunlit
    // (high ground sees the Sun below 0 deg). Which terrain it lights is the shadow pass's job.
    const sunUp = THREE.MathUtils.clamp((s.sun.elevationDeg + s.sun.radiusDeg - this.lowestSkylineDeg) / (2 * s.sun.radiusDeg), 0, 1);
    const exposure = 1 / Math.max(Math.sin(Math.max(s.sun.elevationDeg, 0) * DEG), 0.03);
    this.refreshShadows(sunDir, s.sun.radiusDeg, sunUp);
    const shadowsReady = this.shadows !== null && Number.isFinite(this.shadowSun.x);
    for (const level of this.levels) {
      const uniforms = (level.mesh.material as THREE.ShaderMaterial).uniforms;
      uniforms.sunDirection.value.copy(sunDir);
      uniforms.sunUp.value = sunUp;
      uniforms.exposure.value = exposure;
      uniforms.hasShadow.value = shadowsReady ? 1 : 0;
      uniforms.observerLit.value = s.observerLit;
      // Night look: in shadow the eye adapts; the fill light (illustrative) comes up a little.
      uniforms.fill.value = s.observerLit > 0.05 ? 0.03 : 0.06;
    }
    // Stars come out when the observer stands in shadow (the glare and the lit ground hide them).
    this.sky.update(this.camera.position, s.sun, s.earth, s.observerLit > 0.05 ? 0.12 : 0.9, s.observerLit, s.latDeg, s.timeMs);

    // The lander's shadow lies on the ground away from the Sun while the observer is sunlit.
    const drone = this.drone;
    // The skyline curtain and the blocking stretches belong to the place itself, not to a
    // camera above it.
    this.sky.setCurtainVisible(!drone);
    this.marker.visible = drone && !s.eye;
    if (this.marker.visible) {
      const d = this.camera.position.distanceTo(this.observerPosition());
      this.marker.scale.set(d * 0.003, d * 0.06, d * 0.003);
    }
    // Distance of the camera from the center of the nested levels.
    const offset = this.camera.position.length();
    const showLander = this.levels.length > 0 && s.observerLit > 0.05 && s.sun.elevationDeg > 0 && !s.eye;
    this.landerShadow.visible = showLander;
    if (showLander) {
      const length = Math.min(s.eyeHeightM / Math.tan(s.sun.elevationDeg * DEG), LANDER_SHADOW_CAP_M);
      this.landerShadow.position.set(0, 0.02, 0);
      this.landerShadow.rotation.set(0, -(s.sun.azimuthDeg + 180) * DEG, 0);
      this.landerShadow.scale.set(1, 1, length);
      this.landerShadow.material.opacity = 0.55 * s.observerLit;
    }

    const r = this.renderer;
    r.clear(true, true, true);
    this.setPlanes(SKY_DISTANCE * 0.01, SKY_DISTANCE * 3);
    r.render(this.sky.scene, this.camera);
    for (let k = this.levels.length - 1; k >= 0; k--) {
      const level = this.levels[k];
      r.clearDepth();
      // A triangle can come closer than its nearest vertex by up to a cell; the innermost
      // level holds the ground under the observer's feet.
      const near = k === 0 ? (drone ? 2 : 0.05) : Math.max(0.05, (level.near - 2 * level.level.pixelM - offset) * 0.5);
      this.setPlanes(near, level.far * 1.05 + offset + 100);
      r.render(this.levelScenes[k], this.camera);
    }
    if (showLander) {
      this.setPlanes(0.05, 1e3);
      r.render(this.landerScene, this.camera);
    }
    if (!drone && this.blockerScene.visible && this.blockerScene.children.length > 0) {
      this.blockerScene.position.copy(this.camera.position);
      this.setPlanes(SKY_DISTANCE * 0.01, SKY_DISTANCE * 3);
      r.render(this.blockerScene, this.camera);
    }
  }

  private setPlanes(near: number, far: number) {
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private clearTerrain() {
    for (const level of this.levels) {
      level.mesh.geometry.dispose();
      (level.mesh.material as THREE.Material).dispose();
    }
    this.levels = [];
    this.levelScenes.length = 0;
    this.shadows?.dispose();
    this.shadows = null;
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.shadowTimer) clearTimeout(this.shadowTimer);
    this.clearTerrain();
    this.sky.dispose();
    this.landerShadow.geometry.dispose();
    this.landerShadow.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.heatTexture?.dispose();
    this.renderer.dispose();
  }
}

/** True if this browser can draw the surface view. */
export function webgl2Available(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
