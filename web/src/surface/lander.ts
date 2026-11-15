// A generic lander standing at the place, for the drone view: it gives the terrain a scale.
//
// Illustrative: no specific vehicle. Its size is true (about 4 m across the footpads, a
// deck 2 m above the ground), and the mast ends at the observer's height, the height the
// risk model sees the sky from. Lit by the Sun's direction and the engine's sunlit share of
// the place, so it goes dark when the place does.
import * as THREE from "three";

/** Top of the deck above the ground, meters: the mast starts here. */
const DECK_M = 1.95;
const FOOT_RADIUS_M = 1.9;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A thin cylinder from a to b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.CylinderGeometry {
  const span = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, span.length(), 6);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, span.clone().normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

export class Lander {
  readonly group = new THREE.Group();
  private readonly sun = new THREE.DirectionalLight(0xfff4e2, 0);
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.1);
  private readonly mast: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    const material = (color: number) => {
      const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.materials.push(m);
      return m;
    };
    const foil = material(0xc9a24a);
    const metal = material(0xb4b6ba);
    const dark = material(0x3a3a3e);
    const panel = material(0x24407a);
    const add = (geometry: THREE.BufferGeometry, m: THREE.Material) => {
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, m);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };

    // Body, deck and engine bell.
    add(new THREE.CylinderGeometry(1.15, 1.15, 0.9, 8).translate(0, 1.25, 0), foil);
    add(new THREE.CylinderGeometry(0.9, 1.15, 0.25, 8).translate(0, 1.825, 0), metal);
    add(new THREE.CylinderGeometry(0.22, 0.5, 0.5, 12).translate(0, 0.55, 0), dark);
    // Four legs: a footpad, a main strut to the top of the body and a brace to its bottom.
    for (let k = 0; k < 4; k++) {
      const angle = Math.PI / 4 + (k * Math.PI) / 2;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const foot = new THREE.Vector3(cos * FOOT_RADIUS_M, 0.06, sin * FOOT_RADIUS_M);
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10).translate(foot.x, 0.03, foot.z), metal);
      add(strut(foot, new THREE.Vector3(cos * 1.05, 1.55, sin * 1.05), 0.05), metal);
      add(strut(foot, new THREE.Vector3(cos * 1.05, 0.85, sin * 1.05), 0.035), metal);
    }
    // Upright solar panels on two sides (at the poles the Sun stays near the horizon).
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(1.5, 1.1, 0.04).translate(side * 1.95, 1.45, 0), panel);
      add(strut(new THREE.Vector3(side * 1.1, 1.45, 0), new THREE.Vector3(side * 1.2, 1.45, 0), 0.04), metal);
    }
    // Dish on the deck.
    add(new THREE.CylinderGeometry(0.34, 0.06, 0.16, 12).translate(0.45, DECK_M + 0.16, 0.4), metal);
    // Mast (unit height, scaled to the observer's height) and the camera head on it.
    this.mast = add(new THREE.CylinderGeometry(0.04, 0.04, 1, 6).translate(0, 0.5, 0), metal);
    this.mast.position.y = DECK_M;
    this.head = add(new THREE.BoxGeometry(0.24, 0.16, 0.16), dark);

    this.group.add(this.sun, this.sun.target, this.ambient);
    this.setMast(2);
  }

  /** The mast ends at the observer's height above the ground, meters. */
  setMast(heightM: number) {
    const top = Math.max(DECK_M + 0.12, heightM);
    this.mast.scale.y = top - DECK_M;
    this.head.position.y = top;
  }

  /** Sun direction (scene frame) and the share of the Sun's disk the place sees (0-1). */
  setLight(sunDirection: THREE.Vector3, lit: number) {
    this.sun.position.copy(sunDirection);
    this.sun.intensity = 3 * lit;
    // In shadow a little fill light keeps the shape readable (illustrative, like the ground's).
    this.ambient.intensity = lit > 0.05 ? 0.12 : 0.3;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
