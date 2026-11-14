// Scenario <-> URL, so a view can be shared as a link:
//   ?site=mons_mouton&date=2026-12-16&compare=malapert_a&slip=7&window=708&mast=10&profile=battery_rover
// A custom point is written as `lat,lon` (for example site=-85.3,31), the reference as `apollo11`.
import type { SiteInfo } from "../data/load.ts";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { PROFILE_PRESETS, type ProfileKey } from "../engine/risk.ts";
import { isoDay } from "../ui/format.ts";
import { APOLLO_11, WINDOW_HOURS, customPlace, getScenario, sitePlace, subscribeScenario, type Place } from "./scenario.ts";

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
  return lat >= -90 && lat <= 90 ? customPlace(lat, Number(match[2])) : null;
}

export interface UrlScenario {
  placeA: Place | null;
  placeB: Place | null;
  startMs: number | null;
  slipDays: number;
  windowHours: number | null;
  mastM: number | null;
  profileKey: ProfileKey | null;
}

export function readUrl(sites: SiteInfo[]): UrlScenario {
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date");
  const startMs = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const slip = Number(params.get("slip"));
  const windowHours = Number(params.get("window"));
  const mast = Number(params.get("mast"));
  const profile = params.get("profile");
  return {
    placeA: paramToPlace(params.get("site"), sites),
    placeB: paramToPlace(params.get("compare"), sites),
    startMs: Number.isNaN(startMs) ? null : startMs,
    slipDays: Number.isInteger(slip) && slip > 0 ? slip : 0,
    windowHours: (Object.values(WINDOW_HOURS) as number[]).includes(windowHours) ? windowHours : null,
    mastM: Number.isInteger(mast) && mast >= MAST_RANGE_M.min && mast <= MAST_RANGE_M.max ? mast : null,
    profileKey: profile !== null && Object.hasOwn(PROFILE_PRESETS, profile) ? (profile as ProfileKey) : null,
  };
}

/** Keeps the address bar in step with the scenario. Returns the unsubscribe function. */
export function syncUrl(): () => void {
  let last = "";
  const write = () => {
    const s = getScenario();
    if (!s.limits) return;
    const params = new URLSearchParams();
    if (s.placeA) params.set("site", placeToParam(s.placeA));
    params.set("date", isoDay(s.startMs));
    if (s.placeB && s.placeB.id !== s.placeA?.id) params.set("compare", placeToParam(s.placeB));
    if (s.placeB && s.slipDays > 0) params.set("slip", String(s.slipDays));
    if (s.windowHours !== WINDOW_HOURS.mission) params.set("window", String(s.windowHours));
    if (s.mastM !== MAST_RANGE_M.min) params.set("mast", String(s.mastM));
    if (s.profileKey !== "generic") params.set("profile", s.profileKey);
    const query = params.toString();
    // The store also changes on every playback frame; the URL only when the scenario does.
    if (query === last) return;
    last = query;
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  };
  write();
  return subscribeScenario(write);
}
