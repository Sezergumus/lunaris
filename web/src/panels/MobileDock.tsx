import type { Ref } from "react";
import { ChevronUp, Info, List } from "lucide-react";
import { placeTitle, type Place } from "../state/scenario.ts";

export type SheetId = "sites" | "inspector" | "timeline";

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
  return (
    <nav ref={ref} className="dock glass glass--thick" aria-label="Panels">
      <button type="button" className="dock__button" onClick={() => onOpen("sites")}>
        <List aria-hidden="true" />
        Sites
      </button>
      {placeA ? (
        <button type="button" className="dock__button dock__button--place" onClick={() => onOpen("inspector")} aria-label={`Details of ${placeTitle(placeA)}`}>
          <Info aria-hidden="true" />
          <span className="dock__place">{placeTitle(placeA)}</span>
        </button>
      ) : (
        <span className="dock__hint">Tap the map to pick a point</span>
      )}
      <button type="button" className="dock__button dock__button--icon" onClick={() => onOpen("timeline")} aria-label="Open the timeline">
        <ChevronUp aria-hidden="true" />
      </button>
    </nav>
  );
}
