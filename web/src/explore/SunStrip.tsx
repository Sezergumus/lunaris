import { useMemo } from "react";
import { sampleIndex } from "../engine/sky.ts";
import type { PlaceData } from "../state/placeData.ts";

const W = 280;
const BAND = 16;

interface SunStripProps {
  data: PlaceData;
  landingMs: number;
  hours: number;
  /** Draw the battery line (debrief) on top of the band. */
  battery?: boolean;
  /** Where the battery ran out, hours after the landing. */
  failAtH?: number | null;
}

/**
 * The mission as a band: lit hours in the Sun's colour, dark hours dark, one tick per day,
 * and a ruler as long as the battery lasts, on the same scale. A darkness longer than the
 * ruler kills the lander: the player compares the two by eye.
 */
export function SunStrip({ data, landingMs, hours, battery = false, failAtH = null }: SunStripProps) {
  const { series } = data;
  const batteryH = series.profile.battery_survival_h;
  const x = (h: number) => (h / hours) * W;
  const shape = useMemo(() => {
    const first = sampleIndex(series, landingMs);
    const n = Math.round(hours / series.stepHours);
    const dark: [number, number][] = [];
    let start = -1;
    let line = "";
    let run = 0;
    for (let k = 0; k <= n; k++) {
      const i = first + k;
      const isDark = i >= 0 && i < series.count ? series.dark[i] === 1 : false;
      if (isDark && start < 0) start = k;
      if (!isDark && start >= 0) {
        dark.push([start, k]);
        start = -1;
      }
      run = isDark ? run + 1 : 0;
      const share = Math.max(0, 1 - (run * series.stepHours) / batteryH);
      line += `${line ? "L" : "M"}${((k * series.stepHours) / hours) * W},${(BAND + 6 + (1 - share) * 18).toFixed(1)}`;
    }
    if (start >= 0) dark.push([start, n]);
    return { dark: dark.map(([a, b]) => [a * series.stepHours, b * series.stepHours] as const), line };
  }, [series, landingMs, hours, batteryH]);

  const height = battery ? BAND + 30 : BAND + 22;
  const days = Math.floor(hours / 24);
  return (
    <figure className="strip">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Sun over the ${days} days: ${shape.dark.length === 0 ? "never dark" : `${shape.dark.length} dark stretch${shape.dark.length > 1 ? "es" : ""}, the longest ${Math.round(Math.max(...shape.dark.map(([a, b]) => b - a)))} h`}; the battery lasts ${batteryH} h`}>
        <rect className="strip__lit" x={0} y={0} width={W} height={BAND} rx={3} />
        {shape.dark.map(([a, b]) => (
          <rect key={a} className="strip__dark" x={x(a)} y={0} width={Math.max(1, x(b) - x(a))} height={BAND} />
        ))}
        {Array.from({ length: days + 1 }, (_, d) => (
          <line key={d} className="strip__tick" x1={x(d * 24)} x2={x(d * 24)} y1={BAND} y2={BAND + 3} />
        ))}
        {battery ? (
          <path className="strip__battery" d={shape.line} />
        ) : (
          <g>
            <rect className="strip__ruler" x={0} y={BAND + 8} width={x(batteryH)} height={4} rx={2} />
            <text className="strip__label" x={x(batteryH) + 4} y={BAND + 13}>
              battery: {batteryH} h without Sun
            </text>
          </g>
        )}
        {failAtH !== null ? <line className="strip__fail" x1={x(failAtH)} x2={x(failAtH)} y1={-2} y2={height} /> : null}
      </svg>
      <figcaption className="strip__legend">
        <span className="strip__key strip__key--lit">Sun</span>
        <span className="strip__key strip__key--dark">Dark</span>
        {battery ? <span className="strip__key strip__key--battery">Battery</span> : null}
        <span className="strip__days">{days} days →</span>
      </figcaption>
    </figure>
  );
}

