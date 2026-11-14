import { memo, useMemo } from "react";
import { EARTH_RADIUS_DEG, SUN_RADIUS_DEG, horizonAt } from "../engine/risk.ts";
import { sampleIndex } from "../engine/sky.ts";
import type { PlaceData } from "../state/placeData.ts";
import { useScenario } from "../state/scenario.ts";
import { useInstant, type ScenarioView } from "../state/view.ts";
import { formatAngle } from "../ui/format.ts";

const W = 328;
const AXIS_H = 15;
/** Elevation range shown when the terrain fits in it; widened to the site's horizon otherwise. */
const BASE_RANGE = [-5, 12] as const;

interface Frame {
  h: number;
  plotH: number;
  lo: number;
  hi: number;
  x: (azimuthDeg: number) => number;
  y: (elevationDeg: number) => number;
  /** Pixels per degree of elevation. */
  yScale: number;
}

function makeFrame(data: PlaceData, height: number): Frame {
  let lo: number = BASE_RANGE[0];
  let hi: number = BASE_RANGE[1];
  if (data.horizon) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.horizon.horizonDeg.length; i++) {
      const v = data.horizon.horizonDeg[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo = Math.min(lo, Math.floor(min - 1));
    hi = Math.max(hi, Math.ceil(max + 3));
  }
  const plotH = height - AXIS_H;
  const yScale = plotH / (hi - lo);
  return {
    h: height,
    plotH,
    lo,
    hi,
    // North in the middle: seen from the south polar region the Earth hangs near north.
    x: (az) => ((((az + 180) % 360) + 360) % 360) * (W / 360),
    y: (alt) => (hi - alt) * yScale,
    yScale,
  };
}

/** Sky, grid and compass: what lies behind the disks and does not move with the cursor. */
const Backdrop = memo(function Backdrop({ frame, id }: { frame: Frame; id: string }) {
  const yTicks = [frame.hi, 0, frame.lo].filter((v, i, list) => list.indexOf(v) === i);
  return (
    <>
      <defs>
        <clipPath id={`${id}-plot`}>
          <rect x={0} y={0} width={W} height={frame.plotH} />
        </clipPath>
        <linearGradient id={`${id}-ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3a42" />
          <stop offset="1" stopColor="#1d1d22" />
        </linearGradient>
      </defs>
      <rect className="hv__sky" x={0} y={0} width={W} height={frame.plotH} rx={8} />
      <line className="hv__zero" x1={0} x2={W} y1={frame.y(0)} y2={frame.y(0)} />
      {yTicks.map((value) => (
        <text key={value} className="hv__ytick" x={4} y={Math.min(frame.plotH - 3, Math.max(9, frame.y(value) - 3))}>
          {value === 0 ? "0°" : formatAngle(value, 0)}
        </text>
      ))}
      {(["S", "W", "N", "E", "S"] as const).map((label, i) => (
        <text key={i} className="hv__compass" x={Math.min(W - 5, Math.max(5, (i * W) / 4))} y={frame.h - 3} data-north={label === "N" || undefined}>
          {label}
        </text>
      ))}
    </>
  );
});

/** Where the Sun and the Earth go during the window: a faint dotted track. */
const Trails = memo(function Trails({ view, frame, hours }: { view: ScenarioView; frame: Frame; hours: number }) {
  const dots = useMemo(() => {
    const { sky } = view.data;
    const first = sampleIndex(sky, view.startMs);
    const sun: [number, number][] = [];
    const earth: [number, number][] = [];
    const step = hours > 400 ? 6 : 3;
    for (let k = 0; k <= hours && first + k < sky.count; k += step) {
      const i = first + k;
      sun.push([frame.x(sky.sunAz[i]), frame.y(sky.sunAlt[i])]);
      earth.push([frame.x(sky.earthAz[i]), frame.y(sky.earthAlt[i])]);
    }
    const inside = ([, y]: [number, number]) => y > 1 && y < frame.plotH - 1;
    return { sun: sun.filter(inside), earth: earth.filter(inside) };
  }, [view, frame, hours]);
  return (
    <g aria-hidden="true">
      {dots.sun.map(([x, y], i) => (
        <circle key={`s${i}`} className="hv__trail hv__trail--sun" cx={x} cy={y} r={0.8} />
      ))}
      {dots.earth.map(([x, y], i) => (
        <circle key={`e${i}`} className="hv__trail hv__trail--earth" cx={x} cy={y} r={0.8} />
      ))}
    </g>
  );
});

interface BodyProps {
  kind: "sun" | "earth";
  label: string;
  az: number;
  alt: number;
  radiusDeg: number;
  visible: boolean;
  frame: Frame;
  layer: "behind" | "front";
}

/**
 * A disk at its true angular radius on the vertical scale. The disk itself is drawn behind
 * the terrain, so a grazing Sun is really cut by the ridge; the ring and the label are drawn
 * in front so a hidden body can still be found.
 */
function Body({ kind, label, az, alt, radiusDeg, visible, frame, layer }: BodyProps) {
  const x = frame.x(az);
  const r = radiusDeg * frame.yScale;
  const above = alt - radiusDeg > frame.hi;
  const below = alt + radiusDeg < frame.lo;

  if (above || below) {
    if (layer === "behind") return null;
    // Outside the range: an arrow on the edge, with the elevation written next to it.
    const y = above ? 5 : frame.plotH - 5;
    const back = above ? 4 : -4;
    const anchor = x > W - 60 ? "end" : "start";
    return (
      <g className={`hv__body hv__body--${kind}`}>
        <path className="hv__offscale" d={`M${x - 4},${y + back}L${x},${y}L${x + 4},${y + back}`} />
        <text className="hv__label" x={x + (anchor === "end" ? -8 : 8)} y={above ? 12 : frame.plotH - 5} textAnchor={anchor}>
          {label} {formatAngle(alt, 1)}
        </text>
      </g>
    );
  }

  const y = frame.y(alt);
  if (layer === "behind") {
    return (
      <g className={`hv__body hv__body--${kind}`} data-hidden={!visible || undefined}>
        {kind === "sun" ? <circle className="hv__glow" cx={x} cy={y} r={r + 7} /> : null}
        <circle className="hv__disk" cx={x} cy={y} r={r} />
      </g>
    );
  }
  const labelAnchor = x > W - 36 ? "end" : x < 36 ? "start" : "middle";
  return (
    <g className={`hv__body hv__body--${kind}`} data-hidden={!visible || undefined}>
      <circle className="hv__ring" cx={x} cy={y} r={Math.max(r + 2.5, 5)} />
      <text className="hv__label" x={x} y={Math.max(9, y - Math.max(r, 4) - 5)} textAnchor={labelAnchor}>
        {label}
      </text>
    </g>
  );
}

function Bodies({ view, frame, layer }: { view: ScenarioView; frame: Frame; layer: "behind" | "front" }) {
  const at = useInstant(view);
  return (
    <>
      <Body kind="earth" label="Earth" az={at.earthAz} alt={at.earthAlt} radiusDeg={EARTH_RADIUS_DEG} visible={at.earthVisible} frame={frame} layer={layer} />
      <Body kind="sun" label="Sun" az={at.sunAz} alt={at.sunAlt} radiusDeg={SUN_RADIUS_DEG} visible={at.sunVisible} frame={frame} layer={layer} />
    </>
  );
}

/**
 * The whole horizon unrolled: azimuth across (north in the middle), elevation up. The second
 * view of the site-Sun-Earth geometry next to the map.
 */
export function HorizonView({ view, compact = false }: { view: ScenarioView; compact?: boolean }) {
  const hours = useScenario((s) => s.windowHours);
  const height = compact ? 118 : 150;
  const frame = useMemo(() => makeFrame(view.data, height), [view.data, height]);
  const id = `hv-${view.tag}`;

  return (
    <figure className="hv">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Horizon around ${view.data.place.name} with the Sun and the Earth`}>
        <Backdrop frame={frame} id={id} />
        {/* Order matters: disks, then terrain on top of them, then rings and labels. */}
        <g clipPath={`url(#${id}-plot)`}>
          <Trails view={view} frame={frame} hours={hours} />
          <Bodies view={view} frame={frame} layer="behind" />
        </g>
        <TerrainOverlay data={view.data} frame={frame} id={id} />
        <Bodies view={view} frame={frame} layer="front" />
      </svg>
    </figure>
  );
}

/** The silhouette, drawn in front of the disks so terrain really hides what is behind it. */
const TerrainOverlay = memo(function TerrainOverlay({ data, frame, id }: { data: PlaceData; frame: Frame; id: string }) {
  const ridge = useMemo(() => {
    const points: string[] = [];
    for (let px = 0; px <= W; px += 0.5) {
      const az = (px / W) * 360 - 180;
      points.push(`${px},${frame.y(data.horizon ? horizonAt(data.horizon, az) : 0).toFixed(2)}`);
    }
    return `M${points.join("L")}`;
  }, [data.horizon, frame]);
  return (
    <g clipPath={`url(#${id}-plot)`}>
      <path d={`${ridge}L${W},${frame.plotH}L0,${frame.plotH}Z`} fill={`url(#${id}-ground)`} />
      <path className="hv__ridge" d={ridge} />
    </g>
  );
});
