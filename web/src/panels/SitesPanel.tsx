import { useEffect, useRef, useState, type Ref } from "react";
import { DropdownMenu } from "radix-ui";
import { CalendarCheck, ChevronDown, Crosshair, EllipsisVertical, GitCompareArrows, MousePointerClick, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldAlert, ShieldCheck, ShieldX, Trash2, X } from "lucide-react";
import type { SiteInfo } from "../data/load.ts";
import { insideTerrainCoverage } from "../data/terrain.ts";
import { siteSubtitle, siteTitle } from "../sites.ts";
import { MAX_SAVED_POINTS, getSavedPoint, openSavedPoint, savedPlace, savedPointActions, useSavedPoints, type SavedPoint } from "../state/savedPoints.ts";
import type { SiteScores } from "../state/siteScores.ts";
import { APOLLO_11, actions, customPlace, placeTitle, sitePlace, type Place } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import type { RiskLevel } from "../engine/risk.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { NumberField } from "../ui/NumberField.tsx";
import { formatDays, formatUtcDate, parseDecimal } from "../ui/format.ts";
import { MissionParameters } from "./MissionParameters.tsx";

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
  /** Live risk of each built-in site for the mission on screen. */
  scores: SiteScores;
  /** The scenarios on screen, for the mission parameters (the mast applies to them). */
  views: ScenarioView[];
  /** Narrow screen: the panel lives in a bottom sheet and does not collapse. */
  mobile: boolean;
}

export function SitesPanel({ ref, sites, loadError, placeA, placeB, hoveredKey, onHover, onChoose, scores, views, mobile }: SitesPanelProps) {
  const [collapsedWide, setCollapsed] = useState(false);
  const collapsed = collapsedWide && !mobile;
  const rows: Pick<SiteRowProps, "place" | "subtitle" | "hoverKey" | "risk" | "best">[] = sites.map((site) => {
    const entry = scores.byKey.get(site.key);
    return {
      place: sitePlace(site),
      subtitle: siteSubtitle(site.name),
      hoverKey: site.key,
      risk: entry ? { overall: entry.score.overall, level: entry.score.level } : null,
      best: scores.bestKey === site.key,
    };
  });
  const custom = placeA?.kind === "custom" ? placeA : placeB?.kind === "custom" ? placeB : null;

  return (
    <aside ref={ref} className="sidebar glass glass--thick" data-collapsed={collapsed || undefined}>
      <header className="brand">
        <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 0 0 18" />
        </svg>
        <div className="brand__text">
          <h1 className="brand__name">Lunaris</h1>
          {/* Collapsed, the selected place stands in for the tagline. */}
          <p className="brand__tagline">{collapsed && placeA ? placeTitle(placeA) : "Lunar south pole landing sites"}</p>
        </div>
        <div className="brand__actions">
          {/* On phones it sits in the dock instead. */}
          {mobile ? null : <MissionParameters views={views} />}
          <IconButton
            className="sidebar__collapse"
            label={collapsed ? "Expand sites" : "Collapse sites"}
            variant="plain"
            size="sm"
            tipSide="bottom"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </IconButton>
        </div>
      </header>

      {collapsed ? null : (
        <>
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

              <SavedPoints placeA={placeA} placeB={placeB} onChoose={onChoose} />

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

          <footer className="sidebar__foot">
            <p className="sidebar__hint">
              <MousePointerClick aria-hidden="true" />
              Or click anywhere on the map.
            </p>
            <p className="sidebar__credit">
              Basemap:{" "}
              <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">
                NASA Moon Trek
              </a>{" "}
              · LRO LOLA hillshade
            </p>
          </footer>
        </>
      )}
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
  /** Risk of the mission on screen at this site; null while unknown or for places without one. */
  risk?: { overall: number; level: RiskLevel } | null;
  /** Lowest risk among the sites. */
  best?: boolean;
}

const LEVEL_ICON = { low: ShieldCheck, medium: ShieldAlert, high: ShieldX };
const LEVEL_TEXT: Record<RiskLevel, string> = { low: "low", medium: "medium", high: "high" };

function SiteRow({ place, subtitle, hoverKey, placeA, placeB, hovered, onHover, onChoose, risk, best }: SiteRowProps) {
  const RiskIcon = risk ? LEVEL_ICON[risk.level] : null;
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
          {risk || subtitle ? (
            <span className="site-row__meta">
              {risk && RiskIcon ? (
                <span className="site-row__risk" data-level={risk.level} aria-label={`Risk ${risk.overall.toFixed(0)}, ${LEVEL_TEXT[risk.level]}`}>
                  <RiskIcon aria-hidden="true" />
                  {risk.overall.toFixed(0)}
                </span>
              ) : null}
              {best ? <span className="site-row__best">Best</span> : null}
              {subtitle ? <span className="site-row__subtitle">{subtitle}</span> : null}
            </span>
          ) : null}
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

interface SavedPointsProps {
  placeA: Place | null;
  placeB: Place | null;
  onChoose: (place: Place) => void;
}

/**
 * Custom points the user saved. Each keeps its own landing date and mission length: the
 * list does not follow the timeline, and opening a point brings its date back.
 */
function SavedPoints({ placeA, placeB, onChoose }: SavedPointsProps) {
  const points = useSavedPoints();
  if (points.length === 0) return null;
  return (
    <>
      <h2 className="section-label">
        Saved points
        <span className="section-label__count">
          {points.length} / {MAX_SAVED_POINTS}
        </span>
      </h2>
      <ul>
        {points.map((point) => (
          <SavedRow key={point.id} point={point} placeA={placeA} placeB={placeB} onChoose={onChoose} />
        ))}
      </ul>
    </>
  );
}

interface SavedRowProps {
  point: SavedPoint;
  placeA: Place | null;
  placeB: Place | null;
  onChoose: (place: Place) => void;
}

function SavedRow({ point, placeA, placeB, onChoose }: SavedRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isA = placeA?.id === point.id;
  const isB = placeB?.id === point.id;

  const open = () => openSavedPoint(point, onChoose);
  const rename = (name: string) => {
    setRenaming(false);
    savedPointActions.rename(point.id, name);
    const renamed = getSavedPoint(point.id);
    if (renamed) actions.replacePlace(point.id, savedPlace(renamed));
  };

  return (
    <li className="site-item" data-role={isA ? "a" : isB ? "b" : undefined}>
      {renaming ? (
        <RenameField initial={point.name} onDone={rename} onCancel={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          className="site-row"
          aria-pressed={isA}
          onClick={open}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
        >
          {placeB && (isA || isB) ? <span className={`tag tag--${isA ? "a" : "b"}`}>{isA ? "A" : "B"}</span> : <span className="site-row__dot site-row__dot--saved" aria-hidden="true" />}
          <span className="site-row__text">
            <span className="site-row__title">{point.name}</span>
            <span className="site-row__subtitle">
              {formatUtcDate(point.savedStartMs)} · {formatDays(point.savedWindowHours / 24)} d
            </span>
          </span>
        </button>
      )}
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <IconButton className="site-item__compare" label={`Actions for ${point.name}`} variant="plain" size="sm" tipSide="right">
            <EllipsisVertical aria-hidden="true" />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="menu glass glass--thick"
            side="right"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            // Rename moves focus into the row's name field instead of back to the button.
            onCloseAutoFocus={(event) => renaming && event.preventDefault()}
          >
            <DropdownMenu.Item className="menu__item" onSelect={() => onChoose(savedPlace(point))}>
              <CalendarCheck aria-hidden="true" />
              Apply to current date
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu__item" disabled={isA} onSelect={() => actions.compareWith(savedPlace(point))}>
              <GitCompareArrows aria-hidden="true" />
              Compare
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu__item" onSelect={() => setRenaming(true)}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu__separator" />
            <DropdownMenu.Item className="menu__item menu__item--danger" onSelect={() => savedPointActions.remove(point.id)}>
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

/** Inline name editor: Enter or leaving the field saves, Escape cancels. */
function RenameField({ initial, onDone, onCancel }: { initial: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter, Escape and the blur that follows when the field goes away must act only once.
  const finished = useRef(false);
  const finish = (action: () => void) => {
    if (finished.current) return;
    finished.current = true;
    action();
  };

  useEffect(() => {
    // After the menu that opened the editor has closed.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span className="site-row site-row--editing">
      <span className="site-row__dot site-row__dot--saved" aria-hidden="true" />
      <input
        ref={inputRef}
        className="rename-field"
        aria-label="Name of the saved point"
        value={text}
        maxLength={60}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => finish(() => onDone(text))}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(() => onDone(text));
          if (event.key === "Escape") {
            // Escape here only cancels the edit; it must not close the panels (App.tsx).
            event.stopPropagation();
            finish(onCancel);
          }
        }}
      />
    </span>
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
  // Open while a custom point is active; a point picked on the map remounts this with it.
  const [open, setOpen] = useState(initial !== null);

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
        <button type="button" className="custom__toggle" aria-expanded={open} aria-controls="custom-body" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Custom coordinates
        </button>
      </h2>
      {open ? (
        <div id="custom-body" className="custom__body">
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
        </div>
      ) : null}
    </section>
  );
}
