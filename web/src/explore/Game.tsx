import { ArrowRight, BatteryWarning, Map as MapIcon, Mountain, Plane, Rocket, RotateCcw, Star, Sun } from "lucide-react";
import { offsetText } from "../state/nearby.ts";
import { modeActions } from "../state/mode.ts";
import { useScenario } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { Button } from "../ui/Button.tsx";
import { formatUtcDateTime } from "../ui/format.ts";
import { GAME_DAYS, LANDINGS_FOR_STAR, MISSIONS, SCOUTS_PER_MISSION, batteryAt, directionHint, isTooSteep, pointKey } from "./game.ts";
import { LiveCards } from "./LiveCards.tsx";
import { SunStrip } from "./SunStrip.tsx";
import type { AttemptResult, GameState } from "./useGame.ts";
import "./game.css";

const WORDS: Record<string, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };

// ---------- Caption panel ----------

export function GamePanel({ game, compact }: { game: GameState; compact: boolean }) {
  const { view, phase } = game;
  const mission = MISSIONS[game.mission];
  const header = (
    <div className="game__missions" role="tablist" aria-label="Missions">
      {MISSIONS.map((m, i) => (
        <button key={m.id} type="button" role="tab" aria-selected={i === game.mission} className="game__mission" disabled={phase === "playing"} onClick={() => game.setMission(i)}>
          <span className="game__mission-number">{i + 1}</span>
          <span className="game__mission-title">{m.title}</span>
          <StarRow count={game.bestStars[m.id] ?? 0} small />
        </button>
      ))}
    </div>
  );

  if (phase === "playing" && view) {
    return (
      <div className="game">
        {header}
        <div className="game__body">
          <div className="explorer__words">
            <p className="explorer__step-title">Mission {game.mission + 1} · landed</p>
            <p>The lander is on its own now. Watch the battery: it drains in the dark and fills up again in sunlight.</p>
          </div>
          <LiveCards view={view} />
        </div>
      </div>
    );
  }

  if (phase === "done" && view && game.outcome) {
    return (
      <div className="game">
        {header}
        <div className="game__body">
          <Debrief game={game} view={view} />
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      {header}
      <div className="game__body">
        <div className="explorer__words">
          <p className="explorer__step-title">
            Mission {game.mission + 1} · {mission.title}
          </p>
          <p>{mission.blurb}</p>
          {view ? <Rules view={view} /> : null}
        </div>
        {compact && phase !== "brief" ? <ScoutMap game={game} /> : null}
        {phase === "pick" ? <FlightLog game={game} /> : null}
        {phase === "brief" && compact ? (
          <Button size="sm" variant="accent" onClick={game.start}>
            Start <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Rules({ view }: { view: ScenarioView }) {
  const { profile } = view.data.series;
  return (
    <ul className="game__rules">
      <li>
        <BatteryWarning aria-hidden="true" />
        <span>
          More than <b>{profile.battery_survival_h} h</b> without Sun: the battery dies.
        </span>
      </li>
      <li>
        <Mountain aria-hidden="true" />
        <span>
          Ground steeper than <b>{profile.max_slope_deg}°</b>: the lander tips over.
        </span>
      </li>
      <li>
        <Sun aria-hidden="true" />
        <span>
          Clue: the Sun's path in the sky is <b>dashed</b> where hills hide it.
        </span>
      </li>
    </ul>
  );
}

function Debrief({ game, view }: { game: GameState; view: ScenarioView }) {
  const outcome = game.outcome!;
  const startMs = view.startMs;
  let story: string;
  if (outcome.cause === "slope") {
    story = `The ground here is ${outcome.slopeDeg!.toFixed(0)}° steep, but the lander can only stand on ${outcome.slopeLimitDeg}°. It tipped over at touchdown.`;
  } else if (outcome.failed) {
    const day = (outcome.survivedH / 24).toFixed(1);
    const where = outcome.cause === "terrain" ? "behind the hills" : "below the horizon";
    story =
      outcome.darkStartMs! <= startMs
        ? `Day ${day}: the battery ran out. The lander touched down in the dark, and the Sun stayed ${where} for more than ${outcome.batteryH} h.`
        : `Day ${day}: the battery ran out. The Sun went ${where} on ${formatUtcDateTime(outcome.darkStartMs!)} and stayed away for more than ${outcome.batteryH} h.`;
  } else {
    story =
      outcome.longestDarkH === 0
        ? `The lander made it through all ${GAME_DAYS} days without a single hour of darkness.`
        : `The lander made it through ${GAME_DAYS} days. Its longest time without Sun was ${Math.round(outcome.longestDarkH)} h, and the battery lasts ${outcome.batteryH} h.`;
  }
  const direction = outcome.failed && game.nearby && game.current ? directionHint(game.nearby.scored, game.current, outcome.batteryH, outcome.slopeLimitDeg) : null;
  return (
    <>
      <div className="explorer__words">
        <p className="explorer__step-title">{outcome.failed ? "Mission lost" : "Mission complete"}</p>
        <p>{story}</p>
        {direction ? (
          <p>
            Hint: look to the {WORDS[direction]} of this spot.{game.scoutsLeft > 0 ? " A scout flight shows a spot's Sun before you land." : ""}
          </p>
        ) : outcome.failed && outcome.cause !== "slope" ? (
          <p>No flat spot nearby survives this date.</p>
        ) : null}
      </div>
      {outcome.cause !== "slope" ? <SunStrip data={view.data} landingMs={startMs} hours={GAME_DAYS * 24} battery failAtH={outcome.failed ? outcome.survivedH : null} /> : null}
    </>
  );
}

function FlightLog({ game }: { game: GameState }) {
  const battery = game.view?.data.series.profile.battery_survival_h ?? 0;
  return (
    <section className="log" aria-label="Flight log">
      <p className="log__title">Flight log</p>
      {game.history.length === 0 ? (
        <ol className="log__steps">
          <li>Click a spot on the landing map. Hatched spots are too steep.</li>
          <li>Look at the sky: where is the Sun's path dashed behind the hills?</li>
          <li>Not sure? Send a scout: the orange band must never have a dark gap longer than the red battery bar.</li>
          <li>Land, and watch the battery.</li>
        </ol>
      ) : (
        <ul className="log__list">
          {game.history.map((entry, i) => (
            <li key={i} data-result={entry.result}>
              <span className="log__n">#{i + 1}</span>
              <span className="log__where">{entry.where}</span>
              <span className="log__what">
                {entry.result === "tipped"
                  ? "tipped over"
                  : entry.result === "dead"
                    ? `battery died, day ${entry.day.toFixed(1)}`
                    : `survived · ${Math.round(entry.darkH)} of ${battery} h dark`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Stage overlay ----------

export function GameStage({ game, compact }: { game: GameState; compact: boolean }) {
  const { phase, view } = game;
  const mission = MISSIONS[game.mission];
  if (phase === "brief" && !compact) {
    return (
      <div className="game-card game-card--center glass glass--thick" role="dialog" aria-label={`Mission ${game.mission + 1}`}>
        <p className="explorer__step-title">
          Mission {game.mission + 1} of {MISSIONS.length}
        </p>
        <h2 className="game-card__title">{mission.title}</h2>
        <p className="game-card__text">
          Keep the lander alive for {GAME_DAYS} days. Pick a spot on the map within 500 m of the site, then land. {SCOUTS_PER_MISSION} scout flights show you a spot's Sun before you commit.
        </p>
        {view ? <Rules view={view} /> : null}
        <Button variant="accent" onClick={game.start}>
          Start the mission <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    );
  }
  if (phase === "pick" && !compact) {
    return (
      <div className="game-card game-card--map glass glass--thick">
        <ScoutMap game={game} />
      </div>
    );
  }
  if (phase === "playing" && view) return <LowBattery view={view} />;
  if (phase === "done" && game.outcome) {
    const { outcome, stars } = game;
    const title = outcome.cause === "slope" ? "Tipped over" : outcome.failed ? "Battery empty" : "Mission complete";
    const next = game.mission + 1 < MISSIONS.length ? game.mission + 1 : null;
    return (
      <div className="game-card game-card--center game-card--result glass glass--thick" data-won={!outcome.failed || undefined} role="status">
        <h2 className="game-card__title">{title}</h2>
        {outcome.cause === "slope" ? (
          <p className="game-card__text">
            Ground {outcome.slopeDeg!.toFixed(0)}° steep, the limit is {outcome.slopeLimitDeg}°
          </p>
        ) : outcome.failed ? (
          <p className="game-card__text">
            Day {(outcome.survivedH / 24).toFixed(1)} of {GAME_DAYS}: {Math.round(outcome.longestDarkH)} h without Sun
          </p>
        ) : null}
        {stars && !outcome.failed ? (
          <ul className="game-card__stars">
            {stars.earned.map((on, i) => (
              <li key={i} data-on={on || undefined} style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
                <Star aria-hidden="true" /> <span>{stars.reasons[i]}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="game-card__text game-card__text--quiet">
          Landing {game.landings} · {game.scoutsLeft} scout flight{game.scoutsLeft === 1 ? "" : "s"} left
        </p>
        <div className="game-card__buttons">
          <Button size="sm" variant={outcome.failed ? "accent" : undefined} onClick={game.retry}>
            <RotateCcw aria-hidden="true" /> {outcome.failed ? "Try another spot" : "Play again"}
          </Button>
          {!outcome.failed && next !== null ? (
            <Button size="sm" variant="accent" onClick={() => game.setMission(next)}>
              Next mission <ArrowRight aria-hidden="true" />
            </Button>
          ) : null}
          {!outcome.failed && next === null ? (
            <Button size="sm" variant="accent" onClick={() => modeActions.setMode("plan")}>
              <MapIcon aria-hidden="true" /> Open in Planner
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return null;
}

function LowBattery({ view }: { view: ScenarioView }) {
  const offsetMs = useScenario((s) => s.offsetMs);
  const battery = batteryAt(view.data.series, view.startMs, view.startMs + offsetMs);
  return (
    <div className="game-hud" data-low={battery.share < 0.25 || undefined}>
      <span className="game-hud__label">{battery.charging ? "Charging" : battery.share < 0.25 ? "Battery low" : "On battery"}</span>
      <span className="game-hud__bar">
        <span className="game-hud__fill" style={{ width: `${battery.share * 100}%` }} />
      </span>
      <span className="game-hud__value">{Math.round(battery.share * 100)}%</span>
    </div>
  );
}

function StarRow({ count, small = false }: { count: number; small?: boolean }) {
  return (
    <span className="game__star-row" data-small={small || undefined} role="img" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <Star key={i} aria-hidden="true" data-on={i < count || undefined} />
      ))}
    </span>
  );
}

// ---------- Scout map ----------

const RESULT_LABEL: Record<AttemptResult, string> = { ok: "survived", low: "survived, battery ran low", dead: "battery died", tipped: "tipped over" };

function ScoutMap({ game }: { game: GameState }) {
  const { grid, current, view } = game;
  if (!grid || !view) return <p className="game__loading">Loading the map…</p>;
  const limit = view.data.series.profile.max_slope_deg;
  const size = Math.round(Math.sqrt(grid.points.length));
  const half = ((size - 1) / 2) * grid.step_m;
  const points = [...grid.points].sort((p, q) => q.north_m - p.north_m || p.east_m - q.east_m);
  const steep = current ? isTooSteep(current, limit) : false;
  const key = current ? pointKey(current) : null;
  const scouted = key !== null && game.scouted.has(key);
  const tried = key !== null ? game.log.get(key) : undefined;
  const playing = game.phase === "playing";
  return (
    <div className="scout">
      <div className="scout__head">
        <span className="scout__title">Landing map</span>
        <span className="scout__meta">
          {game.landings < LANDINGS_FOR_STAR ? `${LANDINGS_FOR_STAR - game.landings} ${LANDINGS_FOR_STAR - game.landings === 1 ? "try" : "tries"} left for ★★` : `Landing ${game.landings + (playing ? 0 : 1)}`}
        </span>
      </div>
      <div className="scout__frame">
        <span className="scout__north" aria-hidden="true">
          N
        </span>
        <div className="scout__grid" role="radiogroup" aria-label="Landing spot, north up" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
          {points.map((point) => {
            const k = pointKey(point);
            const attempt = game.log.get(k);
            const center = point.east_m === 0 && point.north_m === 0;
            const tooSteep = isTooSteep(point, limit);
            const where = center ? "site center" : offsetText(point);
            const slope = point.slope_deg !== null ? `${point.slope_deg.toFixed(0)}° slope` : "slope unknown";
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={point === current}
                aria-label={`${where}, ${slope}${tooSteep ? ", too steep" : ""}${attempt ? `, ${RESULT_LABEL[attempt.result]}` : ""}`}
                title={`${where} · ${slope}${attempt ? ` · ${RESULT_LABEL[attempt.result]}${attempt.result === "dead" ? ` on day ${attempt.day.toFixed(1)}` : ""}` : ""}`}
                className="scout__cell"
                data-steep={tooSteep || undefined}
                data-center={center || undefined}
                data-result={attempt?.result}
                data-scouted={game.scouted.has(k) || undefined}
                disabled={playing}
                onClick={() => game.choose(point)}
              />
            );
          })}
        </div>
        <span className="scout__scale" aria-hidden="true">
          {Math.round(2 * half)} m
        </span>
      </div>
      <ul className="scout__legend" aria-label="Legend">
        <li data-key="steep">Too steep</li>
        <li data-key="ok">Survived</li>
        <li data-key="low">Barely</li>
        <li data-key="dead">Battery died</li>
        <li data-key="tipped">Tipped</li>
      </ul>
      <div className="scout__spot" aria-live="polite">
        {current ? (
          <>
            <p className="scout__where">
              <b>{current.east_m === 0 && current.north_m === 0 ? "Site center" : offsetText(current)}</b> · ground{" "}
              <span data-bad={steep || undefined}>
                {current.slope_deg !== null ? `${current.slope_deg.toFixed(0)}°` : "?"} {steep ? `(over ${limit}°)` : "(flat enough)"}
              </span>
              {tried ? <span className="scout__tried"> · tried: {RESULT_LABEL[tried.result]}</span> : null}
            </p>
            {scouted ? (
              <SunStrip data={view.data} landingMs={view.startMs} hours={GAME_DAYS * 24} />
            ) : (
              <Button size="sm" disabled={game.scoutsLeft === 0 || playing} onClick={game.scout}>
                <Plane aria-hidden="true" /> Scout the Sun here ({game.scoutsLeft} left)
              </Button>
            )}
          </>
        ) : (
          <p className="scout__where">Pick a spot on the map.</p>
        )}
      </div>
      <Button variant="accent" disabled={!current || playing} onClick={game.land}>
        <Rocket aria-hidden="true" /> Land here
      </Button>
    </div>
  );
}
