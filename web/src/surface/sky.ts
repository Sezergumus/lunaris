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

// Day side lit by the Sun (the phase follows from the Sun's direction); a faint night side.
const EARTH_FRAGMENT = /* glsl */ `
  uniform vec3 sunDirection;
  varying vec3 vNormal;
  void main() {
    float light = max(dot(normalize(vNormal), sunDirection), 0.0);
    vec3 day = vec3(0.55, 0.72, 0.95);
    vec3 color = day * (0.06 + 1.1 * light);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

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
      new THREE.ShaderMaterial({ uniforms: { sunDirection: { value: this.sunDirection } }, vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.earth.renderOrder = 2;
    this.anchor.add(this.stars, this.glare, this.sun, this.earth);
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
  update(eye: THREE.Vector3, sun: BodyState, earth: BodyState, starOpacity: number, glare: number) {
    this.anchor.position.copy(eye);
    const sunDir = directionToScene(sun.azimuthDeg, sun.elevationDeg);
    this.sunDirection.set(...sunDir);
    this.place(this.sun, sunDir, sun.radiusDeg);
    this.place(this.earth, directionToScene(earth.azimuthDeg, earth.elevationDeg), earth.radiusDeg);
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
