import { useState } from "react";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { actions, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Slider } from "../ui/Slider.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/** Why the mast cannot be moved for the places on screen. */
function fixedReason(views: ScenarioView[]): string {
  const data = views[0]?.data;
  if (!data || !data.terrain) return "Not adjustable: no terrain for this place (sphere model).";
  return "Not adjustable: the distances to the skyline are not known for this point.";
}

/**
 * Height of the solar panel / antenna above ground. Moving it changes the horizon, and with
 * it the horizon view, the metric cards, the strips and the risk. While the thumb is dragged
 * only the value beside it follows; the rest is recomputed once it is let go.
 */
export function MastControl({ views }: { views: ScenarioView[] }) {
  const savedM = useScenario((s) => s.mastM);
  // As in LimitsControl: the draft counts only while the stored height is still its base.
  const [draft, setDraft] = useState<{ value: number; base: number } | null>(null);
  const mastM = draft && draft.base === savedM ? draft.value : savedM;
  const modes = views.map((view) => view.data.mast.mode);
  // Places without obstruction distances (custom points, the reference) cannot be adjusted.
  // With no place selected the value is still set; it applies to the next one.
  const adjustable = views.length === 0 || modes.some((mode) => mode !== "fixed");
  const estimated = modes.includes("estimate");

  return (
    <section className="mast" aria-label="Mast height">
      <div className="mast__head">
        <Tip label="Solar panel and antenna above ground" side="left">
          <h3 className="metric__label">Mast height</h3>
        </Tip>
        <output className="mast__value">{mastM} m</output>
      </div>
      <Slider
        label="Mast height in meters"
        valueText={`${mastM} meters`}
        min={MAST_RANGE_M.min}
        max={MAST_RANGE_M.max}
        step={1}
        value={mastM}
        onChange={(next) => setDraft({ value: next, base: savedM })}
        onCommit={(next) => {
          setDraft(null);
          actions.setMast(next);
        }}
        disabled={!adjustable}
      />
      <p className="mast__note" data-tone={estimated ? "estimate" : undefined}>
        {views.length === 0
          ? "Applies to the place you select."
          : !adjustable
            ? fixedReason(views)
            : estimated
              ? "Estimate, leans optimistic."
              : modes.includes("exact")
                ? "Recomputed from terrain."
                : `Precomputed at ${MAST_RANGE_M.min} m.`}
      </p>
    </section>
  );
}
