// Explorer: what the place is going through right now, in plain words. Four small cards that
// follow the timeline: the Sun, the Earth, the battery and the Sun's height.
import type { ReactNode } from "react";
import { BatteryCharging, BatteryLow, BatteryMedium, Earth, Sun, Sunrise } from "lucide-react";
import { obstruction } from "../charts/why.ts";
import { nextChange, type Instant } from "../engine/events.ts";
import { sampleIndex } from "../engine/sky.ts";
import { formatDistance } from "../geo/polar.ts";
import { useSkyTables } from "../state/placeData.ts";
import { useScenario } from "../state/scenario.ts";
import { useInstant, type ScenarioView } from "../state/view.ts";
import { formatDuration } from "../ui/format.ts";
import { batteryAt, type Battery } from "./game.ts";
import "./game.css";

/** A thumb held at arm's length covers about 2 degrees of sky (a common rule of thumb). */
const THUMB_DEG = 2;

export function LiveCards({ view }: { view: ScenarioView }) {
  const at = useInstant(view);
  const offsetMs = useScenario((s) => s.offsetMs);
  const battery = batteryAt(view.data.series, view.startMs, view.startMs + offsetMs);
  return (
    <div className="cards" aria-live="off">
      <SunCard view={view} at={at} />
      <EarthCard view={view} at={at} />
      <BatteryCard battery={battery} batteryH={view.data.series.profile.battery_survival_h} />
      <HeightCard at={at} />
    </div>
  );
}

function Card({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="card" data-tone={tone}>
      <span className="card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="card__label">{label}</span>
      <span className="card__value">{value}</span>
      {sub ? <span className="card__sub">{sub}</span> : null}
    </div>
  );
}

function SunCard({ view, at }: { view: ScenarioView; at: Instant }) {
  const next = nextChange(view.data.series, view.data.sunEvents, at.sunVisible, at.position);
  const block = obstruction(view.data, "sun", at);
  let value: string;
  if (at.sunVisible) value = block && !block.hidden ? "Partly behind a hill" : "Shining";
  else if (block?.byTerrain) value = block.rangeKm !== null ? `Behind a hill ${formatDistance(block.rangeKm * 1000)} away` : "Behind the hills";
  else value = "Below the horizon";
  const sub = next.hours !== null ? `${at.sunVisible ? "Gone" : "Back"} in ${formatDuration(next.hours)}` : at.sunVisible ? "Stays up" : "Not back in the data";
  return <Card icon={<Sun />} label="Sun" value={value} sub={sub} tone={at.sunVisible ? "good" : "bad"} />;
}

function EarthCard({ view, at }: { view: ScenarioView; at: Instant }) {
  const { tables } = useSkyTables();
  const next = nextChange(view.data.series, view.data.earthEvents, at.earthVisible, at.position);
  const back = next.hours !== null ? `${at.earthVisible ? "Gone" : "Back"} in ${formatDuration(next.hours)}` : undefined;
  if (!at.earthVisible) {
    const block = obstruction(view.data, "earth", at);
    return <Card icon={<Earth />} label="Earth" value={block?.byTerrain ? "Behind the hills: no call home" : "Below the horizon: no call home"} sub={back} tone="bad" />;
  }
  if (at.linkBlock === "conjunction") return <Card icon={<Earth />} label="Earth" value="In view, but the Sun drowns the radio" sub={back} tone="warn" />;
  let listener: string | null = null;
  if (tables) {
    const i = sampleIndex(tables.vectors, at.ms);
    let best = view.data.series.profile.station_min_elevation_deg;
    for (const station of tables.stations) {
      const alt = station.alt[i] ?? -90;
      if (alt > best) {
        best = alt;
        listener = station.name[0].toUpperCase() + station.name.slice(1);
      }
    }
  }
  if (!listener && at.linkBlock === "station") return <Card icon={<Earth />} label="Earth" value="In view, no antenna facing us" sub={back} tone="warn" />;
  return <Card icon={<Earth />} label="Earth" value={listener ? `In view: ${listener} is listening` : "In view"} sub={back} tone="good" />;
}

function BatteryCard({ battery, batteryH }: { battery: Battery; batteryH: number }) {
  const low = battery.share < 0.25;
  const icon = battery.charging ? <BatteryCharging /> : low ? <BatteryLow /> : <BatteryMedium />;
  const value = battery.charging ? "Charging in sunlight" : battery.leftH <= 0 ? "Empty" : `${formatDuration(battery.leftH)} of dark left`;
  return (
    <div className="card" data-tone={battery.charging ? "good" : low ? "bad" : "warn"}>
      <span className="card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="card__label">Battery</span>
      <span className="card__value">{value}</span>
      <span className="card__bar" role="meter" aria-label="Battery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(battery.share * 100)}>
        <span className="card__bar-fill" style={{ width: `${battery.share * 100}%` }} />
      </span>
      <span className="card__sub">Lasts {batteryH} h without Sun</span>
    </div>
  );
}

function HeightCard({ at }: { at: Instant }) {
  const thumbs = at.sunAlt / THUMB_DEG;
  let sub: string;
  if (at.sunAlt < 0) sub = "Below flat ground";
  else if (thumbs < 1) sub = "Lower than your thumb at arm's length";
  else sub = `About ${Math.round(thumbs)} thumb${Math.round(thumbs) === 1 ? "" : "s"} at arm's length`;
  return <Card icon={<Sunrise />} label="Sun height" value={`${at.sunAlt.toFixed(1)}°`} sub={sub} />;
}
