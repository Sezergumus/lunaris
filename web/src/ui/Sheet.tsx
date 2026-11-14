import { useLayoutEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import "./sheet.css";

/** Closed, half the screen, or the whole screen. A `fit` sheet is only ever as tall as its content. */
export type SheetState = "closed" | "half" | "full";

interface SheetProps {
  /** Accessible name, e.g. "Sites". */
  label: string;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** As tall as its content: open or closed, never half or full screen. */
  fit?: boolean;
  children: ReactNode;
}

/** How far ahead a flick carries the sheet, in ms of its release velocity. */
const FLICK_MS = 180;
/** A drag shorter than this is a tap. */
const TAP_PX = 6;
/** Share of a fit sheet's height that a downward pull must pass to close it. */
const FIT_CLOSE = 0.3;

/**
 * A bottom sheet on narrow screens: the handle drags it between closed, half and full screen
 * (a flick counts), a tap on the handle toggles half and full. On wide screens it is
 * `display: contents` (index.css), so the panel inside keeps its docked place in the grid.
 */
export function Sheet({ label, state, onStateChange, fit = false, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; startY: number; base: number; offset: number; lastY: number; lastT: number; velocity: number; moved: boolean } | null>(null);
  // The inline drag position is let go only once the new state is on the element, so the
  // CSS transition runs from where the finger left it to where the state puts it.
  const releasePending = useRef(false);
  // The click that follows a drag must not count as a tap.
  const dragged = useRef(false);

  const release = () => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("transform");
    delete el.dataset.dragging;
    releasePending.current = false;
  };

  useLayoutEffect(() => {
    if (releasePending.current) release();
  }, [state]);

  /** Distance from the sheet's open position, in px, for a state. */
  const offsetFor = (target: SheetState, height: number) => (target === "closed" ? height : target === "half" ? height / 2 : 0);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = offsetFor(state, el.offsetHeight);
    drag.current = { pointer: event.pointerId, startY: event.clientY, base, offset: base, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || event.pointerId !== d.pointer) return;
    const dy = event.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < TAP_PX) return;
    d.moved = true;
    el.dataset.dragging = "true";
    let offset = d.base + dy;
    // Past the top it gives a little, like a rubber band.
    if (offset < 0) offset *= 0.2;
    d.offset = Math.min(offset, el.offsetHeight);
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.velocity = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    el.style.transform = `translateY(${d.offset}px)`;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || event.pointerId !== d.pointer) return;
    dragged.current = d.moved;
    if (!d.moved) return;
    const height = el.offsetHeight;
    const projected = d.offset + d.velocity * FLICK_MS;
    // A fit sheet is "full" when open (its own height); a pull past 30 % of it closes it.
    const options: SheetState[] = ["full", "half", "closed"];
    const next: SheetState = fit
      ? projected > height * FIT_CLOSE
        ? "closed"
        : "full"
      : options.reduce((best, option) => (Math.abs(offsetFor(option, height) - projected) < Math.abs(offsetFor(best, height) - projected) ? option : best));
    if (next === state) release();
    else {
      releasePending.current = true;
      onStateChange(next);
    }
  };

  const onHandleClick = () => {
    if (fit) onStateChange("closed");
    else onStateChange(state === "full" ? "half" : "full");
  };

  return (
    <div ref={ref} className="sheet" data-state={state} data-fit={fit || undefined} aria-label={label} role="region">
      <div className="sheet__bar">
        <button
          type="button"
          className="sheet__handle"
          aria-label={fit ? `Close ${label.toLowerCase()}` : state === "full" ? `Shrink ${label.toLowerCase()}` : `Expand ${label.toLowerCase()}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else onHandleClick();
          }}
        >
          {fit ? <ChevronDown aria-hidden="true" /> : <span className="sheet__grabber" aria-hidden="true" />}
        </button>
        {fit ? null : (
          <button type="button" className="sheet__close" aria-label={`Close ${label.toLowerCase()}`} onClick={() => onStateChange("closed")}>
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
