// Renderer, camera and draw order of the surface view.
//
// Draw order instead of one deep depth buffer: the sky (stars, glare, Sun, Earth, skyline
// curtain), then the terrain levels from the outermost to the innermost with the depth
// buffer cleared before each and the near / far planes set for that level. The levels are
// nested squares around the observer, so an outer level always lies behind an inner one
// along any line of sight. Frames are drawn on demand only.
import * as THREE from "three";
import type { TerrainPatch } from "../data/load.ts";
import type { Horizon } from "../engine/risk.ts";
import { directionToScene, siteFrame } from "./geometry.ts";
import { SKY_DISTANCE, SkyLayer, type BodyState } from "./sky.ts";
import { buildLevels, type LevelMesh } from "./terrain.ts";

const DEG = Math.PI / 180;

export interface ViewState {
  sun: BodyState;
  earth: BodyState;
  /** Observer height above the ground, meters. */
  eyeHeightM: number;
  headingDeg: number;
  pitchDeg: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
}

const TERRAIN_VERTEX = /* glsl */ `
  varying vec3 vPosition;
  varying vec3 vNormal;
  void main() {
    vPosition = position;
    vNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Lambert mixed with Lommel-Seeliger (mu0 / (mu0 + mu)), one grey albedo, a small fill
// light, and an exposure that follows the Sun's elevation. Tuned by eye; illustrative.
const TERRAIN_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform float sunUp;
  uniform float exposure;
  uniform float fill;
  varying vec3 vPosition;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float mu0 = max(dot(n, sunDirection), 0.0);
    float mu = max(dot(n, normalize(cameraPosition - vPosition)), 0.0);
    float lommel = mu0 / (mu0 + mu + 1e-3);
    float direct = sunUp * (0.38 * (1.0 - exp(-mu0 * exposure)) + 0.3 * lommel);
    vec3 albedo = vec3(0.62, 0.61, 0.6);
    gl_FragColor = vec4(albedo * (fill + direct), 1.0);
    #include <colorspace_fragment>
  }
`;

function terrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      sunUp: { value: 1 },
      exposure: { value: 8 },
      fill: { value: 0.025 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });
}

export interface Projection {
  /** Position in the canvas, 0..1 from the left / top; may lie outside for a body out of view. */
  x: number;
  y: number;
  /** In front of the camera and inside the canvas. */
  inView: boolean;
}

export class SurfaceScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e4);
  private readonly sky = new SkyLayer();
  private levels: LevelMesh[] = [];
  private readonly levelScenes: THREE.Scene[] = [];
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
    if (patch) {
      const frame = siteFrame(latDeg, lonDeg, groundHeightM);
      this.levels = buildLevels(patch, frame, () => terrainMaterial());
      for (const level of this.levels) {
        const scene = new THREE.Scene();
        scene.add(level.mesh);
        this.levelScenes.push(scene);
      }
    }
    this.requestRender();
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
    this.placeCamera();
    const [x, y, z] = directionToScene(azimuthDeg, elevationDeg);
    const v = new THREE.Vector3(x, y, z).applyQuaternion(this.camera.quaternion.clone().invert());
    const tanV = Math.tan(((this.state?.fovDeg ?? 60) * DEG) / 2);
    const tanH = tanV * (this.width / this.height);
    if (v.z >= -1e-6) {
      // Behind the camera: push it far out in its sideways direction.
      const side = Math.sign(v.x) || 1;
      return { x: side > 0 ? 10 : -10, y: 0.5 - v.y, inView: false };
    }
    const px = 0.5 + v.x / -v.z / tanH / 2;
    const py = 0.5 - v.y / -v.z / tanV / 2;
    return { x: px, y: py, inView: px >= 0 && px <= 1 && py >= 0 && py <= 1 };
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private placeCamera() {
    const s = this.state;
    if (!s) return;
    this.camera.fov = s.fovDeg;
    this.camera.aspect = this.width / this.height;
    this.camera.position.set(0, s.eyeHeightM, 0);
    const [dx, dy, dz] = directionToScene(s.headingDeg, s.pitchDeg);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(dx, s.eyeHeightM + dy, dz);
    this.camera.updateMatrixWorld();
  }

  private render() {
    const s = this.state;
    if (!s) return;
    this.placeCamera();
    const sunDir = directionToScene(s.sun.azimuthDeg, s.sun.elevationDeg);
    // The Sun against the lowest point of the skyline: below it no terrain can be sunlit
    // (high ground sees the Sun below 0 deg). Which terrain it lights is the shadow pass's job.
    const sunUp = THREE.MathUtils.clamp((s.sun.elevationDeg + s.sun.radiusDeg - this.lowestSkylineDeg) / (2 * s.sun.radiusDeg), 0, 1);
    const exposure = 1 / Math.max(Math.sin(Math.max(s.sun.elevationDeg, 0) * DEG), 0.03);
    for (const level of this.levels) {
      const uniforms = (level.mesh.material as THREE.ShaderMaterial).uniforms;
      uniforms.sunDirection.value.set(...sunDir);
      uniforms.sunUp.value = sunUp;
      uniforms.exposure.value = exposure;
    }
    this.sky.update(this.camera.position, s.sun, s.earth, sunUp > 0 ? 0.15 : 0.9, sunUp);

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
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.clearTerrain();
    this.sky.dispose();
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
