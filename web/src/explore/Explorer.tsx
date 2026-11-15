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
import { INTRO, LUNAR_DAY_HOURS, TOUR, applyScene } from "./steps.ts";

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
  const tour = step !== null ? TOUR[Math.min(step, TOUR.length - 1)] : null;

  // Every step starts from its own scenario.
  useEffect(() => {
    if (!ready) return;
    applyScene(tour ? tour.scene : INTRO.scene, sites);
  }, [ready, tour, sites]);

  // "500 m matters": scenario B is the best nearby spot, once the grid is scored.
  const result = nearby.state.status === "ready" ? nearby.state.result : null;
  useEffect(() => {
    if (!tour?.nearbySpot || !result || getScenario().placeB) return;
    const origin = getScenario().placeA;
    const best = betterSpot(result) ?? result.best;
    if (origin && best !== result.center) actions.compareWith(neighbourPlace(origin, best.point, result.grid));
  }, [tour, result]);

  // Which scenario stands on the stage; back to A whenever the step changes.
  const [stage, setStage] = useState<{ step: number | null; tag: "A" | "B" }>({ step, tag: "A" });
  const tag = stage.step === step ? stage.tag : "A";
  const [a, b = null] = views;
  const onStage = tag === "B" && b ? b : a;
  const offsetMs = useScenario((s) => s.offsetMs);

  let caption = null;
  if (a) {
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
      </div>
    );
  }

  const controls = tour ? (
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
      <Dots count={TOUR.length} current={step!} />
      <Button size="sm" onClick={() => modeActions.setStep(step! > 0 ? step! - 1 : null)}>
        <ArrowLeft aria-hidden="true" /> Back
      </Button>
      {step! < TOUR.length - 1 ? (
        <Button size="sm" variant="accent" onClick={() => modeActions.setStep(step! + 1)}>
          Next <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
      <Button size="sm" onClick={() => modeActions.setMode("plan")}>
        <MapIcon aria-hidden="true" /> Open in Planner
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
    <ExplorerShell title={onStage ? placeTitle(onStage.data.place) : null} caption={caption} actionsSlot={controls}>
      {onStage ? (
        <SurfaceStage view={onStage} look={tour?.look ?? "sun"} nearby={onStage === a ? result : null} beacons="explore" />
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
