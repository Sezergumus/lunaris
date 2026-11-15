import type { ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { ModeSwitch } from "../panels/ModeSwitch.tsx";
import { actions, useScenario } from "../state/scenario.ts";
import { IconButton } from "../ui/Button.tsx";
import { formatUtcDateTime } from "../ui/format.ts";
import "./explore.css";

const HOUR_MS = 3600000;

interface ExplorerShellProps {
  /** Name of the place on the stage, shown in the header. */
  title: string | null;
  /** The stage: the surface view, or its fallback. */
  children: ReactNode;
  /** Text under the stage (tour step, introduction caption). */
  caption?: ReactNode;
  /** Extra controls at the right end of the transport (tour navigation). */
  actionsSlot?: ReactNode;
  /** Cards drawn over the stage (the landing game). */
  overlay?: ReactNode;
  /** State of the stage for its styling (the game dims it after a failure). */
  stageState?: string | null;
}

/**
 * The Explorer's frame: the Planner panels step aside for one stage, a caption area and a
 * transport (play, pause, restart) for the scenario's time window.
 */
export function ExplorerShell({
  title,
  children,
  caption,
  actionsSlot,
  overlay,
  stageState,
}: ExplorerShellProps) {
  return (
    <div className="explorer" role="region" aria-label="Explorer">
      <header className="explorer__header glass glass--thick">
        <div className="explorer__brand">
          <span className="explorer__name">Lunaris</span>
          {title ? <span className="explorer__place">{title}</span> : null}
        </div>
        <ModeSwitch />
      </header>
      <div className="explorer__stage" data-game={stageState ?? undefined}>
        {children}
        {overlay}
      </div>
      <footer className="explorer__bottom glass glass--thick">
        {caption ? (
          <div className="explorer__caption" aria-live="polite">
            {caption}
          </div>
        ) : null}
        <Transport>{actionsSlot}</Transport>
      </footer>
    </div>
  );
}

/** Play / pause / restart and where the cursor is, for the scenario on the stage. */
function Transport({ children }: { children?: ReactNode }) {
  const playing = useScenario((s) => s.playing);
  const offsetMs = useScenario((s) => s.offsetMs);
  const startMs = useScenario((s) => s.startMs);
  const windowHours = useScenario((s) => s.windowHours);
  const ready = useScenario((s) => s.limits !== null && s.placeA !== null);
  const day = offsetMs / (24 * HOUR_MS);
  return (
    <div className="explorer__transport">
      <IconButton
        label={playing ? "Pause" : "Play"}
        variant="accent"
        disabled={!ready}
        onClick={() => actions.setPlaying(!playing)}
      >
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </IconButton>
      <IconButton
        label="Restart"
        disabled={!ready}
        onClick={() => {
          actions.setOffsetMs(0);
          actions.setPlaying(true);
        }}
      >
        <RotateCcw aria-hidden="true" />
      </IconButton>
      <div className="explorer__clock">
        <span className="explorer__day">
          Day {day.toFixed(1)} of{" "}
          {Number.isInteger(windowHours / 24)
            ? windowHours / 24
            : (windowHours / 24).toFixed(1)}
        </span>
        <span className="explorer__utc">
          {formatUtcDateTime(startMs + offsetMs)}
        </span>
      </div>
      <div className="explorer__progress" aria-hidden="true">
        <div
          className="explorer__progress-fill"
          style={{
            width: `${Math.min(100, (offsetMs / (windowHours * HOUR_MS)) * 100)}%`,
          }}
        />
      </div>
      {children ? <div className="explorer__actions">{children}</div> : null}
    </div>
  );
}
