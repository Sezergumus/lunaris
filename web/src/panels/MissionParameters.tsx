import type { Ref } from "react";
import { Popover } from "radix-ui";
import { Info, SlidersHorizontal } from "lucide-react";
import { PROFILE_PRESETS, type ProfileKey } from "../engine/risk.ts";
import { actions, parametersChanged, useScenario } from "../state/scenario.ts";
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
 * height. Wide screens: a popover, so it works the same when the site list is collapsed, and
 * the list stays on screen to show every site's risk following the sliders. Phones: a bottom
 * sheet opened from the dock (MissionParametersPanel).
 */
interface MissionParametersProps {
  views: ScenarioView[];
}

export function MissionParameters({ views }: MissionParametersProps) {
  const changed = useScenario(parametersChanged);

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
          <ParametersBody views={views} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The phone version: the same settings as the content of a bottom sheet. */
export function MissionParametersPanel({ ref, views }: { ref?: Ref<HTMLElement>; views: ScenarioView[] }) {
  return (
    <section ref={ref} className="params-sheet glass" aria-labelledby="params-sheet-title">
      <h2 id="params-sheet-title" className="params-sheet__title">
        Mission parameters
      </h2>
      <ParametersBody views={views} touch />
    </section>
  );
}

/** Profile, limits and mast. `touch`: the profile's basis is written out, as a tap opens no tooltip. */
function ParametersBody({ views, touch = false }: { views: ScenarioView[]; touch?: boolean }) {
  const profileKey = useScenario((s) => s.profileKey);
  const preset = PROFILE_PRESETS[profileKey];
  return (
    <>
      <section className="params__profile" aria-label="Mission profile">
        <div className="params__profile-head">
          <h3 className="metric__label">Mission profile</h3>
          {touch ? null : (
            <Tip label={preset.basis} side="right">
              <Button variant="plain" size="sm" className="btn--icon" aria-label={`Basis of the ${preset.label} profile`}>
                <Info aria-hidden="true" />
              </Button>
            </Tip>
          )}
        </div>
        <Segmented value={profileKey} onChange={actions.setProfile} options={PROFILE_OPTIONS} label="Mission profile" size={touch ? "md" : "sm"} />
        {touch ? <p className="popover__note">{preset.basis}</p> : null}
      </section>
      <LimitsControl />
      <MastControl views={views} />
    </>
  );
}
