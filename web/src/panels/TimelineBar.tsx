import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Slider as RadixSlider } from "radix-ui";
import { Pause, Play, X } from "lucide-react";
import { GanttStrips, type StripSet } from "../charts/GanttStrips.tsx";
import { STRIP_ROWS } from "../charts/stripRows.ts";
import { sampleAt } from "../engine/events.ts";
import { sampleIndex } from "../engine/sky.ts";
import type { PlaceData } from "../state/placeData.ts";
import { SPEEDS, WINDOW_DAYS, actions, placeTitle, startOfB, useScenario } from "../state/scenario.ts";
import { usePlayback } from "../state/usePlayback.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { DatePicker } from "../ui/DatePicker.tsx";
import { InlineNumberField } from "../ui/NumberField.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { formatDays, formatPercent, formatUtcDate, formatUtcDateTime, formatUtcDay, formatUtcDayTime, parseDecimal } from "../ui/format.ts";
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
        {/* Remounted when the length changes elsewhere (URL, preset), so the field shows it. */}
        <MissionLength key={windowHours} windowHours={windowHours} />
        <SlipControl disabled={!ready} />
        {b ? (
          <div className="compare-chip">
            <span className="tag tag--b">B</span>
            <span className="compare-chip__text">
              {placeTitle(b.place)}
              {slipDays !== 0 ? ` · ${formatUtcDate(startB)} (${slipDays > 0 ? "+" : "−"}${Math.abs(slipDays)} d)` : ""}
            </span>
            <IconButton label="Clear comparison" variant="plain" size="sm" onClick={actions.clearComparison}>
              <X aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
        {macroExtra}
      </div>

      <div className="timeline__micro">
        {/* Wide screens read the playhead time here, in the space under the transport. */}
        <div className="timeline__side">
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
          {ready ? <CursorReadout place="side" sets={sets} startMs={startMs} startB={startB} /> : null}
        </div>

        {ready ? (
          <Track
            sets={sets}
            hours={windowHours}
            startMs={startMs}
            dated={slipDays === 0}
            foot={
              <>
                <CursorReadout place="foot" sets={sets} startMs={startMs} startB={startB} />
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

/** Mission length in days, typed (14 by default). Sets the timeline window too. */
function MissionLength({ windowHours }: { windowHours: number }) {
  const [text, setText] = useState(formatDays(windowHours / 24));
  const days = parseDecimal(text);
  const valid = days >= WINDOW_DAYS.min && days <= WINDOW_DAYS.max;
  const commit = () => {
    if (valid) actions.setWindowHours(Math.round(days * 24));
    else setText(formatDays(windowHours / 24));
  };
  return (
    <div className="timeline__group">
      <span className="timeline__caption">Mission</span>
      <InlineNumberField
        label={`Mission length in days, ${WINDOW_DAYS.min} to ${WINDOW_DAYS.max}`}
        value={text}
        onChange={setText}
        onCommit={commit}
        commitOnBlur
        suffix="d"
        invalid={!valid}
        chars={4}
      />
    </div>
  );
}

/** Largest slip the field accepts; the store also keeps B inside the data. */
const MAX_SLIP_DAYS = 365;

/** "The mission slipped by N days": opens scenario B at A's date + N days (set, not added). */
function SlipControl({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("7");
  const days = parseDecimal(text);
  const valid = Number.isInteger(days) && days >= 1 && days <= MAX_SLIP_DAYS;
  const commit = () => {
    if (valid && !disabled) actions.slip(days);
  };
  return (
    <div className="timeline__group">
      {/* Phones lay the macro row out as labelled rows; this label is shown there only. */}
      <span className="timeline__caption timeline__caption--narrow">Slip</span>
      <span className="timeline__controls">
        <InlineNumberField
          label={`Slip in days, 1 to ${MAX_SLIP_DAYS}`}
          value={text}
          onChange={setText}
          onCommit={commit}
          prefix="+"
          suffix="d"
          invalid={!valid}
          chars={3}
          disabled={disabled}
        />
        <Button onClick={commit} disabled={disabled || !valid}>
          <span className="timeline__wide-only">Slip</span>
          <span className="timeline__narrow-only">Compare</span>
        </Button>
      </span>
    </div>
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
      <span
        key={day}
        className="axis__tick"
        data-major={labelled || undefined}
        // Every other label is dropped where the plot is narrow (phones, timeline.css).
        data-minor-label={(labelled && day % (every * 2) !== 0) || undefined}
        style={{ left: `${((day * 24) / hours) * 100}%` }}
      >
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
                <b className="track__tag--a">A</b>
                <b className="track__tag--b">B</b>
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

/**
 * Date and time under the playhead; the only text that changes on every frame. When B starts
 * on another day both times are tagged, without the year (the landing field shows it).
 * Rendered twice: under the transport on wide screens ("side", stacked), under the strips on
 * phones ("foot", one row); timeline.css shows one of them.
 */
function CursorReadout({ place, sets, startMs, startB }: { place: "side" | "foot"; sets: StripSet[]; startMs: number; startB: number }) {
  const offsetMs = useScenario((s) => s.offsetMs);
  const days = offsetMs / DAY_MS;
  const split = sets.length > 1 && startB !== startMs;
  return (
    <p className={`timeline__readout timeline__readout--${place}`}>
      <span className="timeline__readout-day">Day {days.toFixed(1)}</span>
      {split ? (
        <>
          <span>
            <span className="tag tag--a">A</span> {formatUtcDayTime(startMs + offsetMs)}
          </span>
          <span>
            <span className="tag tag--b">B</span> {formatUtcDayTime(startB + offsetMs)}
          </span>
        </>
      ) : (
        <span>{formatUtcDateTime(startMs + offsetMs)}</span>
      )}
    </p>
  );
}
