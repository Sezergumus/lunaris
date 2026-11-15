// LOLA height patches -> three.js meshes, one per level.
//
// Levels are nested squares around the site (60, 240, 960, 3840 m pixels). They are drawn
// from the outermost to the innermost with the depth buffer cleared in between (scene.ts),
// so an outer level never needs the cells an inner level already covers: those are left out,
// keeping one coarse cell of overlap so no gap opens at the seam.
import * as THREE from "three";
import type { PatchLevel, TerrainPatch } from "../data/load.ts";
import type { SiteFrame } from "./geometry.ts";

export interface LevelMesh {
  mesh: THREE.Mesh;
  /** Nearest and farthest scene distance any of its vertices can have from the observer, meters. */
  near: number;
  far: number;
  level: PatchLevel;
  /** Scene positions of every pixel center, row by row (also used by the shadow pass). */
  positions: Float32Array;
}

/** Pixel center of column i / row j, projected meters. */
const centerX = (level: PatchLevel, i: number) => level.x0 + (i + 0.5) * level.pixelM;
const centerY = (level: PatchLevel, j: number) => level.y0 - (j + 0.5) * level.pixelM;

export function buildLevels(patch: TerrainPatch, frame: SiteFrame, material: (index: number) => THREE.Material): LevelMesh[] {
  return patch.levels.map((level, index) => {
    const n = level.size;
    const positions = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      const y = centerY(level, j);
      for (let i = 0; i < n; i++) frame.toScene(centerX(level, i), y, level.heights[j * n + i], positions, (j * n + i) * 3);
    }

    // Cells fully inside the next finer level (less one cell of overlap) are skipped.
    const inner = index > 0 ? patch.levels[index - 1] : null;
    const skip = (i: number, j: number) => {
      if (!inner) return false;
      const margin = level.pixelM;
      const left = inner.x0 + margin;
      const right = inner.x0 + inner.size * inner.pixelM - margin;
      const top = inner.y0 - margin;
      const bottom = inner.y0 - inner.size * inner.pixelM + margin;
      return centerX(level, i) >= left && centerX(level, i + 1) <= right && centerY(level, j) <= top && centerY(level, j + 1) >= bottom;
    };
    const indices: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        if (skip(i, j)) continue;
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // (a, c, b) faces up: the projected grid is rotated against the local axes by the
        // site's longitude, but checked numerically, column step x row step points up.
        indices.push(a, c, b, b, c, d);
      }
    }

    // Where each vertex reads its own texel of the shadow texture (shadow.ts).
    const shadowUv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) shadowUv.set([(i + 0.5) / n, (j + 0.5) / n], (j * n + i) * 2);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("shadowUv", new THREE.BufferAttribute(shadowUv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material(index));
    mesh.frustumCulled = false;

    // Distances for the per-level near and far planes.
    let near = Infinity;
    let far = 0;
    for (const k of indices) {
      const d = Math.hypot(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
      if (d < near) near = d;
      if (d > far) far = d;
    }
    return { mesh, near, far, level, positions };
  });
}
