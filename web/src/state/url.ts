// Scenario <-> URL, so a view can be shared as a link:
//   ?site=mons_mouton&date=2026-12-16&compare=malapert_a&slip=7&window=240&mast=10&profile=battery_rover&dark=72&slope=12
// `window` is the mission length in hours (1 to 60 days), `slip` may be negative (B before A).
// Limits changed by hand travel as dark / sun / outage / contact / slope (state/limits.ts).
// A custom point is written as `lat,lon` (for example site=-85.3,31), the reference as `apollo11`.
// The Explorer adds `mode=explore`, the surface view `view=surface`, a tour step `step=2`
// (1-based in the URL). Going one level deeper pushes a history entry, so the browser's back
// button leaves it again (state/mode.ts).
import type { SiteInfo } from "../data/load.ts";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { PROFILE_PRESETS, type ProfileKey } from "../engine/risk.ts";
import { isoDay } from "../ui/format.ts";
import { LIMITS, type LimitOverrides } from "./limits.ts";
import { getMode, modeActions, subscribeMode, type ModeState } from "./mode.ts";
import { getSavedPoint, savedPlace } from "./savedPoints.ts";
import { APOLLO_11, WINDOW_HOURS, customPlace, getScenario, sitePlace, subscribeScenario, validWindowHours, type Place } from "./scenario.ts";

function placeToParam(place: Place): string {
  if (place.kind === "site") return place.key;
  if (place.kind === "reference") return "apollo11";
  return `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
}

function paramToPlace(value: string | null, sites: SiteInfo[]): Place | null {
  if (!value) return null;
  if (value === "apollo11") return APOLLO_11;
  const site = sites.find((s) => s.key === value);
  if (site) return sitePlace(site);
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return null;
  const lat = Number(match[1]);
  if (lat < -90 || lat > 90) return null;
  // A saved point comes back with its name and its stored terrain.
  const place = customPlace(lat, Number(match[2]));
  const saved = getSavedPoint(place.id);
  return saved ? savedPlace(saved) : place;
}

export interface UrlScenario {
  placeA: Place | null;
  placeB: Place | null;
  startMs: number | null;
  slipDays: number;
  windowHours: number | null;
  mastM: number | null;
  profileKey: ProfileKey | null;
  limitOverrides: LimitOverrides;
  mode: Pick<ModeState, "mode" | "view" | "step">;
}

function readModeParams(params: URLSearchParams): Pick<ModeState, "mode" | "view" | "step"> {
  const mode = params.get("mode") === "explore" ? "explore" : "plan";
  const step = Number(params.get("step"));
  return {
    mode,
    view: params.get("view") === "surface" ? "surface" : "map",
    step: mode === "explore" && Number.isInteger(step) && step >= 1 ? step - 1 : null,
  };
}

/** What the app keeps in `history.state`. */
export interface HistoryEntry {
  lunarisDepth: number;
  /** Created by the app going one level deeper: back stays in the app. */
  lunarisPushed: boolean;
}

/** Levels above the plain Planner: the Explorer, and the surface view on top. */
function depthOf(m: Pick<ModeState, "mode" | "view">): number {
  return (m.mode === "explore" ? 1 : 0) + (m.view === "surface" ? 1 : 0);
}

export function readUrl(sites: SiteInfo[]): UrlScenario {
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date");
  const startMs = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const slip = Number(params.get("slip"));
  const windowHours = Number(params.get("window"));
  const mast = Number(params.get("mast"));
  const profile = params.get("profile");
  const limitOverrides: LimitOverrides = {};
  for (const limit of LIMITS) {
    const raw = params.get(limit.param);
    const value = raw === null ? NaN : Number(raw);
    if (value >= limit.min && value <= limit.max) limitOverrides[limit.key] = value;
  }
  return {
    mode: readModeParams(params),
    limitOverrides,
    placeA: paramToPlace(params.get("site"), sites),
    placeB: paramToPlace(params.get("compare"), sites),
    startMs: Number.isNaN(startMs) ? null : startMs,
    slipDays: Number.isInteger(slip) ? slip : 0,
    windowHours: params.has("window") ? validWindowHours(windowHours) : null,
    mastM: Number.isInteger(mast) && mast >= MAST_RANGE_M.min && mast <= MAST_RANGE_M.max ? mast : null,
    profileKey: profile !== null && Object.hasOwn(PROFILE_PRESETS, profile) ? (profile as ProfileKey) : null,
  };
}

/** Keeps the address bar in step with the scenario and the mode. Returns the unsubscribe function. */
export function syncUrl(): () => void {
  let last = "";
  // The page's own entry is never pushed: back from it leaves the app as before.
  let first = true;
  const write = () => {
    const s = getScenario();
    if (!s.limits) return;
    const m = getMode();
    const params = new URLSearchParams();
    if (s.placeA) params.set("site", placeToParam(s.placeA));
    params.set("date", isoDay(s.startMs));
    if (s.placeB && s.placeB.id !== s.placeA?.id) params.set("compare", placeToParam(s.placeB));
    if (s.placeB && s.slipDays !== 0) params.set("slip", String(s.slipDays));
    if (s.windowHours !== WINDOW_HOURS.mission) params.set("window", String(s.windowHours));
    if (s.mastM !== MAST_RANGE_M.min) params.set("mast", String(s.mastM));
    if (s.profileKey !== "generic") params.set("profile", s.profileKey);
    for (const limit of LIMITS) {
      const value = s.limitOverrides[limit.key];
      if (value !== undefined) params.set(limit.param, String(value));
    }
    if (m.mode === "explore") params.set("mode", "explore");
    if (m.view === "surface") params.set("view", "surface");
    if (m.mode === "explore" && m.step !== null) params.set("step", String(m.step + 1));
    const query = params.toString();
    // The store also changes on every playback frame; the URL only when the scenario does.
    if (query === last) return;
    last = query;
    const url = `${window.location.pathname}?${query}`;
    const depth = depthOf(m);
    const entry = (window.history.state as HistoryEntry | null) ?? { lunarisDepth: 0, lunarisPushed: false };
    // One level deeper: a new entry, so back returns to where the user came from.
    if (!first && depth > (entry.lunarisDepth ?? 0)) {
      window.history.pushState({ lunarisDepth: depth, lunarisPushed: true } satisfies HistoryEntry, "", url);
    } else {
      window.history.replaceState({ lunarisDepth: depth, lunarisPushed: !first && entry.lunarisPushed === true } satisfies HistoryEntry, "", url);
    }
    first = false;
  };
  // Back / forward: take the mode from the entry, keep the scenario as it is now.
  const onPop = () => {
    modeActions.restore(readModeParams(new URLSearchParams(window.location.search)));
    last = "";
    write();
  };
  write();
  const offScenario = subscribeScenario(write);
  const offMode = subscribeMode(write);
  window.addEventListener("popstate", onPop);
  return () => {
    offScenario();
    offMode();
    window.removeEventListener("popstate", onPop);
  };
}
