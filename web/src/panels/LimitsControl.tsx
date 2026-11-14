import { LIMITS, effectiveProfile } from "../state/limits.ts";
import { actions, useScenario } from "../state/scenario.ts";
import { Button } from "../ui/Button.tsx";
import { Slider } from "../ui/Slider.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/**
 * The limits the risk score is judged against, one slider each. A mission profile sets
 * them; moving a slider overrides that value, and the risk badge, the landing-date strip
 * and the comparison follow as the thumb moves.
 */
export function LimitsControl() {
  const profileKey = useScenario((s) => s.profileKey);
  const overrides = useScenario((s) => s.limitOverrides);
  const profile = effectiveProfile(profileKey, overrides);
  const edited = Object.keys(overrides).length > 0;

  return (
    <section className="limits" aria-label="Mission limits">
      <div className="limits__head">
        <h3 className="metric__label">Mission limits</h3>
        {edited ? (
          <Button variant="plain" size="sm" onClick={actions.resetLimits}>
            Reset
          </Button>
        ) : null}
      </div>
      {LIMITS.map((limit) => {
        const value = profile[limit.key];
        return (
          <div key={limit.key} className="limits__row" data-edited={overrides[limit.key] !== undefined || undefined}>
            <Tip label={limit.hint} side="left">
              <p className="limits__label">
                <span className="limits__category">{limit.category}</span>
                {limit.label}
              </p>
            </Tip>
            <output className="limits__value">
              {value}
              {limit.unit === "°" ? "°" : ` ${limit.unit}`}
            </output>
            <Slider
              label={`${limit.label}, ${limit.hint}`}
              valueText={`${value} ${limit.unit}`}
              min={limit.min}
              max={limit.max}
              step={limit.step}
              value={Math.min(limit.max, Math.max(limit.min, value))}
              onChange={(next) => actions.setLimit(limit.key, next)}
            />
          </div>
        );
      })}
    </section>
  );
}
