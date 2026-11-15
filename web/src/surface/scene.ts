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
import { directionToScene, latLonToProjected, siteFrame, type SiteFrame } from "./geometry.ts";
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

export interface ViewState {
  sun: BodyState;
  earth: BodyState;
  /** Visible share of the Sun's disk at the observer, from the engine (0-1). */
  observerLit: number;
  /** Observer height above the ground, meters. */
  eyeHeightM: number;
  /** Camera position while flying to another point; default: eyeHeightM above the origin. */
  eye?: [number, number, number];
  headingDeg: number;
  pitchDeg: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
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
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vShadowUv;
  void main() {
    vec3 n = normalize(vNormal);
    float mu0 = max(dot(n, sunDirection), 0.0);
    float mu = max(dot(n, normalize(cameraPosition - vPosition)), 0.0);
    float lommel = mu0 / (mu0 + mu + 1e-3);
    float lit = hasShadow > 0.5 ? texture2D(shadowMap, vShadowUv).r : 1.0;
    float near = observerBlend * (1.0 - smoothstep(${OBSERVER_ZONE_M[0]}.0, ${OBSERVER_ZONE_M[1]}.0, length(vPosition.xz)));
    lit = mix(lit, observerLit, near);
    float direct = sunUp * lit * (0.38 * (1.0 - exp(-mu0 * exposure)) + 0.3 * lommel);
    vec3 albedo = vec3(0.62, 0.61, 0.6);
    // The fill light (scattered light, earthshine; illustrative) is a little stronger on
    // surfaces that face up, so slopes in shadow keep their shape.
    gl_FragColor = vec4(albedo * (fill * (0.45 + 0.55 * max(n.y, 0.0)) + direct), 1.0);
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
  private readonly beacons = new THREE.Group();
  private beaconTops: THREE.Vector3[] = [];
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
  }

  /** The engine's skyline for the curtain; null = flat. */
  setHorizon(horizon: Horizon | null) {
    this.sky.setHorizon(horizon);
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
    if (patch) {
      const frame = this.siteFrame;
      this.levels = buildLevels(patch, frame, terrainMaterial);
      for (const level of this.levels) {
        const scene = new THREE.Scene();
        scene.add(level.mesh);
        this.levelScenes.push(scene);
      }
      // Beacons stand on the innermost level and are hidden by terrain in front of them.
      this.levelScenes[0]?.add(this.beacons);
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
    this.requestRender();
  }

  /** Scene position of a point on the ground (or above it); null before a frame is known. */
  groundToScene(latDeg: number, lonDeg: number, heightM: number): THREE.Vector3 | null {
    if (!this.siteFrame) return null;
    const { x, y } = latLonToProjected(latDeg, lonDeg);
    const out = new Float32Array(3);
    this.siteFrame.toScene(x, y, heightM, out, 0);
    return new THREE.Vector3(out[0], out[1], out[2]);
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

  private cameraPosition(): THREE.Vector3 {
    const s = this.state;
    if (!s) return new THREE.Vector3();
    return s.eye ? new THREE.Vector3(...s.eye) : new THREE.Vector3(0, s.eyeHeightM, 0);
  }

  private placeCamera() {
    const s = this.state;
    if (!s) return;
    this.camera.fov = s.fovDeg;
    this.camera.aspect = this.width / this.height;
    const eye = this.cameraPosition();
    this.camera.position.copy(eye);
    const [dx, dy, dz] = directionToScene(s.headingDeg, s.pitchDeg);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(eye.x + dx, eye.y + dy, eye.z + dz);
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
    this.sky.update(this.camera.position, s.sun, s.earth, s.observerLit > 0.05 ? 0.12 : 0.9, s.observerLit);

    // The lander's shadow lies on the ground away from the Sun while the observer is sunlit.
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
      const near = k === 0 ? 0.05 : Math.max(0.05, (level.near - 2 * level.level.pixelM - s.eyeHeightM) * 0.5);
      this.setPlanes(near, level.far * 1.05 + s.eyeHeightM + 100);
      r.render(this.levelScenes[k], this.camera);
    }
    if (showLander) {
      this.setPlanes(0.05, 1e3);
      r.render(this.landerScene, this.camera);
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
