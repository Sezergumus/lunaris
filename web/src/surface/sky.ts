// What lies beyond the terrain: the Sun, the Earth, the Sun's glare, stars, and the skyline
// curtain.
//
// The curtain is the engine's horizon (PlaceData.horizon, the profile the risk model uses)
// drawn as a dark band after the Sun and the Earth. Whatever the engine counts as below the
// skyline is therefore hidden on screen too, even where a coarse mesh level sits a little
// lower than the engine's skyline; and where no height patch exists (custom points, a failed
// download) the curtain is the whole terrain.
import * as THREE from "three";
import { horizonAt, type Horizon } from "../engine/risk.ts";
import { directionToScene } from "./geometry.ts";

/** Distance at which the sky is drawn, meters (inside the sky camera's far plane). */
export const SKY_DISTANCE = 1e6;
const CURTAIN_COLUMNS = 1440;
const CURTAIN_BOTTOM_DEG = -89;

export interface BodyState {
  azimuthDeg: number;
  elevationDeg: number;
  radiusDeg: number;
}

function glareTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 244, 220, 0.9)");
  gradient.addColorStop(0.08, "rgba(255, 236, 200, 0.45)");
  gradient.addColorStop(0.3, "rgba(255, 220, 170, 0.08)");
  gradient.addColorStop(1, "rgba(255, 220, 170, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const EARTH_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Measured: the disk's place and size and its phase (the day side faces the Sun). Illustrative:
// oceans, continents, ice and clouds are noise, not the real map; the globe turns once per
// lunar day of the Earth's sky (24 h 50 min) about an axis parallel to the Moon's, so from
// the south pole the Earth's north is down.
const EARTH_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  uniform vec3 toViewer;
  uniform mat3 earthFrame;
  varying vec3 vNormal;

  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  // Scales finer than a screen pixel (pixel = change of p per pixel) are left out.
  float fbm(vec3 p, float pixel) {
    float sum = 0.0;
    float total = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int k = 0; k < 6; k++) {
      float w = amplitude * (1.0 - smoothstep(0.3, 0.8, pixel * frequency));
      // A scale left out counts as its mean, so the result keeps its level.
      sum += w * (noise(p * frequency) - 0.5);
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return 0.5 + sum / total;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 p = earthFrame * n;
    float pixel = length(fwidth(p));

    float relief = fbm(p * 1.9 + 4.2, pixel * 1.9);
    float land = smoothstep(0.535, 0.56, relief);
    float latitude = abs(p.y);
    float ice = smoothstep(0.86, 0.9, latitude + 0.12 * (fbm(p * 5.0, pixel * 5.0) - 0.5));
    float dry = smoothstep(0.42, 0.62, fbm(p * 3.1 + 9.0, pixel * 3.1)) * (1.0 - smoothstep(0.35, 0.7, latitude));

    vec3 ocean = mix(vec3(0.012, 0.055, 0.21), vec3(0.03, 0.17, 0.34), smoothstep(0.47, 0.535, relief));
    vec3 ground = mix(vec3(0.05, 0.17, 0.045), vec3(0.34, 0.26, 0.13), dry);
    ground = mix(ground, vec3(0.2, 0.19, 0.16), smoothstep(0.62, 0.72, relief));
    vec3 surface = mix(mix(ocean, ground, land), vec3(0.8, 0.86, 0.92), ice);

    // Clouds: stretched along the latitude circles, with a second field breaking them up.
    vec3 c = vec3(p.x, p.y * 2.4, p.z) * 2.3;
    float cover = fbm(c + 2.5 * fbm(c * 0.7 + 3.0, pixel * 4.0), pixel * 5.5);
    float clouds = 0.9 * smoothstep(0.5, 0.68, cover);
    surface = mix(surface, vec3(0.93), clouds);

    float light = dot(n, sunDirection);
    float day = smoothstep(-0.06, 0.14, light) * (0.3 + 0.7 * clamp(light, 0.0, 1.0));
    float facing = clamp(dot(n, toViewer), 0.0, 1.0);
    // Sunlight mirrored by the sea.
    float glint = pow(max(dot(reflect(-sunDirection, n), toViewer), 0.0), 60.0) * (1.0 - land) * (1.0 - ice) * (1.0 - clouds);
    // The air: a blue veil that thickens toward the limb.
    float air = pow(1.0 - facing, 2.5);
    vec3 color = mix(surface, vec3(0.25, 0.45, 0.9), 0.1 + 0.55 * air) * day * 1.7 + vec3(1.0, 0.95, 0.85) * glint * 0.5 * day;
    color += vec3(0.004, 0.006, 0.012) + vec3(0.02, 0.05, 0.12) * air * smoothstep(-0.25, 0.1, light);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The Earth's rotation against the Moon's direction: one turn per 24 h 50 min, milliseconds. */
const EARTH_TURN_MS = 89428e3;

const STAR_COUNT = 1400;

/** Random, fixed star field: illustrative, not real star positions. */
function starField(): THREE.Points {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    const z = random() * 2 - 1;
    const t = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(t) * SKY_DISTANCE * 1.5, z * SKY_DISTANCE * 1.5, r * Math.sin(t) * SKY_DISTANCE * 1.5], i * 3);
    sizes[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float size;
      varying float vBright;
      void main() {
        vBright = 0.35 + 0.65 * size * size;
        gl_PointSize = 1.0 + 1.6 * size * size;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float opacity;
      varying float vBright;
      void main() { gl_FragColor = vec4(vec3(vBright), opacity * vBright); }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

// Every sky material is "transparent": three.js draws opaque objects before transparent ones
// whatever their renderOrder, and here renderOrder alone must decide (stars, glare, bodies,
// then the curtain over all of them).
export class SkyLayer {
  readonly scene = new THREE.Scene();
  private readonly anchor = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly glare: THREE.Sprite;
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private curtain: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private readonly guides: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly tracks = new THREE.Group();
  private readonly sunDirection = new THREE.Vector3();

  constructor() {
    this.scene.add(this.anchor);
    this.stars = starField() as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    this.stars.renderOrder = 0;
    this.glare = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glareTexture(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.glare.renderOrder = 1;
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff4e2, depthTest: false, depthWrite: false, transparent: true }));
    this.sun.renderOrder = 2;
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms: { sunDirection: { value: this.sunDirection }, toViewer: { value: new THREE.Vector3(0, 0, 1) }, earthFrame: { value: new THREE.Matrix3() } }, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.earth.renderOrder = 2;
    this.anchor.add(this.stars, this.glare, this.sun, this.earth);

    // Planner guides: elevation lines at 0, 5 and 10 degrees, azimuth lines every 30 degrees.
    // Drawn before the curtain, so the skyline cuts them where it rises above them.
    const points: number[] = [];
    const at = (az: number, el: number) => directionToScene(az, el).map((v) => v * SKY_DISTANCE * 0.95);
    for (const el of [0, 5, 10]) {
      for (let az = 0; az < 360; az += 1) points.push(...at(az, el), ...at(az + 1, el));
    }
    for (let az = 0; az < 360; az += 30) points.push(...at(az, -10), ...at(az, 30));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    this.guides = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false }));
    this.guides.renderOrder = 2.5;
    this.guides.frustumCulled = false;
    this.guides.visible = false;
    this.tracks.renderOrder = 2.6;
    this.tracks.visible = false;
    this.anchor.add(this.guides, this.tracks);
  }

  /** Planner labels: guide lines and the tracks of the Sun and the Earth. */
  setGuides(visible: boolean) {
    this.guides.visible = visible;
    this.tracks.visible = visible;
  }

  /** The Sun's and the Earth's path over the mission window (directions as azimuth, elevation). */
  setTracks(sun: [number, number][], earth: [number, number][]) {
    for (const child of [...this.tracks.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.tracks.remove(line);
    }
    for (const [path, color] of [
      [sun, 0xffb340],
      [earth, 0x64d2ff],
    ] as const) {
      if (path.length < 2) continue;
      const positions = path.flatMap(([az, el]) => directionToScene(az, el).map((v) => v * SKY_DISTANCE * 0.96));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.6, dashSize: SKY_DISTANCE * 0.004, gapSize: SKY_DISTANCE * 0.004, depthTest: false, depthWrite: false }));
      line.computeLineDistances();
      line.renderOrder = 2.6;
      line.frustumCulled = false;
      this.tracks.add(line);
    }
  }

  /** The skyline the engine uses; null = the flat horizon of the sphere model. */
  setHorizon(horizon: Horizon | null) {
    if (this.curtain) {
      this.anchor.remove(this.curtain);
      this.curtain.geometry.dispose();
      this.curtain.material.dispose();
    }
    const positions = new Float32Array((CURTAIN_COLUMNS + 1) * 2 * 3);
    for (let c = 0; c <= CURTAIN_COLUMNS; c++) {
      const az = (c / CURTAIN_COLUMNS) * 360;
      const top = directionToScene(az, horizon ? horizonAt(horizon, az) : 0);
      const bottom = directionToScene(az, CURTAIN_BOTTOM_DEG);
      positions.set(top.map((v) => v * SKY_DISTANCE * 0.9), c * 6);
      positions.set(bottom.map((v) => v * SKY_DISTANCE * 0.9), c * 6 + 3);
    }
    const indices: number[] = [];
    for (let c = 0; c < CURTAIN_COLUMNS; c++) {
      const a = c * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    this.curtain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x1b1b1f, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true }));
    this.curtain.renderOrder = 3;
    this.curtain.frustumCulled = false;
    this.anchor.add(this.curtain);
  }

  /** Moves the sky with the observer and places the bodies. */
  update(eye: THREE.Vector3, sun: BodyState, earth: BodyState, starOpacity: number, glare: number, latDeg: number, timeMs: number) {
    this.anchor.position.copy(eye);
    const sunDir = directionToScene(sun.azimuthDeg, sun.elevationDeg);
    this.sunDirection.set(...sunDir);
    this.place(this.sun, sunDir, sun.radiusDeg);
    const earthDir = directionToScene(earth.azimuthDeg, earth.elevationDeg);
    this.place(this.earth, earthDir, earth.radiusDeg);
    // The globe's own axes in the scene (x east, y up, z south): its north along the Moon's
    // (illustrative), turned by the time of day.
    const lat = (latDeg * Math.PI) / 180;
    const [ny, nz] = [Math.sin(lat), -Math.cos(lat)];
    const turn = ((timeMs / EARTH_TURN_MS) % 1) * 2 * Math.PI;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    // e1 = east, e3 = e1 x north = (0, -nz, ny); rows: the globe's x, y (north), z.
    const uniforms = this.earth.material.uniforms;
    uniforms.earthFrame.value.set(cos, sin * nz, -sin * ny, 0, ny, nz, sin, -cos * nz, cos * ny);
    uniforms.toViewer.value.set(-earthDir[0], -earthDir[1], -earthDir[2]);
    const sunRadius = SKY_DISTANCE * Math.sin((sun.radiusDeg * Math.PI) / 180);
    this.glare.position.set(sunDir[0] * SKY_DISTANCE * 0.99, sunDir[1] * SKY_DISTANCE * 0.99, sunDir[2] * SKY_DISTANCE * 0.99);
    this.glare.scale.setScalar(sunRadius * 16);
    this.glare.material.opacity = glare;
    this.stars.material.uniforms.opacity.value = starOpacity;
  }

  private place(mesh: THREE.Mesh, dir: [number, number, number], radiusDeg: number) {
    mesh.position.set(dir[0] * SKY_DISTANCE, dir[1] * SKY_DISTANCE, dir[2] * SKY_DISTANCE);
    mesh.scale.setScalar(SKY_DISTANCE * Math.sin((radiusDeg * Math.PI) / 180));
  }

  dispose() {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }
}
