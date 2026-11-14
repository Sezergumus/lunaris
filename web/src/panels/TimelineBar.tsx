import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Slider as RadixSlider } from "radix-ui";
import { Pause, Play, X } from "lucide-react";
import { GanttStrips, type StripSet } from "../charts/GanttStrips.tsx";
import { STRIP_ROWS } from "../charts/stripRows.ts";
import { sampleAt } from "../engine/events.ts";
import { sampleIndex } from "../engine/sky.ts";
import type { PlaceData } from "../state/placeData.ts";
import { SPEEDS, WINDOW_HOURS, actions, placeTitle, startOfB, useScenario } from "../state/scenario.ts";
import { usePlayback } from "../state/usePlayback.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { DatePicker } from "../ui/DatePicker.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { formatPercent, formatUtcDate, formatUtcDateTime, formatUtcDay } from "../ui/format.ts";
import "./timeline.css";

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const SPEED_LABEL: Record<number, string> = { 6: "6 h/s", 24: "24 h/s", 72: "3 d/s" };
const LINK_BLOCK_TEXT = { terrain: "Earth below the horizon", station: "no ground station in view", conjunction: "Sun too close to the Earth" };

interface TimelineBarProps {
  ref?: Ref<HTMLElement>;
  a: PlaceData | null;
  b: PlaceData | null;
  /** Extra content of the macro row (the landing-date risk strip). */
  macroExtra?: ReactNode;
  /** One line under the strips while two scenarios are compared. */
  summary?: ReactNode;
}

export function TimelineBar({ ref, a, b, macroExtra, summary }: TimelineBarProps) {
  usePlayback();
  const limits = useScenario((s) => s.limits);
  const startMs = useScenario((s) => s.startMs);
  const startB = useScenario(startOfB);
  const slipDays = useScenario((s) => s.slipDays);
  const windowHours = useScenario((s) => s.windowHours);
  const playing = useScenario((s) => s.playing);
  const speed = useScenario((s) => s.speed);

  const sets = useMemo(() => {
    const list: StripSet[] = [];
    if (a) list.push({ tag: "A", data: a, first: sampleIndex(a.series, startMs) });
    if (a && b) list.push({ tag: "B", data: b, first: sampleIndex(b.series, startB) });
    return list;
  }, [a, b, startMs, startB]);

  // Space starts and stops playback unless a control that uses the key has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== " " || target.closest("input, button, [role='slider'], [role='radio'], [role='dialog']")) return;
      event.preventDefault();
      if (sets.length > 0) actions.setPlaying(!playing);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, sets.length]);

  if (!limits) {
    return (
      <section ref={ref} className="timeline glass glass--thick" aria-label="Timeline">
        <p className="timeline__empty">Loading Sun and Earth positions…</p>
      </section>
    );
  }

  const ready = sets.length > 0;
  // The last selectable day still leaves room for the whole window.
  const lastStart = limits.maxMs - windowHours * HOUR_MS;

  return (
    <section ref={ref} className="timeline glass glass--thick" aria-label="Timeline">
      <div className="timeline__macro">
        <div className="timeline__group">
          <span className="timeline__caption">Landing</span>
          <DatePicker label="Landing date" valueMs={startMs} minMs={limits.minMs} maxMs={lastStart} onChange={actions.setStart} />
        </div>
        <Segmented
          label="Window length"
          value={String(windowHours)}
          onChange={(value) => actions.setWindowHours(Number(value))}
          options={[
            { value: String(WINDOW_HOURS.mission), label: "14 d" },
            { value: String(WINDOW_HOURS.lunarDay), label: "1 lunar day · 708 h" },
          ]}
        />
        <div className="timeline__group">
          <Button onClick={() => actions.slip(7)} disabled={!ready}>
            Slip +7 d
          </Button>
          <Button onClick={() => actions.slip(14)} disabled={!ready}>
            Slip +14 d
          </Button>
        </div>
        {b ? (
          <div className="compare-chip">
            <span className="tag tag--b">B</span>
            <span className="compare-chip__text">
              {placeTitle(b.place)}
              {slipDays > 0 ? ` · ${formatUtcDate(startB)} (+${slipDays} d)` : ""}
            </span>
            <IconButton label="Clear comparison" variant="plain" size="sm" onClick={actions.clearComparison}>
              <X aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
        {macroExtra}
      </div>

      <div className="timeline__micro">
        <div className="timeline__transport">
          <IconButton
            label={playing ? "Pause" : "Play"}
            variant="accent"
            disabled={!ready}
            onClick={() => actions.setPlaying(!playing)}
            // Feedback on press, not on release.
            data-playing={playing}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </IconButton>
          <Segmented
            label="Playback speed, simulated time per second"
            size="sm"
            value={String(speed)}
            onChange={(value) => actions.setSpeed(Number(value))}
            options={SPEEDS.map((value) => ({ value: String(value), label: SPEED_LABEL[value] }))}
          />
        </div>

        {ready ? (
          <Track
            sets={sets}
            hours={windowHours}
            startMs={startMs}
            dated={slipDays === 0}
            foot={
              <>
                <CursorReadout sets={sets} startMs={startMs} startB={startB} />
                {summary}
              </>
            }
          />
        ) : (
          <p className="timeline__empty">Select a site to see its Sun and Earth windows.</p>
        )}
      </div>
    </section>
  );
}

/** Day ticks under the strips: dates for one start date, day numbers when A and B differ. */
function Axis({ hours, startMs, dated }: { hours: number; startMs: number; dated: boolean }) {
  const days = Math.floor(hours / 24);
  const every = days > 20 ? 5 : 2;
  const ticks = [];
  for (let day = 0; day <= days; day++) {
    const labelled = day % every === 0 && (day + every * 0.4) * 24 <= hours;
    ticks.push(
      <span key={day} className="axis__tick" data-major={labelled || undefined} style={{ left: `${((day * 24) / hours) * 100}%` }}>
        {labelled ? <span className="axis__label">{dated ? formatUtcDay(startMs + day * DAY_MS) : `Day ${day}`}</span> : null}
      </span>,
    );
  }
  return (
    <div className="axis" aria-hidden="true">
      {ticks}
    </div>
  );
}

function stateText(set: StripSet, offsetHours: number): { sun: string; link: string } {
  const { data, first } = set;
  const at = sampleAt(data.series, data.sky, data.series.startMs + (first + offsetHours) * data.series.stepHours * HOUR_MS);
  const usable = at.solarFraction >= data.series.profile.min_solar_fraction;
  return {
    sun: at.solarFraction <= 0 ? "dark" : usable ? `lit · ${formatPercent(at.solarFraction * 100)} of the disk` : `partial · ${formatPercent(at.solarFraction * 100)} of the disk`,
    link: at.linkBlock ? `blocked · ${LINK_BLOCK_TEXT[at.linkBlock]}` : "up",
  };
}

interface TrackProps {
  sets: StripSet[];
  hours: number;
  startMs: number;
  dated: boolean;
  /** Shown under the plot, aligned with it. */
  foot: ReactNode;
}

/** Strips, day axis and the scrubber on top of them. The whole plot is the drag area. */
function Track({ sets, hours, startMs, dated, foot }: TrackProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ hour: number; x: number } | null>(null);

  const onMove = (event: React.PointerEvent) => {
    const box = plotRef.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover({ hour: Math.round(fraction * hours), x: fraction * box.width });
  };

  return (
    <div className="track" data-compare={sets.length > 1 || undefined}>
      <div className="track__labels" aria-hidden="true">
        {STRIP_ROWS.map((row) => (
          <span key={row.id} className="track__label">
            <i className={`swatch swatch--${row.id}`} />
            {row.label}
            {sets.length > 1 ? (
              <span className="track__tags">
                <b>A</b>
                <b>B</b>
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div ref={plotRef} className="track__plot" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <GanttStrips sets={sets} hours={hours} />
        <Axis hours={hours} startMs={startMs} dated={dated} />
        <Scrubber hours={hours} />
        {hover ? (
          <div className="track__hover" style={{ transform: `translateX(${hover.x}px)` }} aria-hidden="true">
            <div className="track__hover-card" data-side={hover.x > 260 ? "left" : "right"}>
              {sets.map((set) => {
                const text = stateText(set, hover.hour);
                return (
                  <div key={set.tag} className="track__hover-set">
                    <p className="track__hover-time">
                      {sets.length > 1 ? <span className={`tag tag--${set.tag.toLowerCase()}`}>{set.tag}</span> : null}
                      {formatUtcDateTime(set.data.series.startMs + (set.first + hover.hour) * HOUR_MS)}
                    </p>
                    <p>
                      <i className="swatch swatch--sun" />
                      <b>{text.sun}</b>
                    </p>
                    <p>
                      <i className="swatch swatch--link" />
                      <b>{text.link}</b>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      <div className="track__foot">{foot}</div>
    </div>
  );
}

/** The playhead: a Radix slider whose thumb is a line across all strips. Hourly steps. */
function Scrubber({ hours }: { hours: number }) {
  const offsetMs = useScenario((s) => s.offsetMs);
  const value = offsetMs / HOUR_MS;
  const day = Math.floor(value / 24);
  return (
    <RadixSlider.Root
      className="scrub"
      min={0}
      max={hours}
      step={1}
      value={[value]}
      onValueChange={([next]) => {
        // Grabbing the playhead takes over from playback at once.
        actions.setPlaying(false);
        actions.setOffsetMs(next * HOUR_MS);
      }}
    >
      <RadixSlider.Track className="scrub__track" />
      <RadixSlider.Thumb className="scrub__thumb" aria-label="Time in the window" aria-valuetext={`Day ${day}, hour ${Math.floor(value % 24)}`} />
    </RadixSlider.Root>
  );
}

/** Date and time under the playhead; the only text that changes on every frame. */
function CursorReadout({ sets, startMs, startB }: { sets: StripSet[]; startMs: number; startB: number }) {
  const offsetMs = useScenario((s) => s.offsetMs);
  const days = offsetMs / DAY_MS;
  return (
    <p className="timeline__readout">
      <span className="timeline__readout-day">Day {days.toFixed(1)}</span>
      <span>{formatUtcDateTime(startMs + offsetMs)}</span>
      {sets.length > 1 && startB !== startMs ? (
        <span>
          <span className="tag tag--b">B</span> {formatUtcDateTime(startB + offsetMs)}
        </span>
      ) : null}
    </p>
  );
}
