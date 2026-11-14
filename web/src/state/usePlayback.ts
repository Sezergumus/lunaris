import { useEffect } from "react";
import { actions, getScenario, useScenario } from "./scenario.ts";

const HOUR_MS = 3600000;
/** With reduced motion the cursor moves in a few steps per second instead of every frame. */
const REDUCED_STEP_MS = 400;

/**
 * Advances the timeline cursor while `playing` is set. Mount once.
 * Simulated time is continuous (the panels interpolate between hourly samples); the loop
 * stops at the end of the window.
 */
export function usePlayback() {
  const playing = useScenario((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    let pending = 0;

    const tick = (now: number) => {
      // A background tab pauses requestAnimationFrame; do not jump ahead when it returns.
      const elapsed = Math.min(100, now - last);
      last = now;
      pending += elapsed;
      if (!reduced || pending >= REDUCED_STEP_MS) {
        const s = getScenario();
        const next = s.offsetMs + (pending / 1000) * s.speed * HOUR_MS;
        pending = 0;
        if (next >= s.windowHours * HOUR_MS) {
          actions.setOffsetMs(s.windowHours * HOUR_MS);
          actions.setPlaying(false);
          return;
        }
        actions.setOffsetMs(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
