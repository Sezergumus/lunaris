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

/**
 * One line under the strips: what scenario B gains or loses against A over the window.
 * Differences are in percentage points of the window ("pts"), with both values spelled out.
 */
export function CompareSummary({ views }: { views: ScenarioView[] }) {
  const hours = useScenario((s) => s.windowHours);
  const [a, b] = useMemo(() => views.map((view) => analyzeWindow(view.data.series, view.startMs, hours / 24)), [views, hours]);
  if (!a || !b) return null;
  const sun = b.power.sunlit_pct - a.power.sunlit_pct;
  const link = b.comm.available_pct - a.comm.available_pct;
  return (
    <p className="compare-summary">
      <span className="compare-summary__who">
        <span className="tag tag--b">B</span> vs <span className="tag tag--a">A</span>
      </span>
      <span>
        usable Sun{" "}
        <b data-trend={Math.round(sun) > 0 ? "up" : Math.round(sun) < 0 ? "down" : undefined}>{signedPoints(sun)}</b> ({a.power.sunlit_pct.toFixed(0)} →{" "}
        {b.power.sunlit_pct.toFixed(0)} %)
      </span>
      <span>
        Earth link <b data-trend={Math.round(link) > 0 ? "up" : Math.round(link) < 0 ? "down" : undefined}>{signedPoints(link)}</b> (
        {a.comm.available_pct.toFixed(0)} → {b.comm.available_pct.toFixed(0)} %)
      </span>
      <span>
        longest darkness {formatHours(a.power.longest_darkness_h)} → <b>{formatHours(b.power.longest_darkness_h)}</b>
      </span>
    </p>
  );
}
