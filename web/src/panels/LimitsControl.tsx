import { useState } from "react";
import { LIMITS, effectiveProfile, type LimitKey } from "../state/limits.ts";
import { actions, useScenario } from "../state/scenario.ts";
import { Button } from "../ui/Button.tsx";
import { Slider } from "../ui/Slider.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/**
 * The limits the risk score is judged against, one slider each. A mission profile sets
 * them; moving a slider overrides that value. While the thumb is dragged only its own value
 * follows (a draft); the risk badge, the landing-date strip and the comparison are
 * recomputed once it is let go, since each recomputation scans every landing date.
 */
export function LimitsControl() {
  const profileKey = useScenario((s) => s.profileKey);
  const overrides = useScenario((s) => s.limitOverrides);
  const profile = effectiveProfile(profileKey, overrides);
  const edited = Object.keys(overrides).length > 0;
  // `base` is the stored value when the drag began. Radix reports no commit when the thumb
  // ends where it started, so a draft can outlive its drag; it is shown only while the stored
  // value is still its base (and then equals it), never over a later profile or reset.
  const [draft, setDraft] = useState<{ key: LimitKey; value: number; base: number } | null>(null);

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
        const stored = profile[limit.key];
        const value = draft?.key === limit.key && draft.base === stored ? draft.value : stored;
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
              onChange={(next) => setDraft({ key: limit.key, value: next, base: stored })}
              onCommit={(next) => {
                setDraft(null);
                actions.setLimit(limit.key, next);
              }}
            />
          </div>
        );
      })}
    </section>
  );
}
