import { Info } from "lucide-react";
import type { ScenarioView } from "../state/view.ts";
import { Button } from "../ui/Button.tsx";
import { Tip } from "../ui/Tooltip.tsx";

/** Mean synodic day of the Moon, hours: one sunrise to the next. */
const LUNAR_DAY_H = 708.7;

/**
 * Two or three plain sentences for readers who are not mission planners: what is different
 * about this place compared with the sky we know from Earth. Behind an info icon in the
 * inspector header, so it takes no room until asked for.
 */
export function Explainer({ views }: { views: ScenarioView[] }) {
  const places = views.map((view) => view.data.place);
  const polar = places.some((place) => place.lat < -80);
  const equatorial = places.some((place) => Math.abs(place.lat) < 30);
  const sunRate = (360 / LUNAR_DAY_H).toFixed(1);

  const notes = (
    <ul className="explainer">
        <li>
          The Sun moves about {sunRate}° per hour here, 15° per hour on Earth. One day and night together last {(LUNAR_DAY_H / 24).toFixed(1)} Earth days.
        </li>
        {polar ? (
          <li>Near the pole the Sun never climbs more than a few degrees, so a single ridge decides between light and darkness, and a week's slip can change everything.</li>
        ) : null}
        {equatorial ? <li>Near the equator the Sun passes high overhead: about two weeks of light, then two weeks of night, with no terrain to blame.</li> : null}
        <li>The Earth does not rise and set each day. It hovers around one spot in the sky and drifts by a few degrees over a month.</li>
    </ul>
  );

  return (
    <Tip label={notes} side="left">
      <Button variant="plain" size="sm" className="btn--icon" aria-label="Good to know">
        <Info aria-hidden="true" />
      </Button>
    </Tip>
  );
}
