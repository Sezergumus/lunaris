import { Rotate3d } from "lucide-react";
import { modeActions } from "../state/mode.ts";
import { placeTitle, type Place } from "../state/scenario.ts";
import { Button } from "../ui/Button.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/**
 * Wide screens: a button over the map, above the timeline, that opens the first-person
 * surface view of scenario A. The same view opens from the horizon chart in the inspector;
 * this one is where the eye already is after picking a place on the map.
 */
export function SurfaceLauncher({ place }: { place: Place }) {
  return (
    <Tip label={`Stand at ${placeTitle(place)} and look around in 3D`} side="top">
      <Button className="surface-launcher" variant="accent" onClick={() => modeActions.setView("surface")}>
        <Rotate3d aria-hidden="true" />
        3D view
      </Button>
    </Tip>
  );
}
