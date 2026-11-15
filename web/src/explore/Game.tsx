import { useEffect, useMemo, useState } from "react";
import { Map as MapIcon, Rocket, RotateCcw } from "lucide-react";
import { loadSiteGrid, type SiteInfo } from "../data/load.ts";
import type { TerrainGrid, TerrainPoint } from "../engine/grid.ts";
import { hopOrigin, neighbourPlace, type NearbyResult } from "../state/nearby.ts";
import { landingScan } from "../state/placeData.ts";
import { modeActions } from "../state/mode.ts";
import { actions, getScenario, sitePlace, subscribeScenario, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { siteTitle } from "../sites.ts";
import { Button } from "../ui/Button.tsx";
import { DatePicker } from "../ui/DatePicker.tsx";
import { formatUtcDate, formatUtcDateTime } from "../ui/format.ts";
import { GAME_DAYS, dateHint, playOutcome, pointHint, type Outcome } from "./game.ts";

const HOUR_MS = 3600000;

interface GameProps {
  view: ScenarioView | undefined;
  sites: SiteInfo[];
  nearby: NearbyResult | null;
}

type Phase = { name: "pick" } | { name: "playing"; outcome: Outcome } | { name: "done"; outcome: Outcome };

/**
 * "Keep the lander alive for 14 days": pick one of the 81 points around a site and a landing
 * date; the mission then plays in the surface view and stops when the battery runs out.
 */
export function Game({ view, sites, nearby }: GameProps) {
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const limits = useScenario((s) => s.limits);
  const startMs = useScenario((s) => s.startMs);
  const windowHours = useScenario((s) => s.windowHours);
  const placeA = useScenario((s) => s.placeA);
  const gridSites = sites.filter((site) => site.grid);
  // The site the point belongs to: the place itself, or the site its grid point was hopped from.
  const origin = placeA ? hopOrigin(placeA.id)?.origin : null;
  const siteKey = placeA?.kind === "site" ? placeA.key : origin?.kind === "site" ? origin.key : null;
  const site = gridSites.find((s) => s.key === siteKey) ?? null;

  const [grid, setGrid] = useState<{ key: string; grid: TerrainGrid } | null>(null);
  useEffect(() => {
    if (!siteKey) return;
    let alive = true;
    loadSiteGrid(siteKey).then((g) => alive && setGrid({ key: siteKey, grid: g }));
    return () => {
      alive = false;
    };
  }, [siteKey]);
  const points = grid && grid.key === siteKey ? grid.grid : null;

  // Stop the time-lapse when the battery runs out.
  useEffect(() => {
    if (phase.name !== "playing") return;
    const stopAt = phase.outcome.survivedH * HOUR_MS;
    // Once only: the actions below notify this same listener again.
    let stopped = false;
    const check = () => {
      const s = getScenario();
      if (!stopped && s.offsetMs >= stopAt) {
        stopped = true;
        actions.setPlaying(false);
        actions.setOffsetMs(Math.min(stopAt, s.offsetMs));
        setPhase({ name: "done", outcome: phase.outcome });
      }
    };
    return subscribeScenario(check);
  }, [phase]);

  const current = useMemo(() => {
    if (!points || !view) return null;
    let best: TerrainPoint = points.points[0];
    let bestD = Infinity;
    for (const point of points.points) {
      const d = Math.hypot(point.lat - view.data.lat, (point.lon - view.data.lon) * Math.cos((point.lat * Math.PI) / 180));
      if (d < bestD) {
        bestD = d;
        best = point;
      }
    }
    return best;
  }, [points, view]);

  const choosePoint = (point: TerrainPoint) => {
    if (!site || !points) return;
    setPhase({ name: "pick" });
    actions.setOffsetMs(0);
    actions.selectPlace(neighbourPlace(sitePlace(site), point, points));
  };

  const land = () => {
    if (!view) return;
    const outcome = playOutcome(view.data, startMs);
    actions.setOffsetMs(0);
    actions.setPlaying(true);
    setPhase({ name: "playing", outcome });
  };

  const rule = view ? `Rule: the lander runs on sunlight. If it spends more than ${view.data.series.profile.battery_survival_h} h in a row without any Sun, the battery runs out.` : "";

  if (phase.name === "done" && view) {
    const { outcome } = phase;
    const day = outcome.survivedH / 24;
    let hint: string | null = null;
    if (outcome.failed) {
      const near = nearby && current ? pointHint(nearby.scored, current, outcome.batteryH) : null;
      const date = dateHint(landingScan(view.data), startMs, outcome.batteryH);
      hint = near ? `Try the point ${near.text} of here, same date.` : date !== null ? `Try landing on ${formatUtcDate(date)} at the same point.` : "No date in the data keeps this point alive: try another point.";
    }
    return (
      <div className="game">
        <div className="explorer__words">
          <p className="explorer__step-title">Keep the lander alive</p>
          {outcome.failed ? (
            <p>
              Day {day.toFixed(1)}: the battery ran out.{" "}
              {outcome.darkStartMs! <= startMs
                ? `The lander touched down in the shadow of ${outcome.cause === "terrain" ? "the terrain" : "the night"} and the Sun did not come back for more than ${outcome.batteryH} h.`
                : `The Sun went ${outcome.cause === "terrain" ? "behind the terrain" : "below the horizon"} on ${formatUtcDateTime(outcome.darkStartMs!)} and stayed away for more than ${outcome.batteryH} h.`}
            </p>
          ) : (
            <p>
              The lander made it: {GAME_DAYS} days on the surface, never more than {outcome.batteryH} h without the Sun.
            </p>
          )}
          {hint ? <p>{hint}</p> : <p>Now try a point or a date that fails, and see why.</p>}
        </div>
        <div className="game__buttons">
          <Button size="sm" variant="accent" onClick={() => (actions.setOffsetMs(0), setPhase({ name: "pick" }))}>
            <RotateCcw aria-hidden="true" /> Try again
          </Button>
          <Button size="sm" onClick={() => modeActions.setMode("plan")}>
            <MapIcon aria-hidden="true" /> Open in Planner
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      <div className="explorer__words">
        <p className="explorer__step-title">Keep the lander alive for {GAME_DAYS} days</p>
        <p>Pick a spot within 500 m and a landing date, then land.</p>
        <p>{rule}</p>
      </div>
      <div className="game__pick">
        <div className="game__sites" role="radiogroup" aria-label="Site">
          {gridSites.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={s.key === siteKey} className="game__site" onClick={() => (setPhase({ name: "pick" }), actions.selectPlace(sitePlace(s)))}>
              {siteTitle(s.name)}
            </button>
          ))}
        </div>
        {points ? (
          <div className="game__grid" role="radiogroup" aria-label="Spot within 500 m, north up" style={{ gridTemplateColumns: `repeat(${Math.round(Math.sqrt(points.points.length))}, 1fr)` }}>
            {[...points.points]
              .sort((p, q) => q.north_m - p.north_m || p.east_m - q.east_m)
              .map((point) => (
                <button
                  key={`${point.east_m},${point.north_m}`}
                  type="button"
                  role="radio"
                  aria-checked={point === current}
                  aria-label={`${Math.round(point.east_m)} m east, ${Math.round(point.north_m)} m north`}
                  className="game__cell"
                  data-center={point.east_m === 0 && point.north_m === 0 ? true : undefined}
                  disabled={phase.name === "playing"}
                  onClick={() => choosePoint(point)}
                />
              ))}
          </div>
        ) : null}
        {limits ? (
          <DatePicker label="Landing date" valueMs={startMs} minMs={limits.minMs} maxMs={limits.maxMs - windowHours * HOUR_MS} onChange={(ms) => (setPhase({ name: "pick" }), actions.setStart(ms))} />
        ) : null}
        <Button size="sm" variant="accent" disabled={!view || phase.name === "playing"} onClick={land}>
          <Rocket aria-hidden="true" /> {phase.name === "playing" ? "Landed…" : "Land"}
        </Button>
      </div>
    </div>
  );
}
