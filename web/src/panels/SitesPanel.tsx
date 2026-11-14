import { useState, type Ref } from "react";
import { Crosshair, GitCompareArrows, MousePointerClick, Plus, X } from "lucide-react";
import type { SiteInfo } from "../data/load.ts";
import { insideTerrainCoverage } from "../data/terrain.ts";
import { formatLat, formatLon } from "../geo/polar.ts";
import { siteSubtitle, siteTitle } from "../sites.ts";
import { APOLLO_11, actions, customPlace, sitePlace, type Place } from "../state/scenario.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { NumberField } from "../ui/NumberField.tsx";
import { parseDecimal } from "../ui/format.ts";

interface SitesPanelProps {
  ref?: Ref<HTMLElement>;
  sites: SiteInfo[];
  loadError: string | null;
  placeA: Place | null;
  placeB: Place | null;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  /** The user picked a place to assess (scenario A). */
  onChoose: (place: Place) => void;
}

export function SitesPanel({ ref, sites, loadError, placeA, placeB, hoveredKey, onHover, onChoose }: SitesPanelProps) {
  const rows: { place: Place; subtitle: string | null; hoverKey: string | null }[] = [
    ...sites.map((site) => ({ place: sitePlace(site), subtitle: siteSubtitle(site.name), hoverKey: site.key })),
  ];
  const custom = placeA?.kind === "custom" ? placeA : placeB?.kind === "custom" ? placeB : null;

  return (
    <aside ref={ref} className="sidebar glass glass--thick">
      <header className="brand">
        <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 0 0 18" />
        </svg>
        <div>
          <h1 className="brand__name">Lunaris</h1>
          <p className="brand__tagline">Lunar south pole landing sites</p>
        </div>
      </header>

      <div className="sidebar__scroll">
        <section className="site-list" aria-labelledby="site-list-heading">
          <h2 id="site-list-heading" className="section-label">
            Sites
          </h2>
          {loadError ? <p className="site-list__error">Site list could not be loaded ({loadError}).</p> : null}
          <ul>
            {rows.map((row) => (
              <SiteRow key={row.place.id} {...row} placeA={placeA} placeB={placeB} hovered={hoveredKey === row.hoverKey} onHover={onHover} onChoose={onChoose} />
            ))}
          </ul>

          <h2 className="section-label">Reference</h2>
          <ul>
            <SiteRow
              place={APOLLO_11}
              subtitle="Equatorial reference · off map"
              hoverKey={null}
              placeA={placeA}
              placeB={placeB}
              hovered={false}
              onHover={onHover}
              onChoose={onChoose}
            />
          </ul>
        </section>

        {/* Remounted when a point is picked on the map, so the fields show that point. */}
        <CustomEntry key={custom?.id ?? "empty"} initial={custom} comparing={placeA !== null} onChoose={onChoose} />
      </div>

      <p className="sidebar__hint">
        <MousePointerClick aria-hidden="true" />
        Or click anywhere on the map.
      </p>
    </aside>
  );
}

interface SiteRowProps {
  place: Place;
  subtitle: string | null;
  /** Key shared with the map pin for hover highlighting; null for places without a pin. */
  hoverKey: string | null;
  placeA: Place | null;
  placeB: Place | null;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onChoose: (place: Place) => void;
}

function SiteRow({ place, subtitle, hoverKey, placeA, placeB, hovered, onHover, onChoose }: SiteRowProps) {
  const isA = placeA?.id === place.id;
  const isB = placeB?.id === place.id;
  const title = place.kind === "site" ? siteTitle(place.name) : place.name;
  return (
    <li className="site-item" data-role={isA ? "a" : isB ? "b" : undefined}>
      <button
        type="button"
        className="site-row"
        aria-pressed={isA}
        data-hovered={hovered}
        onClick={() => onChoose(place)}
        onPointerEnter={() => onHover(hoverKey)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(hoverKey)}
        onBlur={() => onHover(null)}
      >
        {placeB && (isA || isB) ? <span className={`tag tag--${isA ? "a" : "b"}`}>{isA ? "A" : "B"}</span> : <span className="site-row__dot" aria-hidden="true" />}
        <span className="site-row__text">
          <span className="site-row__title">{title}</span>
          {subtitle ? <span className="site-row__subtitle">{subtitle}</span> : null}
        </span>
        <span className="site-row__coords">
          <span>{formatLat(place.lat)}</span>
          <span>{formatLon(place.lon)}</span>
        </span>
      </button>
      {isB ? (
        <IconButton label="Remove from comparison" variant="plain" size="sm" tipSide="right" onClick={actions.clearComparison}>
          <X aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton
          className="site-item__compare"
          label={isA ? "Already scenario A" : placeA ? "Compare with this site" : "Select this site"}
          variant="plain"
          size="sm"
          tipSide="right"
          disabled={isA}
          onClick={() => actions.compareWith(place)}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      )}
    </li>
  );
}

interface CustomEntryProps {
  initial: Place | null;
  /** A scenario exists, so a custom point can also be added as scenario B. */
  comparing: boolean;
  onChoose: (place: Place) => void;
}

/** Coordinates typed by hand. South latitude and east longitude, as the labels say. */
function CustomEntry({ initial, comparing, onChoose }: CustomEntryProps) {
  const [latText, setLatText] = useState(initial ? Math.abs(initial.lat).toFixed(3) : "");
  const [lonText, setLonText] = useState(initial ? initial.lon.toFixed(3) : "");
  const [touched, setTouched] = useState(false);

  const latS = parseDecimal(latText);
  const lon = parseDecimal(lonText);
  const latOk = latS >= 0 && latS <= 90;
  const lonOk = lon >= 0 && lon < 360;
  const valid = latOk && lonOk;
  const outside = valid && !insideTerrainCoverage(-latS, lon);

  const submit = (as: "a" | "b") => {
    setTouched(true);
    if (!valid) return;
    const place = customPlace(-latS, lon);
    if (as === "a") onChoose(place);
    else actions.compareWith(place);
  };

  return (
    <section className="custom" aria-labelledby="custom-heading">
      <h2 id="custom-heading" className="section-label">
        Custom coordinates
      </h2>
      <div className="custom__fields">
        <NumberField label="Lat °S" suffix="° S" placeholder="85.30" value={latText} onChange={setLatText} onEnter={() => submit("a")} invalid={touched && !latOk} />
        <NumberField label="Lon °E" suffix="° E" placeholder="31.00" value={lonText} onChange={setLonText} onEnter={() => submit("a")} invalid={touched && !lonOk} />
      </div>
      {touched && !valid ? (
        <p className="custom__note" data-tone="error" role="alert">
          Enter a south latitude from 0 to 90 and an east longitude from 0 to 360.
        </p>
      ) : outside ? (
        <p className="custom__note" data-tone="warning">
          Outside the terrain data (60° S to the pole): assessed on the sphere model.
        </p>
      ) : null}
      <div className="custom__actions">
        <Button variant="accent" onClick={() => submit("a")}>
          <Crosshair aria-hidden="true" />
          Assess
        </Button>
        <Button onClick={() => submit("b")} disabled={!comparing}>
          <GitCompareArrows aria-hidden="true" />
          Compare
        </Button>
      </div>
    </section>
  );
}
