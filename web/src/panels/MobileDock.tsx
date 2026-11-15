import type { Ref } from "react";
import { ChevronUp, Info, MapPin, SlidersHorizontal, Telescope } from "lucide-react";
import { modeActions } from "../state/mode.ts";
import { parametersChanged, placeTitle, useScenario, type Place } from "../state/scenario.ts";

export type SheetId = "sites" | "params" | "inspector" | "timeline";

interface MobileDockProps {
  ref?: Ref<HTMLElement>;
  placeA: Place | null;
  onOpen: (sheet: SheetId) => void;
}

/**
 * Narrow screens only (index.css): the map takes the whole screen and the panels wait behind
 * these buttons, each opening its own bottom sheet.
 */
export function MobileDock({ ref, placeA, onOpen }: MobileDockProps) {
  const changed = useScenario(parametersChanged);
  return (
    <nav ref={ref} className="dock glass glass--thick" aria-label="Panels">
      <button type="button" className="dock__button dock__button--icon" onClick={() => onOpen("sites")} aria-label="Sites">
        <MapPin aria-hidden="true" />
      </button>
      <button type="button" className="dock__button dock__button--icon params-trigger" onClick={() => onOpen("params")} aria-label="Mission parameters">
        <SlidersHorizontal aria-hidden="true" />
        {changed ? <span className="params-trigger__dot" aria-hidden="true" /> : null}
      </button>
      {placeA ? (
        <button type="button" className="dock__button dock__button--place" onClick={() => onOpen("inspector")} aria-label={`Details of ${placeTitle(placeA)}`}>
          <Info aria-hidden="true" />
          <span className="dock__place">{placeTitle(placeA)}</span>
        </button>
      ) : (
        <span className="dock__hint">Tap the map to pick a point</span>
      )}
      <button type="button" className="dock__button dock__button--icon" onClick={() => modeActions.setMode("explore")} aria-label="Open the Explorer">
        <Telescope aria-hidden="true" />
      </button>
      <button type="button" className="dock__button dock__button--icon" onClick={() => onOpen("timeline")} aria-label="Open the timeline">
        <ChevronUp aria-hidden="true" />
      </button>
    </nav>
  );
}
