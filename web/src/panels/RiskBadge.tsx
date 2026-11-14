import { useMemo } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { analyzeWindow, scoreWindow, type RiskLevel, type Score } from "../engine/risk.ts";
import { Tip } from "../ui/Tooltip.tsx";
import type { ScenarioView } from "../state/view.ts";

const LEVEL_TEXT: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };
const LEVEL_ICON = { low: ShieldCheck, medium: ShieldAlert, high: ShieldX };
const CATEGORIES = [
  { id: "power", label: "Power" },
  { id: "comm", label: "Comm" },
  { id: "surface", label: "Surface" },
] as const;

/** Risk of the mission that lands at the scenario's start date; null if it leaves the data. */
function useScore(view: ScenarioView): Score | null {
  return useMemo(() => {
    const { series, slopeP95Deg } = view.data;
    const window = analyzeWindow(series, view.startMs);
    return window ? scoreWindow(window, series.profile, slopeP95Deg) : null;
  }, [view]);
}

/** The same mission scored with the horizon raised by the map's height error. */
function useMapErrorScore(view: ScenarioView): Score | null {
  return useMemo(() => {
    const { mapError, slopeP95Deg } = view.data;
    if (!mapError) return null;
    const window = analyzeWindow(mapError.series, view.startMs);
    return window ? scoreWindow(window, mapError.series.profile, slopeP95Deg) : null;
  }, [view]);
}

function ScoreColumn({ view, tagged }: { view: ScenarioView; tagged: boolean }) {
  const score = useScore(view);
  const worse = useMapErrorScore(view);
  const mapError = view.data.mapError;
  if (!score) return <p className="risk__none">The mission would end after the last date in the data.</p>;
  const Icon = LEVEL_ICON[score.level];
  return (
    <div className="risk__column" data-level={score.level}>
      <p className="risk__overall">
        {tagged ? <span className={`tag tag--${view.tag.toLowerCase()}`}>{view.tag}</span> : null}
        <span className="risk__number">{score.overall.toFixed(0)}</span>
        <span className="risk__level">
          <Icon aria-hidden="true" />
          {LEVEL_TEXT[score.level]}
        </span>
      </p>
      <dl className="risk__bars">
        {CATEGORIES.map(({ id, label }) => {
          const value = score[id];
          return (
            <div key={id} className="risk__bar" data-driver={(score.driver === id && score.overall > 0) || undefined}>
              <dt>{label}</dt>
              <dd>
                <span className="risk__track">
                  {/* A share of the track, drawn with a transform so it never animates layout. */}
                  <span className="risk__fill" style={{ transform: `scaleX(${(value ?? 0) / 100})` }} />
                </span>
                <span className="risk__value">{value === null ? "n/a" : value.toFixed(0)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {worse && mapError ? (
        <Tip label={`With map height error (${mapError.heightErrorM.toFixed(1)} m, horizon up to ${mapError.maxDeg.toFixed(2)}° higher)`} side="bottom">
          <p className="risk__error" data-changed={worse.level !== score.level || undefined}>
            Height error (+{mapError.heightErrorM.toFixed(1)} m):{" "}
            <strong>
              {worse.overall.toFixed(0)} · {LEVEL_TEXT[worse.level]}
            </strong>
          </p>
        </Tip>
      ) : null}
    </div>
  );
}

/**
 * Overall risk (the worst category) and the three categories behind it, for the mission
 * that lands at the start date. A transparent heuristic with placeholder limits, as the
 * limits say; it is always shown with its level in words, never as a color alone.
 * The limits come from the selected mission profile (see the mission parameters).
 */
export function RiskBadge({ views }: { views: ScenarioView[] }) {
  return (
    <section className="risk" aria-label="Mission risk">
      <h3 className="metric__label">
        Mission risk
      </h3>
      <div className="risk__columns">
        {views.map((view) => (
          <ScoreColumn key={view.tag} view={view} tagged={views.length > 1} />
        ))}
      </div>
    </section>
  );
}
