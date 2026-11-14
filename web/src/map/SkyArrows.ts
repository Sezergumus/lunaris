// Sun and Earth direction arrows at a pin.
//
// The projection is conformal, so a compass direction at a point is a fixed screen direction.
// With +y toward longitude 0 and +x toward 90°E, local north (away from the pole) at
// longitude L points L degrees clockwise from screen-up, and east is 90° further. A body at
// azimuth A (clockwise from north) is therefore drawn at screen bearing L + A. The map never
// rotates, and the arrows have a fixed screen length independent of zoom.
import L from "leaflet";

export interface ArrowState {
  sunAz: number;
  sunVisible: boolean;
  earthAz: number;
  earthVisible: boolean;
}

export interface SkyArrows {
  /** Turns the arrows; called on every frame while the timeline plays. */
  update: (state: ArrowState) => void;
  remove: () => void;
}

const SIZE = 150;

function arrowSvg(kind: "sun" | "earth", length: number): string {
  const tip = -length;
  // A dark copy underneath keeps the arrow readable on bright terrain.
  const shaft = `M0,-13L0,${tip + 7}`;
  const head = `M-5,${tip + 9}L0,${tip}L5,${tip + 9}`;
  return `<g class="sky-arrow sky-arrow--${kind}">
    <path class="sky-arrow__halo" d="${shaft}"/><path class="sky-arrow__halo" d="${head}"/>
    <path class="sky-arrow__shaft" d="${shaft}"/><path class="sky-arrow__head" d="${head}"/>
  </g>`;
}

/**
 * Adds a pair of arrows at a point. `secondary` draws the shorter pair of scenario B, so two
 * scenarios at the same place stay distinguishable.
 */
export function createSkyArrows(map: L.Map, lat: number, lon: number, secondary = false): SkyArrows {
  const length = secondary ? 44 : 62;
  const icon = L.divIcon({
    className: `sky-arrows${secondary ? " sky-arrows--b" : ""}`,
    html: `<svg viewBox="${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true">${arrowSvg("earth", length)}${arrowSvg("sun", length)}</svg>`,
    iconSize: [0, 0],
  });
  // Above the pins and their labels (the arrows let clicks through), so a label never hides one.
  const marker = L.marker([lat, lon], { icon, interactive: false, keyboard: false, zIndexOffset: 3500 }).addTo(map);
  const root = marker.getElement()!;
  const sun = root.querySelector<SVGGElement>(".sky-arrow--sun")!;
  const earth = root.querySelector<SVGGElement>(".sky-arrow--earth")!;

  return {
    update(state) {
      // Set directly, without a transition: the arrows track the cursor one to one.
      sun.setAttribute("transform", `rotate(${(lon + state.sunAz).toFixed(2)})`);
      earth.setAttribute("transform", `rotate(${(lon + state.earthAz).toFixed(2)})`);
      sun.toggleAttribute("data-hidden", !state.sunVisible);
      earth.toggleAttribute("data-hidden", !state.earthVisible);
    },
    remove() {
      marker.remove();
    },
  };
}
