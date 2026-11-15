// Loads the surface view on demand (three.js is in its own chunk) and falls back to the
// horizon chart while it loads or when it cannot start. Imports nothing from three.js.
import { Component, Suspense, lazy, type ReactNode } from "react";
import { HorizonView } from "../charts/HorizonView.tsx";
import type { ScenarioView } from "../state/view.ts";

const SurfaceView = lazy(() => import("./SurfaceView.tsx"));

class ChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ChartFallback({ view, note }: { view: ScenarioView; note: string }) {
  return (
    <div className="surface surface--fallback">
      <HorizonView view={view} />
      <p className="surface__note">{note}</p>
    </div>
  );
}

export function SurfaceStage({ view, onClose }: { view: ScenarioView; onClose?: () => void }) {
  return (
    <ChunkBoundary fallback={<ChartFallback view={view} note="The 3D view could not be loaded. The horizon chart shows the same skyline, Sun and Earth." />}>
      <Suspense fallback={<ChartFallback view={view} note="Loading the 3D view…" />}>
        <SurfaceView view={view} onClose={onClose} />
      </Suspense>
    </ChunkBoundary>
  );
}
