import { useMemo } from "react";
import { CalendarClock, LoaderCircle, MapPinned, ScanSearch } from "lucide-react";
import { analyzeWindow, scoreWindow, type RiskLevel, type ScanRow, type Score } from "../engine/risk.ts";
import { LIVE_GRID, betterSpot, neighbourPlace, offsetText, type Nearby } from "../state/nearby.ts";
import { landingScan } from "../state/placeData.ts";
import { actions, getScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Button } from "../ui/Button.tsx";
import { formatUtcDate } from "../ui/format.ts";

const DAY_MS = 86400000;
const LEVEL_TEXT: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };
/** A low-risk date is only worth a suggestion when another date nearby is clearly better. */
const LOW_RISK_GAIN = 15;
const LOW_RISK_REACH_DAYS = 14;

/** "Risk 12 · Low" */
function riskText(overall: number, level: RiskLevel): string {
  return `Risk ${overall.toFixed(0)} · ${LEVEL_TEXT[level]}`;
}

/** "+9 pts" with a real minus sign. */
function signedPoints(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)} pts`;
}

/**
 * A better landing date for the place. When the selected date is not low risk: the low-risk
 * date closest to it, or failing that the lowest-risk date in the data. When it is low risk:
 * a date within two weeks that scores clearly lower.
 */
function betterDate(rows: ScanRow[], startMs: number, current: Score): ScanRow | null {
  const others = rows.filter((row) => Math.abs(row.landingMs - startMs) >= DAY_MS);
  const distance = (row: ScanRow) => Math.abs(row.landingMs - startMs);
  const closest = (list: ScanRow[]) => list.reduce<ScanRow | null>((best, row) => (!best || distance(row) < distance(best) ? row : best), null);
  if (current.level !== "low") {
    const low = closest(others.filter((row) => row.level === "low"));
    if (low) return low;
    const lowest = Math.min(...others.map((row) => row.risk_overall));
    if (!(lowest < Math.round(current.overall))) return null;
    return closest(others.filter((row) => row.risk_overall === lowest));
  }
  const reach = others.filter((row) => distance(row) <= LOW_RISK_REACH_DAYS * DAY_MS && row.risk_overall <= current.overall - LOW_RISK_GAIN);
  if (reach.length === 0) return null;
  const lowest = Math.min(...reach.map((row) => row.risk_overall));
  return closest(reach.filter((row) => row.risk_overall === lowest));
}

/** Scenario B = A's place on another date (`days` from A's date, negative = earlier). */
function compareDate(days: number) {
  const { placeA, placeB } = getScenario();
  if (!placeA) return;
  // B is A's place; a different place compared before gives way.
  if (placeB && placeB.id !== placeA.id) actions.compareWith(placeA);
  actions.slip(days);
}

/**
 * Up to two short suggestions under the risk card, for scenario A: a better spot within
 * +-500 m (the scored terrain grid) and a better landing date (the landing-date scan).
 * Shown only when there is something better, or when a custom point can still be scanned.
 */
export function Recommendations({ view, nearby }: { view: ScenarioView; nearby: Nearby }) {
  const { data, startMs } = view;
  const current = useMemo(() => {
    const window = analyzeWindow(data.series, startMs);
    return window ? { window, score: scoreWindow(window, data.series.profile, data.slopeP95Deg) } : null;
  }, [data, startMs]);
  const date = useMemo(() => (current ? betterDate(landingScan(data), startMs, current.score) : null), [data, startMs, current]);
  const { state } = nearby;
  const spot = state.status === "ready" ? betterSpot(state.result) : null;

  const spotRow = (() => {
    if (spot && state.status === "ready") {
      const { center, grid } = state.result;
      const open = (as: "a" | "b") => {
        const place = neighbourPlace(data.place, spot.point, grid);
        if (as === "a") actions.selectPlace(place);
        else actions.compareWith(place);
      };
      return (
        <li className="suggest__row">
          <MapPinned aria-hidden="true" />
          <div className="suggest__text">
            <p>
              Better spot <b>{offsetText(spot.point)}</b> · {riskText(spot.score.overall, spot.score.level)}, Sun {signedPoints(spot.window.power.sunlit_pct - center.window.power.sunlit_pct)}
            </p>
            <p className="suggest__note">
              Here: {riskText(center.score.overall, center.score.level)} with the same rules (slope within {grid.precision_m} m)
            </p>
          </div>
          <div className="suggest__actions">
            <Button size="sm" variant="filled" onClick={() => open("a")}>
              Select
            </Button>
            <Button size="sm" variant="plain" onClick={() => open("b")}>
              Compare
            </Button>
          </div>
        </li>
      );
    }
    if (state.status === "idle" || state.status === "loading" || state.status === "error") {
      const loading = state.status === "loading";
      return (
        <li className="suggest__row">
          <ScanSearch aria-hidden="true" />
          <div className="suggest__text">
            <p>{loading ? "Scanning ±500 m around this point…" : "Look for a better spot within ±500 m"}</p>
            <p className="suggest__note" data-tone={state.status === "error" ? "error" : undefined}>
              {state.status === "error"
                ? state.message
                : `${LIVE_GRID.grid * LIVE_GRID.grid} points ${LIVE_GRID.step} m apart from the terrain service, about 8 s`}
            </p>
          </div>
          <div className="suggest__actions">
            <Button size="sm" variant="filled" onClick={nearby.scan} disabled={loading}>
              {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              {loading ? "Scanning" : state.status === "error" ? "Retry" : "Scan nearby spots"}
            </Button>
          </div>
        </li>
      );
    }
    if (state.status === "ready" && data.place.kind === "custom") {
      return (
        <li className="suggest__row" data-quiet>
          <ScanSearch aria-hidden="true" />
          <p className="suggest__text">No better spot within ±500 m for this mission.</p>
        </li>
      );
    }
    return null;
  })();

  const dateRow = date ? (
    <li className="suggest__row">
      <CalendarClock aria-hidden="true" />
      <div className="suggest__text">
        <p>
          Better date <b>{formatUtcDate(date.landingMs)}</b> ({daysText(Math.round((date.landingMs - startMs) / DAY_MS))}) · {riskText(date.risk_overall, date.level)}, Sun{" "}
          {date.sunlit_pct.toFixed(0)} %
        </p>
      </div>
      <div className="suggest__actions">
        <Button size="sm" variant="filled" onClick={() => actions.setStart(date.landingMs)}>
          Jump
        </Button>
        <Button size="sm" variant="plain" onClick={() => compareDate(Math.round((date.landingMs - startMs) / DAY_MS))}>
          Compare
        </Button>
      </div>
    </li>
  ) : null;

  if (!spotRow && !dateRow) return null;
  return (
    <section className="suggest" aria-label="Suggestions">
      <h3 className="metric__label">
        Suggestions<span className="metric__hint"> · for this mission</span>
      </h3>
      <ul>
        {spotRow}
        {dateRow}
      </ul>
    </section>
  );
}

/** "+7 d", "−7 d" */
function daysText(days: number): string {
  return `${days >= 0 ? "+" : "−"}${Math.abs(days)} d`;
}
