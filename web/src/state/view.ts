import { useMemo } from "react";
import { sampleAt, type Instant } from "../engine/events.ts";
import type { PlaceData } from "./placeData.ts";
import { startOfB, useScenario } from "./scenario.ts";

/** One scenario as the panels show it: a place's data and the start of its window. */
export interface ScenarioView {
  tag: "A" | "B";
  data: PlaceData;
  startMs: number;
}

/** The scenarios on screen: A, and B while comparing. */
export function useViews(a: PlaceData | null, b: PlaceData | null): ScenarioView[] {
  const startMs = useScenario((s) => s.startMs);
  const startB = useScenario(startOfB);
  return useMemo(() => {
    const views: ScenarioView[] = [];
    if (a) views.push({ tag: "A", data: a, startMs });
    if (a && b) views.push({ tag: "B", data: b, startMs: startB });
    return views;
  }, [a, b, startMs, startB]);
}

/** State of a scenario under the timeline cursor. Re-renders the caller while the timeline plays. */
export function useInstant(view: ScenarioView): Instant {
  const offsetMs = useScenario((s) => s.offsetMs);
  return useMemo(() => sampleAt(view.data.series, view.data.sky, view.startMs + offsetMs), [view, offsetMs]);
}
