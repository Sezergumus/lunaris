// Loads the surface view on demand (three.js is in its own chunk) and falls back to the
// horizon chart while it loads or when it cannot start. Imports nothing from three.js.
import { Component, Suspense, lazy, type ReactNode } from "react";
import { HorizonView } from "../charts/HorizonView.tsx";
import type { NearbyResult } from "../state/nearby.ts";
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

interface SurfaceStageProps {
  view: ScenarioView;
  onClose?: () => void;
  look?: "sun" | "earth";
  nearby?: NearbyResult | null;
  beacons?: "plan" | "explore";
}

export function SurfaceStage({ view, onClose, look, nearby, beacons }: SurfaceStageProps) {
  return (
    <ChunkBoundary fallback={<ChartFallback view={view} note="The 3D view could not be loaded. The horizon chart shows the same skyline, Sun and Earth." />}>
      <Suspense fallback={<ChartFallback view={view} note="Loading the 3D view…" />}>
        <SurfaceView view={view} onClose={onClose} look={look} nearby={nearby} beacons={beacons} />
      </Suspense>
    </ChunkBoundary>
  );
}
