import { useMemo } from "react";
import { analyzeWindow } from "../engine/risk.ts";
import { useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { formatHours } from "../ui/format.ts";

/** "+22 pts" with a real minus sign; "same" when the difference rounds to zero. */
function signedPoints(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return "same";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} pts`;
}

type Trend = "up" | "down" | undefined;

/** Up is better, so a shorter darkness counts as "up". */
function trend(better: number): Trend {
  const rounded = Math.round(better);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : undefined;
}

/** "−13.5 d" with a real minus sign; "same" when it rounds to zero hours. */
function signedHours(delta: number): string {
  if (Math.round(delta) === 0) return "same";
  return `${delta > 0 ? "+" : "−"}${formatHours(Math.abs(delta))}`;
}

/** One metric: name, B's change against A, and both values (A → B). */
function Item({ label, change, better, detail }: { label: string; change: string; better: number; detail: string }) {
  return (
    <span className="compare-summary__item">
      <span className="compare-summary__label">{label}</span> <b data-trend={trend(better)}>{change}</b>{" "}
      <span className="compare-summary__detail">{detail}</span>
    </span>
  );
}

/**
 * Under the strips: what scenario B gains or loses against A over the window. One line on
 * wide screens, a small aligned table on phones (timeline.css). Differences are in
 * percentage points of the window ("pts"), with both values spelled out.
 */
export function CompareSummary({ views }: { views: ScenarioView[] }) {
  const hours = useScenario((s) => s.windowHours);
  const [a, b] = useMemo(() => views.map((view) => analyzeWindow(view.data.series, view.startMs, hours / 24)), [views, hours]);
  if (!a || !b) return null;
  const sun = b.power.sunlit_pct - a.power.sunlit_pct;
  const link = b.comm.available_pct - a.comm.available_pct;
  const dark = b.power.longest_darkness_h - a.power.longest_darkness_h;
  return (
    <p className="compare-summary">
      <span className="compare-summary__who">
        <span className="tag tag--b">B</span> vs <span className="tag tag--a">A</span>
      </span>
      <Item label="Usable Sun" change={signedPoints(sun)} better={sun} detail={`(${a.power.sunlit_pct.toFixed(0)} → ${b.power.sunlit_pct.toFixed(0)} %)`} />
      <Item label="Earth link" change={signedPoints(link)} better={link} detail={`(${a.comm.available_pct.toFixed(0)} → ${b.comm.available_pct.toFixed(0)} %)`} />
      <Item
        label="Longest darkness"
        change={signedHours(dark)}
        better={-dark}
        detail={`(${formatHours(a.power.longest_darkness_h)} → ${formatHours(b.power.longest_darkness_h)})`}
      />
    </p>
  );
}
