import { MAST_RANGE_M } from "../engine/mast.ts";
import { actions, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Slider } from "../ui/Slider.tsx";

/**
 * Height of the solar panel / antenna above ground. Moving it changes the horizon, and with
 * it the horizon view, the metric cards, the strips and the risk, as the thumb moves.
 */
export function MastControl({ views }: { views: ScenarioView[] }) {
  const mastM = useScenario((s) => s.mastM);
  const modes = views.map((view) => view.data.mast.mode);
  // Places without obstruction distances (custom points, the reference) cannot be adjusted.
  const adjustable = modes.some((mode) => mode !== "fixed");
  const estimated = modes.includes("estimate");

  return (
    <section className="mast" aria-label="Mast height">
      <div className="mast__head">
        <h3 className="metric__label">
          Mast height<span className="metric__hint"> · solar panel and antenna above ground</span>
        </h3>
        <output className="mast__value">{mastM} m</output>
      </div>
      <Slider
        label="Mast height in meters"
        valueText={`${mastM} meters`}
        min={MAST_RANGE_M.min}
        max={MAST_RANGE_M.max}
        step={1}
        value={mastM}
        onChange={actions.setMast}
        disabled={!adjustable}
      />
      <p className="mast__note" data-tone={estimated ? "estimate" : undefined}>
        {!adjustable
          ? "Needs the terrain horizon and its obstruction distances; not available for this place."
          : estimated
            ? "Estimate, leans optimistic · exact values need the terrain service"
            : modes.includes("exact")
              ? "Horizon recomputed by the terrain service."
              : `Precomputed horizon at ${MAST_RANGE_M.min} m. Raise the mast to see over nearby terrain.`}
      </p>
    </section>
  );
}
