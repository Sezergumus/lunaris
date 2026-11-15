import { Rotate3d } from "lucide-react";
import { modeActions } from "../state/mode.ts";
import { placeTitle, type Place } from "../state/scenario.ts";
import { Button } from "../ui/Button.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/**
 * Phones: a button at the top of the map that opens the first-person surface view of
 * scenario A while a place is selected. On wide screens the horizon chart in the inspector
 * is the way in; on a phone that chart waits in a closed sheet.
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
