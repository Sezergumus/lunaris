import { useMemo } from "react";
import { sampleIndex } from "../engine/sky.ts";
import { useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";

const W = 260;
const H = 120;
const PAD = { left: 30, right: 8, top: 8, bottom: 18 };

function path(view: ScenarioView, hours: number, x: (h: number) => number, y: (deg: number) => number): string {
  const { sky, series } = view.data;
  const first = sampleIndex(series, view.startMs);
  const n = Math.round(hours / series.stepHours);
  let d = "";
  for (let k = 0; k <= n; k++) {
    const i = first + k;
    if (i < 0 || i >= series.count) continue;
    d += `${d ? "L" : "M"}${x(k * series.stepHours).toFixed(1)},${y(sky.sunAlt[i]).toFixed(1)}`;
  }
  return d;
}

/**
 * The Sun's elevation over one lunar day at the pole and at the equator on one axis: the
 * pole's line hugs zero while the equator's climbs to the zenith.
 */
export function SunPathInset({ pole, equator, hours }: { pole: ScenarioView; equator: ScenarioView; hours: number }) {
  const offsetMs = useScenario((s) => s.offsetMs);
  const frame = useMemo(() => {
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const lo = -20;
    const hi = 90;
    const x = (h: number) => PAD.left + (h / hours) * plotW;
    const y = (deg: number) => PAD.top + ((hi - Math.max(lo, Math.min(hi, deg))) / (hi - lo)) * plotH;
    return { x, y, pole: path(pole, hours, x, y), equator: path(equator, hours, x, y) };
  }, [pole, equator, hours]);
  const cursor = frame.x(Math.min(hours, offsetMs / 3600000));
  return (
    <figure className="inset">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Height of the Sun over one lunar day: here near the south pole and at the Apollo 11 site near the equator">
        {[0, 45, 90].map((deg) => (
          <g key={deg}>
            <line className="inset__grid" x1={PAD.left} x2={W - PAD.right} y1={frame.y(deg)} y2={frame.y(deg)} />
            <text className="inset__tick" x={PAD.left - 4} y={frame.y(deg) + 3}>
              {deg}°
            </text>
          </g>
        ))}
        <path className="inset__line inset__line--equator" d={frame.equator} />
        <path className="inset__line inset__line--pole" d={frame.pole} />
        <line className="inset__cursor" x1={cursor} x2={cursor} y1={PAD.top} y2={H - PAD.bottom} />
        <text className="inset__tick inset__tick--axis" x={W - PAD.right} y={H - 4}>
          {Math.round(hours / 24)} Earth days
        </text>
      </svg>
      <figcaption className="inset__legend">
        <span className="inset__key inset__key--pole">Here</span>
        <span className="inset__key inset__key--equator">Apollo 11, near the equator</span>
      </figcaption>
    </figure>
  );
}
