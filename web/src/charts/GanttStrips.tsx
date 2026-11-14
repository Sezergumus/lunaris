import { memo, useMemo } from "react";
import { runs } from "../engine/events.ts";
import type { PlaceData } from "../state/placeData.ts";
import { STRIP_ROWS, type StripRowId as RowId } from "./stripRows.ts";

/** One scenario's window on the strips. */
export interface StripSet {
  tag: "A" | "B";
  data: PlaceData;
  /** Index of the window's first sample. */
  first: number;
}

interface Intervals {
  sun: [number, number][];
  /** Part of the solar disk visible, but less than the usable share. */
  partial: [number, number][];
  link: [number, number][];
  both: [number, number][];
}

function intervals(data: PlaceData, first: number, hours: number): Intervals {
  const { series } = data;
  const count = Math.max(0, Math.min(hours, series.count - first));
  const partial = new Uint8Array(count);
  const both = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    const i = first + k;
    partial[k] = !series.sunlit[i] && !series.dark[i] ? 1 : 0;
    both[k] = series.sunlit[i] && series.comm[i] ? 1 : 0;
  }
  return {
    sun: runs(series.sunlit, first, count),
    partial: runs(partial, 0, count),
    link: runs(series.comm, first, count),
    both: runs(both, 0, count),
  };
}

function Strip({ row, spans, hours }: { row: RowId; spans: Intervals; hours: number }) {
  return (
    <svg className={`strip strip--${row}`} viewBox={`0 0 ${hours} 1`} preserveAspectRatio="none" aria-hidden="true">
      {row === "sun" ? spans.partial.map(([a, b]) => <rect key={`p${a}`} className="strip__partial" x={a} y={0} width={b - a} height={1} />) : null}
      {spans[row].map(([a, b]) => (
        <rect key={a} x={a} y={0} width={b - a} height={1} />
      ))}
    </svg>
  );
}

/**
 * Visibility strips over the window: usable Sun, direct-to-Earth link, and both at once.
 * With two scenarios each row holds A above B, so the same measure is compared directly.
 * Static for a given window; the playhead is drawn by the timeline on top.
 */
export const GanttStrips = memo(function GanttStrips({ sets, hours }: { sets: StripSet[]; hours: number }) {
  const spans = useMemo(() => sets.map((set) => intervals(set.data, set.first, hours)), [sets, hours]);
  return (
    <div className="strips" data-compare={sets.length > 1 || undefined}>
      {STRIP_ROWS.map((row) => (
        <div key={row.id} className="strips__row">
          {sets.map((set, index) => (
            <Strip key={set.tag} row={row.id} spans={spans[index]} hours={hours} />
          ))}
        </div>
      ))}
    </div>
  );
});
