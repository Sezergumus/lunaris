import { getMode, modeActions, useMode, type Mode } from "../state/mode.ts";
import { Segmented } from "../ui/Segmented.tsx";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "plan", label: "Planner" },
  { value: "explore", label: "Explorer" },
];

/**
 * `Planner | Explorer`. The Planner is the map with its panels; the Explorer is one stage for
 * a first-time visitor (introduction, tour, game).
 */
export function ModeSwitch({ size = "sm" }: { size?: "sm" | "md" }) {
  const mode = useMode((m) => m.mode);
  return (
    <Segmented
      label="Mode"
      size={size}
      value={mode}
      options={OPTIONS}
      onChange={(next) => {
        if (next === getMode().mode) return;
        modeActions.setMode(next);
      }}
    />
  );
}
