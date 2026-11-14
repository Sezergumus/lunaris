import { Popover } from "radix-ui";
import { Info, SlidersHorizontal } from "lucide-react";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { PROFILE_PRESETS, type ProfileKey } from "../engine/risk.ts";
import { actions, useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { Tip } from "../ui/Tooltip.tsx";
import { LimitsControl } from "./LimitsControl.tsx";
import { MastControl } from "./MastControl.tsx";
import "./panels.css";

const PROFILE_OPTIONS = (Object.keys(PROFILE_PRESETS) as ProfileKey[]).map((key) => ({
  value: key,
  label: PROFILE_PRESETS[key].short,
  ariaLabel: PROFILE_PRESETS[key].label,
}));

/**
 * What the mission is judged against, in one place: the profile, its limits and the mast
 * height. A popover, so it works the same when the site list is collapsed, and the list
 * stays on screen to show every site's risk following the sliders.
 */
export function MissionParameters({ views }: { views: ScenarioView[] }) {
  const profileKey = useScenario((s) => s.profileKey);
  const changed = useScenario((s) => Object.keys(s.limitOverrides).length > 0 || s.mastM !== MAST_RANGE_M.min);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Mission parameters" variant="plain" size="sm" tipSide="bottom" className="params-trigger" data-changed={changed || undefined}>
          <SlidersHorizontal aria-hidden="true" />
          {changed ? <span className="params-trigger__dot" aria-hidden="true" /> : null}
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover popover--params glass glass--thick" side="bottom" align="start" sideOffset={8} collisionPadding={12}>
          <section className="params__profile" aria-label="Mission profile">
            <div className="params__profile-head">
              <h3 className="metric__label">Mission profile</h3>
              <Tip label={PROFILE_PRESETS[profileKey].basis} side="right">
                <Button variant="plain" size="sm" className="btn--icon" aria-label={`Basis of the ${PROFILE_PRESETS[profileKey].label} profile`}>
                  <Info aria-hidden="true" />
                </Button>
              </Tip>
            </div>
            <Segmented value={profileKey} onChange={actions.setProfile} options={PROFILE_OPTIONS} label="Mission profile" size="sm" />
          </section>
          <LimitsControl />
          <MastControl views={views} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
