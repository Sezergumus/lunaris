import { useEffect, useMemo, useRef, useState } from "react";
import type { RiskLevel, ScanRow } from "../engine/risk.ts";
import { landingScan } from "../state/placeData.ts";
import { actions, placeTitle, startOfB, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { formatUtcDate } from "../ui/format.ts";

const DAY_MS = 86400000;
const LEVELS: RiskLevel[] = ["low", "medium", "high"];
const LEVEL_TEXT: Record<RiskLevel, string> = { low: "low", medium: "medium", high: "high" };
/** Reserved status colors; every use is paired with the level in words (legend, hover card). */
const LEVEL_COLOR: Record<RiskLevel, string> = { low: "#30d158", medium: "#ffd60a", high: "#a8403a" };

/**
 * Risk of every possible landing date in the data, one day per cell, for scenario A's place.
 * The macro view of "what if the date slips": click a day to land there.
 *
 * The whole range is a few pixels per week, so a pixel column shows the best (lowest) level
 * among its days: short low-risk openings stay visible instead of being averaged away. The
 * hover card always reports the exact day.
 */
export function RiskStrip({ view }: { view: ScenarioView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ row: ScanRow; x: number } | null>(null);
  const startMs = useScenario((s) => s.startMs);
  const startB = useScenario(startOfB);
  const comparing = useScenario((s) => s.placeB !== null);

  const rows = useMemo(() => landingScan(view.data), [view.data]);
  const lowCount = useMemo(() => rows.filter((row) => row.level === "low").length, [rows]);

  // Draw on a canvas: about 1,500 cells, redrawn only when the data or the width changes.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const draw = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (width === 0 || rows.length === 0) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const columns = canvas.width;
      for (let column = 0; column < columns; column++) {
        const from = Math.floor((column / columns) * rows.length);
        const to = Math.max(from + 1, Math.floor(((column + 1) / columns) * rows.length));
        let best = 2;
        for (let i = from; i < to && i < rows.length; i++) best = Math.min(best, LEVELS.indexOf(rows[i].level));
        context.fillStyle = LEVEL_COLOR[LEVELS[best]];
        context.fillRect(column, 0, 1, canvas.height);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [rows]);

  if (rows.length === 0) return null;
  const first = rows[0].landingMs;
  const span = rows.length * DAY_MS;
  const fraction = (ms: number) => Math.min(1, Math.max(0, (ms - first) / span));

  const rowAt = (event: { clientX: number }) => {
    const box = wrapRef.current!.getBoundingClientRect();
    const x = Math.min(box.width - 1, Math.max(0, event.clientX - box.left));
    return { row: rows[Math.min(rows.length - 1, Math.floor((x / box.width) * rows.length))], x, width: box.width };
  };

  return (
    <div className="risk-strip">
      <p className="risk-strip__caption">
        <span className="risk-strip__title">
          <span>Landing-date risk</span>
          <span className="risk-strip__place">&nbsp;·&nbsp;{placeTitle(view.data.place)}</span>
          <span>
            &nbsp;· <b>{lowCount}</b> low-risk days
          </span>
        </span>
        <span className="risk-strip__legend" aria-hidden="true">
          {LEVELS.map((level) => (
            <span key={level}>
              <i style={{ background: LEVEL_COLOR[level] }} />
              {LEVEL_TEXT[level]}
            </span>
          ))}
        </span>
      </p>
      <div
        ref={wrapRef}
        className="risk-strip__plot"
        role="img"
        aria-label={`Risk of every landing date from ${formatUtcDate(first)} to ${formatUtcDate(rows[rows.length - 1].landingMs)}: ${lowCount} of ${rows.length} days are low risk. Click a day to land there.`}
        onPointerMove={(event) => setHover(rowAt(event))}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => actions.setStart(rowAt(event).row.landingMs)}
      >
        <canvas ref={canvasRef} />
        <span className="risk-strip__marker" style={{ left: `${fraction(startMs) * 100}%` }} />
        {comparing && startB !== startMs ? <span className="risk-strip__marker risk-strip__marker--b" style={{ left: `${fraction(startB) * 100}%` }} /> : null}
        {hover ? (
          <span className="risk-strip__hover" style={{ transform: `translateX(${hover.x}px)` }}>
            <span className="risk-strip__card" data-side={hover.x > 150 ? "left" : "right"}>
              <b>{formatUtcDate(hover.row.landingMs)}</b>
              <span>
                <i style={{ background: LEVEL_COLOR[hover.row.level] }} />
                risk {hover.row.risk_overall.toFixed(0)} · {LEVEL_TEXT[hover.row.level]}
              </span>
              <span>
                Sun {hover.row.sunlit_pct.toFixed(0)} % · link {hover.row.comm_pct.toFixed(0)} %
              </span>
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
