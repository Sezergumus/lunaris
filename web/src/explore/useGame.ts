// State of the landing game, shared by its caption panel and the cards on the stage.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadSiteGrid, type SiteInfo } from "../data/load.ts";
import type { TerrainGrid, TerrainPoint } from "../engine/grid.ts";
import { neighbourPlace, offsetText, type NearbyResult } from "../state/nearby.ts";
import { actions, getScenario, sitePlace, subscribeScenario, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { MISSIONS, SCOUTS_PER_MISSION, playOutcome, pointKey, starsFor, type Outcome, type Stars } from "./game.ts";

const HOUR_MS = 3600000;
const STARS_KEY = "lunaris.game.stars";

export type Phase = "brief" | "pick" | "playing" | "done";
export type AttemptResult = "ok" | "low" | "dead" | "tipped";

export interface Attempt {
  result: AttemptResult;
  /** Day the battery ran out (battery failures). */
  day: number;
  /** Where, as "375 m SW" (the flight log). */
  where: string;
  /** Longest darkness the lander went through, hours. */
  darkH: number;
}

function loadStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STARS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function saveStars(stars: Record<string, number>) {
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(stars));
  } catch {
    // Private window or blocked storage: the stars live for this page only.
  }
}

export interface GameState {
  mission: number;
  phase: Phase;
  outcome: Outcome | null;
  stars: Stars | null;
  landings: number;
  scoutsLeft: number;
  scouted: Set<string>;
  log: Map<string, Attempt>;
  /** Every landing of this mission, oldest first. */
  history: Attempt[];
  bestStars: Record<string, number>;
  grid: TerrainGrid | null;
  current: TerrainPoint | null;
  view: ScenarioView | undefined;
  nearby: NearbyResult | null;
  /** What the stage shows behind the overlay: dimmed after a failure, shaken after a tip-over. */
  stage: "dead" | "tipped" | "won" | null;
  setMission: (index: number) => void;
  start: () => void;
  choose: (point: TerrainPoint) => void;
  scout: () => void;
  land: () => void;
  retry: () => void;
}

/** The landing game's state, shared by the caption panel and the overlay on the stage. */
export function useGame(view: ScenarioView | undefined, sites: SiteInfo[], nearby: NearbyResult | null): GameState {
  const [mission, setMissionIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("brief");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [landings, setLandings] = useState(0);
  const [scouted, setScouted] = useState<Set<string>>(() => new Set());
  const [log, setLog] = useState<Map<string, Attempt>>(() => new Map());
  const [history, setHistory] = useState<Attempt[]>([]);
  const [bestStars, setBestStars] = useState<Record<string, number>>(loadStars);
  const startMs = useScenario((s) => s.startMs);
  const site = sites.find((s) => s.key === MISSIONS[mission].site) ?? null;

  const [loaded, setLoaded] = useState<{ key: string; grid: TerrainGrid } | null>(null);
  const siteKey = site?.key ?? null;
  useEffect(() => {
    if (!siteKey) return;
    let alive = true;
    loadSiteGrid(siteKey).then((grid) => alive && setLoaded({ key: siteKey, grid }));
    return () => {
      alive = false;
    };
  }, [siteKey]);
  const grid = loaded && loaded.key === siteKey ? loaded.grid : null;

  // The grid point the place on the stage stands on.
  const current = useMemo(() => {
    if (!grid || !view) return null;
    let best: TerrainPoint = grid.points[0];
    let bestD = Infinity;
    for (const point of grid.points) {
      const d = Math.hypot(point.lat - view.data.lat, (point.lon - view.data.lon) * Math.cos((point.lat * Math.PI) / 180));
      if (d < bestD) {
        bestD = d;
        best = point;
      }
    }
    return bestD < 1e-3 ? best : null;
  }, [grid, view]);

  const [stars, setStars] = useState<Stars | null>(null);
  // Read by the end of a run, which fires from a store subscription.
  const nearbyRef = useRef(nearby);
  useLayoutEffect(() => {
    nearbyRef.current = nearby;
  });

  /** The run is over: score it and keep the best stars per mission. */
  const finish = (result: Outcome, landingCount: number) => {
    const earned = starsFor(result, landingCount, nearbyRef.current?.scored ?? null);
    setStars(earned);
    setPhase("done");
    const count = earned.earned.filter(Boolean).length;
    const id = MISSIONS[mission].id;
    setBestStars((all) => {
      if ((all[id] ?? 0) >= count) return all;
      const next = { ...all, [id]: count };
      saveStars(next);
      return next;
    });
  };
  const finishRef = useRef(finish);
  useLayoutEffect(() => {
    finishRef.current = finish;
  });

  // Stop the time-lapse when the battery runs out (or the mission is over).
  useEffect(() => {
    if (phase !== "playing" || !outcome) return;
    const stopAt = outcome.survivedH * HOUR_MS;
    let stopped = false;
    return subscribeScenario(() => {
      const s = getScenario();
      if (stopped || s.offsetMs < stopAt) return;
      // Once only: the actions below notify this same listener again.
      stopped = true;
      actions.setPlaying(false);
      actions.setOffsetMs(stopAt);
      finishRef.current(outcome, landings);
    });
  }, [phase, outcome, landings]);

  const reset = () => {
    setPhase("brief");
    setOutcome(null);
    setStars(null);
    setLandings(0);
    setScouted(new Set());
    setLog(new Map());
    setHistory([]);
  };

  const toPick = () => {
    actions.setPlaying(false);
    actions.setOffsetMs(0);
    setOutcome(null);
    setStars(null);
    setPhase("pick");
  };

  return {
    mission,
    phase,
    outcome,
    stars,
    landings,
    scoutsLeft: SCOUTS_PER_MISSION - scouted.size,
    scouted,
    log,
    history,
    bestStars,
    grid,
    current,
    view,
    nearby,
    stage: phase === "done" && outcome ? (outcome.cause === "slope" ? "tipped" : outcome.failed ? "dead" : "won") : null,
    setMission(index) {
      reset();
      actions.setPlaying(false);
      actions.setOffsetMs(0);
      // A new mission sets up its own scene; the same one goes back to the site center.
      if (index === mission && site) actions.selectPlace(sitePlace(site));
      setMissionIndex(index);
    },
    start: toPick,
    choose(point) {
      if (!site || !grid || phase === "playing") return;
      toPick();
      actions.selectPlace(neighbourPlace(sitePlace(site), point, grid));
    },
    scout() {
      if (!current || scouted.has(pointKey(current)) || scouted.size >= SCOUTS_PER_MISSION) return;
      setScouted(new Set(scouted).add(pointKey(current)));
    },
    land() {
      if (!view || !current || phase === "playing") return;
      const result = playOutcome(view.data, startMs, current.slope_deg);
      const count = landings + 1;
      setLandings(count);
      const attempt: Attempt = {
        result: result.cause === "slope" ? "tipped" : result.failed ? "dead" : result.longestDarkH > result.batteryH / 2 ? "low" : "ok",
        day: result.survivedH / 24,
        where: current.east_m === 0 && current.north_m === 0 ? "Site center" : offsetText(current),
        darkH: result.longestDarkH,
      };
      setLog(new Map(log).set(pointKey(current), attempt));
      setHistory([...history, attempt]);
      setOutcome(result);
      actions.setOffsetMs(0);
      if (result.cause === "slope") {
        finish(result, count);
        return;
      }
      actions.setPlaying(true);
      setPhase("playing");
    },
    retry: toPick,
  };
}
