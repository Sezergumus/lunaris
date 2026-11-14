import { useEffect, useState } from "react";
import type L from "leaflet";
import { formatDistance } from "../geo/polar.ts";
import { ZOOM0_M_PER_PX } from "./trek.ts";

const MAX_WIDTH_PX = 112;
const DEG = Math.PI / 180;

/** Largest 1-2-5 length that fits within maxMeters. */
function niceLength(maxMeters: number): number {
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  for (const step of [5, 2, 1]) if (step * power <= maxMeters) return step * power;
  return power;
}

/**
 * Ground scale at the map center. Polar stereographic stretches the map by
 * k = 2 / (1 + cos(colatitude)), so a map pixel covers less ground away from the pole.
 */
function measure(map: L.Map): { meters: number; width: number } {
  const colat = (90 + map.getCenter().lat) * DEG;
  const groundPerPixel = ZOOM0_M_PER_PX / 2 ** map.getZoom() / (2 / (1 + Math.cos(colat)));
  const meters = niceLength(groundPerPixel * MAX_WIDTH_PX);
  return { meters, width: meters / groundPerPixel };
}

export function ScaleBar({ map }: { map: L.Map }) {
  const [scale, setScale] = useState(() => measure(map));

  useEffect(() => {
    const update = () => setScale(measure(map));
    map.on("zoom move", update);
    return () => {
      map.off("zoom move", update);
    };
  }, [map]);

  return (
    <div className="scale-bar glass" aria-label={`Scale: ${formatDistance(scale.meters)}`}>
      <span className="scale-bar__label">{formatDistance(scale.meters)}</span>
      <span className="scale-bar__rule" style={{ width: `${scale.width}px` }} />
    </div>
  );
}
