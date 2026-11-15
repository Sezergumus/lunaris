// Terrain shadows on the GPU.
//
// One render target per level, one texel per height pixel. For every texel the shader takes
// the surface point (from a position texture written on the CPU) and marches toward the Sun
// over the height textures of all four levels, keeping the smallest angular clearance of the
// ray above the terrain. The lit share is the visible part of the Sun's disk at that
// clearance, the same rule as the engine's terrainDiskFraction. Steps start at one pixel and
// grow with distance; the march stops when the ray is above the highest terrain or leaves
// the outermost patch.
//
// Heights along the ray come without cancellation from the scene position Q:
//   h(Q) = (2 R0 Q.y + |Q|^2) / (|Q - C| + R0) + ground,  C = (0, -R0, 0),  R0 = R + ground,
// and Q's projected position from the Moon-fixed unit vector m of Q - C:
//   x = 2R m.y / (1 - m.z),  y = 2R m.x / (1 - m.z).
import * as THREE from "three";
import type { TerrainPatch } from "../data/load.ts";
import { MOON_RADIUS_M } from "./geometry.ts";
import type { LevelMesh } from "./terrain.ts";

const MAX_STEPS = 420;
/** Step growth with distance: a step is at least this share of the distance marched. */
const STEP_GROWTH = 0.02;

const VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D positions;
  uniform sampler2D h0;
  uniform sampler2D h1;
  uniform sampler2D h2;
  uniform sampler2D h3;
  // x0, y0 (top-left edge, projected m), pixel size (m), size (texels)
  uniform vec4 l0;
  uniform vec4 l1;
  uniform vec4 l2;
  uniform vec4 l3;
  uniform vec3 sunDirection;
  uniform float sunRadius;
  uniform float startStep;
  uniform float r0;
  uniform float ground;
  uniform float moonRadius;
  uniform float maxHeight;
  uniform mat3 sceneToFixed;
  out vec4 outColor;

  float bilinear(sampler2D tex, vec4 l, vec2 xy, out bool inside) {
    vec2 p = vec2((xy.x - l.x) / l.z - 0.5, (l.y - xy.y) / l.z - 0.5);
    inside = p.x >= 0.0 && p.y >= 0.0 && p.x < l.w - 1.0 && p.y < l.w - 1.0;
    if (!inside) return 0.0;
    ivec2 i = ivec2(floor(p));
    vec2 f = p - vec2(i);
    float a = texelFetch(tex, i, 0).r;
    float b = texelFetch(tex, i + ivec2(1, 0), 0).r;
    float c = texelFetch(tex, i + ivec2(0, 1), 0).r;
    float d = texelFetch(tex, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Height of the terrain at a projected point from the finest level that holds it.
  bool terrainAt(vec2 xy, out float height, out float pixel) {
    bool inside;
    height = bilinear(h0, l0, xy, inside); pixel = l0.z; if (inside) return true;
    height = bilinear(h1, l1, xy, inside); pixel = l1.z; if (inside) return true;
    height = bilinear(h2, l2, xy, inside); pixel = l2.z; if (inside) return true;
    height = bilinear(h3, l3, xy, inside); pixel = l3.z; return inside;
  }

  void main() {
    vec3 p = texelFetch(positions, ivec2(gl_FragCoord.xy), 0).xyz;
    vec3 c = vec3(0.0, -r0, 0.0);
    float clearance = 1e9;
    float t = startStep;
    for (int k = 0; k < ${MAX_STEPS}; k++) {
      vec3 q = p + sunDirection * t;
      vec3 qc = q - c;
      float hq = (2.0 * r0 * q.y + dot(q, q)) / (length(qc) + r0) + ground;
      if (hq > maxHeight) break;
      vec3 m = sceneToFixed * normalize(qc);
      vec2 xy = vec2(2.0 * moonRadius * m.y, 2.0 * moonRadius * m.x) / (1.0 - m.z);
      float ht;
      float pixel;
      if (!terrainAt(xy, ht, pixel)) break;
      clearance = min(clearance, (hq - ht) / t);
      if (clearance < -1.5 * sunRadius) break;
      t += max(pixel, t * ${STEP_GROWTH});
    }
    float x = clamp(clearance / sunRadius, -1.0, 1.0);
    float lit = 0.5 + (x * sqrt(1.0 - x * x) + asin(x)) / 3.14159265;
    outColor = vec4(lit, 0.0, 0.0, 1.0);
  }
`;

function floatTexture(data: Float32Array, size: number, channels: 1 | 4): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, channels === 1 ? THREE.RedFormat : THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export class ShadowPass {
  /** Lit share of the Sun's disk per texel, one per level (finest first). */
  readonly targets: THREE.WebGLRenderTarget[];
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly positionTextures: THREE.DataTexture[];
  private readonly heightTextures: THREE.DataTexture[];
  private readonly levels: LevelMesh[];

  constructor(patch: TerrainPatch, levels: LevelMesh[], latDeg: number, lonDeg: number, groundHeightM: number) {
    this.levels = levels;
    this.heightTextures = patch.levels.map((level) => floatTexture(level.heights, level.size, 1));
    this.positionTextures = levels.map((level) => {
      const n = level.level.size;
      const rgba = new Float32Array(n * n * 4);
      for (let k = 0; k < n * n; k++) rgba.set(level.positions.subarray(k * 3, k * 3 + 3), k * 4);
      return floatTexture(rgba, n, 4);
    });
    this.targets = levels.map((level) => {
      const target = new THREE.WebGLRenderTarget(level.level.size, level.level.size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
      target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
      target.texture.generateMipmaps = false;
      return target;
    });

    let maxHeight = -Infinity;
    for (const level of patch.levels) for (let i = 0; i < level.heights.length; i++) maxHeight = Math.max(maxHeight, level.heights[i]);

    // Scene axes in Moon-fixed coordinates: x = east, y = up, z = -north.
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
    const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const south = new THREE.Vector3(Math.sin(lat) * Math.cos(lon), Math.sin(lat) * Math.sin(lon), -Math.cos(lat));
    const sceneToFixed = new THREE.Matrix3().set(east.x, up.x, south.x, east.y, up.y, south.y, east.z, up.z, south.z);

    const info = patch.levels.map((l) => new THREE.Vector4(l.x0, l.y0, l.pixelM, l.size));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        positions: { value: null },
        h0: { value: this.heightTextures[0] },
        h1: { value: this.heightTextures[1] },
        h2: { value: this.heightTextures[2] },
        h3: { value: this.heightTextures[3] },
        l0: { value: info[0] },
        l1: { value: info[1] },
        l2: { value: info[2] },
        l3: { value: info[3] },
        sunDirection: { value: new THREE.Vector3() },
        sunRadius: { value: 0 },
        startStep: { value: 60 },
        r0: { value: MOON_RADIUS_M + groundHeightM },
        ground: { value: groundHeightM },
        moonRadius: { value: MOON_RADIUS_M },
        maxHeight: { value: maxHeight + 1 },
        sceneToFixed: { value: sceneToFixed },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Recomputes every level for a Sun direction (scene frame) and disk radius (degrees). */
  update(renderer: THREE.WebGLRenderer, sunDirection: THREE.Vector3, sunRadiusDeg: number) {
    const uniforms = this.material.uniforms;
    uniforms.sunDirection.value.copy(sunDirection);
    uniforms.sunRadius.value = (sunRadiusDeg * Math.PI) / 180;
    const previous = renderer.getRenderTarget();
    this.levels.forEach((level, k) => {
      uniforms.positions.value = this.positionTextures[k];
      uniforms.startStep.value = level.level.pixelM;
      renderer.setRenderTarget(this.targets[k]);
      renderer.render(this.scene, this.camera);
    });
    renderer.setRenderTarget(previous);
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.positionTextures.forEach((t) => t.dispose());
    this.heightTextures.forEach((t) => t.dispose());
    this.material.dispose();
  }
}
