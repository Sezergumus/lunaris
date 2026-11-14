import { useMemo } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { PROFILE_PRESETS, analyzeWindow, scoreWindow, type ProfileKey, type RiskLevel, type Score } from "../engine/risk.ts";
import { actions, useScenario } from "../state/scenario.ts";
import { Segmented } from "../ui/Segmented.tsx";
import type { ScenarioView } from "../state/view.ts";

const LEVEL_TEXT: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };
const LEVEL_ICON = { low: ShieldCheck, medium: ShieldAlert, high: ShieldX };
const CATEGORIES = [
  { id: "power", label: "Power" },
  { id: "comm", label: "Comm" },
  { id: "surface", label: "Surface" },
] as const;
const PROFILE_OPTIONS = (Object.keys(PROFILE_PRESETS) as ProfileKey[]).map((key) => ({
  value: key,
  label: PROFILE_PRESETS[key].short,
  ariaLabel: PROFILE_PRESETS[key].label,
}));

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
        <p className="risk__error" data-changed={worse.level !== score.level || undefined}>
          With map height error ({mapError.heightErrorM.toFixed(1)} m, horizon up to {mapError.maxDeg.toFixed(2)}° higher):{" "}
          <strong>
            {worse.overall.toFixed(0)} · {LEVEL_TEXT[worse.level]}
          </strong>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Overall risk (the worst category) and the three categories behind it, for the mission
 * that lands at the start date. A transparent heuristic with placeholder limits, as the
 * footnote says; it is always shown with its level in words, never as a color alone.
 * The limits come from the selected mission profile, whose source is stated below it.
 */
export function RiskBadge({ views }: { views: ScenarioView[] }) {
  const profile = views[0].data.series.profile;
  const profileKey = useScenario((s) => s.profileKey);
  const edited = useScenario((s) => Object.keys(s.limitOverrides).length > 0);
  return (
    <section className="risk" aria-label="Mission risk">
      <h3 className="metric__label">
        Mission risk<span className="metric__hint"> · {profile.duration_days}-day mission · 0 best, 100 worst</span>
      </h3>
      <div className="risk__profile">
        <Segmented value={profileKey} onChange={actions.setProfile} options={PROFILE_OPTIONS} label="Mission profile" size="sm" />
      </div>
      <div className="risk__columns">
        {views.map((view) => (
          <ScoreColumn key={view.tag} view={view} tagged={views.length > 1} />
        ))}
      </div>
      <p className="risk__foot">
        Worst category counts. Limits: {profile.battery_survival_h} h of darkness, {profile.max_comm_outage_h} h without contact, {profile.min_daily_contact_h} h contact every day, {profile.max_slope_deg}° slope.
        <br />
        {edited ? "Limits changed by hand below." : PROFILE_PRESETS[profileKey].basis}
      </p>
    </section>
  );
}
