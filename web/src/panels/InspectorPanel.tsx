import { useMemo, type ReactNode, type Ref } from "react";
import { BatteryFull, BatteryWarning, Bookmark, BookmarkCheck, Radio, X } from "lucide-react";
import { HorizonView } from "../charts/HorizonView.tsx";
import { nextTransition, panelYield, type Transitions } from "../engine/events.ts";
import { analyzeWindow } from "../engine/risk.ts";
import { formatDistance, formatLat, formatLon, surfaceDistanceM } from "../geo/polar.ts";
import { siteSubtitle } from "../sites.ts";
import { MAX_SAVED_POINTS, savedPlace, savedPointActions, useSavedPoints } from "../state/savedPoints.ts";
import { actions, customPlace, placeTitle, useScenario } from "../state/scenario.ts";
import { useInstant, type ScenarioView } from "../state/view.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { Tip } from "../ui/Tooltip.tsx";
import { formatAngle, formatDuration, formatHours, formatUtcDate, formatUtcDayTime } from "../ui/format.ts";
import "./panels.css";

const HOUR_MS = 3600000;
const LINK_BLOCK_LABEL = { terrain: "Terrain", station: "No station", conjunction: "Conjunction" };
const KICKER = { site: "Landing site", custom: "Custom point", reference: "Equatorial reference" };

interface InspectorPanelProps {
  ref?: Ref<HTMLElement>;
  views: ScenarioView[];
  /** Risk badge and mast control, added below the metric cards. */
  children?: ReactNode;
}

export function InspectorPanel({ ref, views, children }: InspectorPanelProps) {
  const [a] = views;
  const comparing = views.length > 1;
  const place = a.data.place;
  const subtitle = place.kind === "site" ? siteSubtitle(place.name) : null;

  return (
    <aside ref={ref} className="inspector glass glass--thick" aria-label={`${KICKER[place.kind]}: ${placeTitle(place)}`} data-compare={comparing || undefined}>
      <header className="inspector__header">
        {comparing ? (
          <div className="inspector__versus">
            <p className="inspector__kicker">Comparison</p>
            {views.map((view) => (
              <h2 key={view.tag} className="inspector__vs-row">
                <span className={`tag tag--${view.tag.toLowerCase()}`}>{view.tag}</span>
                <span className="inspector__vs-name">{placeTitle(view.data.place)}</span>
                <span className="inspector__vs-date">{formatUtcDate(view.startMs)}</span>
              </h2>
            ))}
          </div>
        ) : (
          <div>
            <p className="inspector__kicker">{KICKER[place.kind]}</p>
            <h2 className="inspector__title">{placeTitle(place)}</h2>
            {subtitle ? <p className="inspector__subtitle">{subtitle}</p> : null}
          </div>
        )}
        <IconButton label={comparing ? "Close scenario A" : "Close"} size="sm" tipSide="left" onClick={() => actions.selectPlace(null)}>
          <X aria-hidden="true" />
        </IconButton>
      </header>

      {views.map((view) => (
        <section key={view.tag} className="inspector__scene">
          <Summary view={view} tagged={comparing} />
          <HorizonView view={view} compact={comparing} />
        </section>
      ))}

      <div className="metrics">
        <Metric label="Solar elevation" views={views} cell={ElevationCell} />
        <Metric label="Time to sunset" views={views} cell={SunsetCell} />
        <Metric label="Time to Earthset" views={views} cell={EarthsetCell} />
        <Metric label="Longest darkness" views={views} cell={DarknessCell} />
      </div>

      {children}
    </aside>
  );
}

/** `84.79° S, 29.20° E • 158 km to pole • Slope p95 5.9°`, and which horizon model is in use. */
function Summary({ view, tagged }: { view: ScenarioView; tagged: boolean }) {
  const { data } = view;
  const parts = [`${formatLat(data.lat)}, ${formatLon(data.lon)}`, `${formatDistance(surfaceDistanceM(data.lat, data.lon, -90, 0))} to pole`];
  if (data.slopeP95Deg !== null) parts.push(`Slope p95 ${data.slopeP95Deg.toFixed(1)}°`);
  const mastNote = data.mast.mode === "estimate" ? " (est.)" : "";
  const model =
    data.status === "terrain"
      ? `LOLA terrain · ${data.mast.heightM} m mast${mastNote}`
      : data.status === "loading"
        ? "Sphere model · loading terrain…"
        : "Sphere model · no terrain";
  return (
    <div className="summary">
      <div className="summary__text">
        <p className="summary__line">
          {tagged ? <span className={`tag tag--${view.tag.toLowerCase()}`}>{view.tag}</span> : null}
          {parts.join(" • ")}
        </p>
        <p className="summary__model" data-model={data.status}>
          <span className="summary__dot" aria-hidden="true" />
          {model}
          {data.status === "sphere" && data.sphereReason ? <span className="summary__reason"> — {data.sphereReason}</span> : null}
        </p>
      </div>
      {data.place.kind === "custom" ? <SavePointButton view={view} /> : null}
    </div>
  );
}

/**
 * Keeps a custom point in the "Saved points" list with its terrain, date and mission
 * length. The place on screen becomes the saved point (its snapped position and name).
 */
function SavePointButton({ view }: { view: ScenarioView }) {
  const saved = useSavedPoints();
  const windowHours = useScenario((s) => s.windowHours);
  const { data } = view;
  const id = customPlace(data.lat, data.lon).id;
  const isSaved = saved.some((point) => point.id === id || point.id === data.place.id);
  const full = saved.length >= MAX_SAVED_POINTS;
  const loading = data.status === "loading";

  if (isSaved) {
    return (
      <Tip label="In the saved points on the left" side="left">
        <span className="summary__saved">
          <BookmarkCheck aria-hidden="true" />
          Saved
        </span>
      </Tip>
    );
  }
  const save = () => {
    const point = savedPointActions.save({
      lat: data.lat,
      lon: data.lon,
      startMs: view.startMs,
      windowHours,
      terrain: data.status === "terrain" ? data.terrain : null,
    });
    if (point) actions.replacePlace(data.place.id, savedPlace(point));
  };
  const hint = full ? `Up to ${MAX_SAVED_POINTS} saved points; delete one first` : loading ? "Waiting for the terrain" : "Save this point with its date and mission length";
  return (
    <Tip label={hint} side="left">
      {/* The wrapper keeps the tooltip working while the button is disabled. */}
      <span className="summary__save">
        <Button size="sm" variant="filled" onClick={save} disabled={full || loading}>
          <Bookmark aria-hidden="true" />
          Save
        </Button>
      </span>
    </Tip>
  );
}

interface MetricProps {
  label: string;
  hint?: string;
  views: ScenarioView[];
  cell: (props: { view: ScenarioView }) => ReactNode;
}

/** A card with one value per scenario; A and B sit side by side while comparing. */
function Metric({ label, hint, views, cell: Cell }: MetricProps) {
  return (
    <section className="metric">
      <h3 className="metric__label">
        {label}
        {hint ? <span className="metric__hint"> · {hint}</span> : null}
      </h3>
      <div className="metric__cells">
        {views.map((view) => (
          <div key={view.tag} className="metric__cell">
            {views.length > 1 ? <span className={`tag tag--${view.tag.toLowerCase()}`}>{view.tag}</span> : null}
            <div className="metric__body">
              <Cell view={view} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ElevationCell({ view }: { view: ScenarioView }) {
  const at = useInstant(view);
  const output = panelYield(at.sunAlt, at.solarFraction);
  return (
    <>
      <p className="metric__value metric__value--xl">{formatAngle(at.sunAlt)}</p>
      <p className="metric__sub">
        {formatAngle(at.sunAboveTerrain, 1)} vs {view.data.horizon ? "terrain" : "horizon"}
      </p>
      <p className="metric__sub">
        Panel: <b>{(output.vertical * 100).toFixed(0)}%</b> upright · <b>{(output.horizontal * 100).toFixed(0)}%</b> flat
      </p>
    </>
  );
}

/** Whether a body is up now and when that changes, from the interpolated event list. */
function nextEvent(view: ScenarioView, events: Transitions, visibleNow: boolean, position: number) {
  const next = nextTransition(events, position);
  const { series } = view.data;
  return {
    visible: next ? !next.rising : visibleNow,
    hours: next ? (next.position - position) * series.stepHours : null,
    atMs: next ? series.startMs + next.position * series.stepHours * HOUR_MS : null,
  };
}

function SunsetCell({ view }: { view: ScenarioView }) {
  const at = useInstant(view);
  const sun = nextEvent(view, view.data.sunEvents, at.sunVisible, at.position);
  if (!sun.visible) {
    return (
      <>
        <p className="metric__value is-danger">In shadow</p>
        <p className="metric__sub">{sun.hours !== null ? `sunrise in ${formatDuration(sun.hours)}` : "None in window"}</p>
        {sun.atMs !== null ? <p className="metric__sub">{formatUtcDayTime(sun.atMs)}</p> : null}
      </>
    );
  }
  return (
    <>
      <p className="metric__value">{sun.hours !== null ? formatDuration(sun.hours) : "Always lit"}</p>
      <p className="metric__sub">{sun.atMs !== null ? `Sunset ${formatUtcDayTime(sun.atMs)}` : "None in window"}</p>
    </>
  );
}

function EarthsetCell({ view }: { view: ScenarioView }) {
  const at = useInstant(view);
  const earth = nextEvent(view, view.data.earthEvents, at.earthVisible, at.position);
  return (
    <>
      {earth.visible ? (
        <p className="metric__value">{earth.hours !== null ? formatDuration(earth.hours) : "Always visible"}</p>
      ) : (
        <p className="metric__value is-danger">{earth.hours !== null ? "Earth is down" : "Never rises"}</p>
      )}
      {earth.atMs !== null ? (
        <p className="metric__sub">
          {earth.visible ? "Earthset" : `Earthrise in ${formatDuration(earth.hours!)},`} {formatUtcDayTime(earth.atMs)}
        </p>
      ) : null}
      <p className="metric__status" data-state={at.link ? "good" : "bad"}>
        <Radio aria-hidden="true" />
        Link: {at.link ? "Active" : LINK_BLOCK_LABEL[at.linkBlock!]}
      </p>
    </>
  );
}

function DarknessCell({ view }: { view: ScenarioView }) {
  const hours = useScenario((s) => s.windowHours);
  const window = useMemo(() => analyzeWindow(view.data.series, view.startMs, hours / 24), [view, hours]);
  if (!window) return <p className="metric__value">–</p>;
  const battery = view.data.series.profile.battery_survival_h;
  const survives = window.power.longest_darkness_h <= battery;
  return (
    <>
      <p className="metric__value">{formatHours(window.power.longest_darkness_h)}</p>
      <p className="metric__status" data-state={survives ? "good" : "bad"}>
        {survives ? <BatteryFull aria-hidden="true" /> : <BatteryWarning aria-hidden="true" />}
        {survives ? "≤" : ">"} {battery} h battery
      </p>
      <p className="metric__sub">{window.power.sunlit_pct.toFixed(0)}% sunlit</p>
    </>
  );
}
