import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Map as MapIcon } from "lucide-react";
import type { SiteInfo } from "../data/load.ts";
import { betterSpot, neighbourPlace, type Nearby } from "../state/nearby.ts";
import { modeActions, useMode } from "../state/mode.ts";
import { actions, getScenario, placeTitle, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { SurfaceStage } from "../surface/SurfaceStage.tsx";
import { Button } from "../ui/Button.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { ExplorerShell } from "./ExplorerShell.tsx";
import { SunPathInset } from "./SunPathInset.tsx";
import { GamePanel, GameStage } from "./Game.tsx";
import { useGame } from "./useGame.ts";
import { MISSIONS, missionScene } from "./game.ts";
import { LiveCards } from "./LiveCards.tsx";
import { INTRO, LUNAR_DAY_HOURS, TOUR, applyScene } from "./steps.ts";
import { useMediaQuery } from "../ui/useMediaQuery.ts";

interface ExplorerProps {
  views: ScenarioView[];
  sites: SiteInfo[];
  /** Scored grid around scenario A (the "500 m" step takes its best point). */
  nearby: Nearby;
}

/**
 * The Explorer: an introduction ("Stand on the Moon") and a guided tour. Each step sets up its
 * own scenario, plays it, and puts one place on the stage; a comparison can switch the stage
 * between A and B.
 */
export function Explorer({ views, sites, nearby }: ExplorerProps) {
  const step = useMode((m) => m.step);
  const ready = useScenario((s) => s.limits !== null) && sites.length > 0;
  // Steps 0..n-1 are the tour, step n is the landing game.
  const game = step !== null && step >= TOUR.length;
  const tour = step !== null && !game ? TOUR[step] : null;

  const result = nearby.state.status === "ready" ? nearby.state.result : null;
  const [a, b = null] = views;
  const play = useGame(a, sites, result);
  const compact = useMediaQuery("(max-width: 759px)");

  // Every step (and every mission of the game) starts from its own scenario.
  const mission = game ? play.mission : null;
  useEffect(() => {
    if (!ready) return;
    applyScene(mission !== null ? missionScene(MISSIONS[mission]) : tour ? tour.scene : INTRO.scene, sites);
  }, [ready, tour, mission, sites]);

  // "500 m matters": scenario B is the best nearby spot, once the grid is scored.
  useEffect(() => {
    if (!tour?.nearbySpot || !result || getScenario().placeB) return;
    const origin = getScenario().placeA;
    const best = betterSpot(result) ?? result.best;
    if (origin && best !== result.center) actions.compareWith(neighbourPlace(origin, best.point, result.grid));
  }, [tour, result]);

  // Which scenario stands on the stage; back to A whenever the step changes.
  const [stage, setStage] = useState<{ step: number | null; tag: "A" | "B" }>({ step, tag: "A" });
  const tag = stage.step === step ? stage.tag : "A";
  const onStage = tag === "B" && b ? b : a;
  const offsetMs = useScenario((s) => s.offsetMs);

  let caption = null;
  if (game) {
    caption = <GamePanel game={play} compact={compact} />;
  } else if (a) {
    const words = tour ? tour.caption(a, b) : INTRO.caption(a, b, offsetMs / 3600000);
    const inset = (tour?.inset || !tour) && b ? <SunPathInset pole={a} equator={b} hours={tour ? tour.scene.windowHours : LUNAR_DAY_HOURS} /> : null;
    caption = (
      <div className="explorer__story">
        <div className="explorer__words">
          {tour ? <p className="explorer__step-title">{tour.title}</p> : null}
          <p>{words.lead}</p>
          {words.detail ? <p>{words.detail}</p> : null}
        </div>
        {inset}
        <LiveCards view={onStage ?? a} />
      </div>
    );
  }

  const controls = game ? (
    <>
      <Dots count={TOUR.length + 1} current={step!} />
      <Button size="sm" onClick={() => modeActions.setStep(TOUR.length - 1)}>
        <ArrowLeft aria-hidden="true" /> Back to the tour
      </Button>
    </>
  ) : tour ? (
    <>
      {b ? (
        <Segmented
          label="Place on the stage"
          size="sm"
          value={tag}
          onChange={(next) => setStage({ step, tag: next })}
          options={[
            { value: "A", label: `A · ${short(a?.data.place)}` },
            { value: "B", label: `B · ${b.data.place.id === a?.data.place.id ? "a week later" : short(b.data.place)}` },
          ]}
        />
      ) : null}
      <Dots count={TOUR.length + 1} current={step!} />
      <Button size="sm" className="explorer__back" onClick={() => modeActions.setStep(step! > 0 ? step! - 1 : null)}>
        <ArrowLeft aria-hidden="true" /> Back
      </Button>
      <Button size="sm" variant="accent" className="explorer__next" onClick={() => modeActions.setStep(step! + 1)}>
        {step! < TOUR.length - 1 ? "Next" : "Play: keep a lander alive"} <ArrowRight aria-hidden="true" />
      </Button>
      {/* Phones: the map icon alone, so Back, the dots, this and Next share one row. */}
      <Button size="sm" className="explorer__planner" aria-label="Open in Planner" onClick={() => modeActions.setMode("plan")}>
        <MapIcon aria-hidden="true" /> <span className="explorer__planner-text">Open in Planner</span>
      </Button>
    </>
  ) : (
    <>
      <Button size="sm" variant="accent" onClick={() => modeActions.setStep(0)}>
        Start the tour <ArrowRight aria-hidden="true" />
      </Button>
      <Button size="sm" onClick={() => modeActions.setMode("plan")}>
        Skip to Planner
      </Button>
    </>
  );

  return (
    <ExplorerShell
      title={onStage ? placeTitle(onStage.data.place) : null}
      caption={caption}
      actionsSlot={controls}
      overlay={game ? <GameStage game={play} compact={compact} /> : null}
      stageState={game ? (play.stage ?? play.phase) : null}
    >
      {onStage ? (
        // No beacons in the game: the best spot would give the answer away.
        <SurfaceStage view={onStage} look={tour?.look ?? "sun"} nearby={onStage === a && !game ? result : null} mode="explore" />
      ) : (
        <p className="explorer__empty">Loading the Moon…</p>
      )}
    </ExplorerShell>
  );
}

function short(place: ScenarioView["data"]["place"] | undefined): string {
  if (!place) return "";
  const title = placeTitle(place);
  return title.length > 22 ? `${title.slice(0, 21)}…` : title;
}

function Dots({ count, current }: { count: number; current: number }) {
  return (
    <span className="explorer__dots" role="img" aria-label={`Step ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="explorer__dot" data-current={i === current || undefined} />
      ))}
    </span>
  );
}
