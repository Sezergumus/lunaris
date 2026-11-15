// The Explorer's introduction and guided tour. Each entry is a story (place, date,
// comparison) like state/stories.ts, plus the words that go with it. The words are written
// at run time from the engine's numbers: no result is typed into a sentence.
import type { SiteInfo } from "../data/load.ts";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { formatDistance, surfaceDistanceM } from "../geo/polar.ts";
import { APOLLO_11, actions, placeTitle, sitePlace, type Place } from "../state/scenario.ts";
import type { ScenarioView } from "../state/view.ts";
import { formatUtcDate } from "../ui/format.ts";
import { days, degrees, earthFacts, missionScore, sunFacts } from "./facts.ts";

/** One synodic month: the length of a day and night on the Moon (a constant, not a result). */
export const LUNAR_DAY_HOURS = 708;

export interface Scene {
  site: string;
  /** Scenario B: a site key or "apollo11". */
  compare?: string;
  /** Scenario B is the same site this many days later. */
  slipDays?: number;
  /** Landing date, YYYY-MM-DD (UTC). */
  date: string;
  windowHours: number;
  /** Playback speed, simulated hours per second. */
  speed: number;
  /** Start playing at once (default); the game waits for its Land button. */
  autoplay?: boolean;
}

export interface Caption {
  lead: string;
  detail?: string;
}

export interface TourStep {
  id: string;
  title: string;
  scene: Scene;
  /** Scenario B is the best nearby spot of A (from the grid), added once it is scored. */
  nearbySpot?: boolean;
  /** Draw the pole-versus-equator inset. */
  inset?: boolean;
  /** Where the camera turns when the step opens. */
  look: "sun" | "earth";
  caption: (a: ScenarioView, b: ScenarioView | null) => Caption;
}

const DAY_MS = 86400000;
const pct = (share: number) => `${Math.round(share * 100)}%`;
const risk = (view: ScenarioView) => {
  const scored = missionScore(view);
  return scored ? `risk ${scored.score.overall.toFixed(0)} (${scored.score.level})` : "no score (window leaves the data)";
};

export const INTRO: { scene: Scene; caption: (a: ScenarioView, b: ScenarioView | null, offsetHours: number) => Caption } = {
  scene: { site: "mons_mouton", compare: "apollo11", date: "2026-12-16", windowHours: LUNAR_DAY_HOURS, speed: 24 },
  caption(a, b, offsetHours) {
    const sun = sunFacts(a, LUNAR_DAY_HOURS);
    const earth = earthFacts(a, LUNAR_DAY_HOURS);
    const where = `${placeTitle(a.data.place)}, ${formatDistance(surfaceDistanceM(a.data.lat, a.data.lon, -90, 0))} from the south pole`;
    const share = offsetHours / LUNAR_DAY_HOURS;
    if (share < 0.25) {
      return {
        lead: `You are standing on ${where}. In this whole lunar day the Sun never climbs higher than ${degrees(sun.maxElevationDeg)}.`,
        detail: "Drag to look around. The Sun circles the sky just above the skyline.",
      };
    }
    if (share < 0.5) {
      return {
        lead: `One day and night here lasts ${days(LUNAR_DAY_HOURS)} Earth days. Watch the Sun go once around the horizon.`,
        detail: `The longest stretch without any Sun is ${days(sun.longestDarkH)} days.`,
      };
    }
    if (share < 0.75) {
      return {
        lead: `The Earth hangs in the ${earth.direction}, between ${degrees(earth.minElevationDeg)} and ${degrees(earth.maxElevationDeg)} above the horizon, and hardly moves.`,
        detail: "A radio link to Earth needs it above the skyline.",
      };
    }
    if (!b) return { lead: "Near the equator the Sun climbs high every day." };
    const equator = sunFacts(b, LUNAR_DAY_HOURS);
    return {
      lead: `At the Apollo 11 site near the equator the Sun climbs to ${degrees(equator.maxElevationDeg, 0)}; here only to ${degrees(sun.maxElevationDeg)}.`,
      detail: "With a Sun this low, a small hill decides between light and darkness.",
    };
  },
};

export const TOUR: TourStep[] = [
  {
    id: "pole",
    title: "Why the south pole?",
    scene: { site: "mons_mouton", compare: "apollo11", date: "2026-12-16", windowHours: 336, speed: 24 },
    inset: true,
    look: "sun",
    caption(a, b) {
      const here = sunFacts(a, 336);
      const there = b ? sunFacts(b, 336) : null;
      return {
        lead: `At ${placeTitle(a.data.place)} the Sun never gets higher than ${degrees(here.maxElevationDeg)} in these 14 days${there ? `; at the Apollo 11 site it reaches ${degrees(there.maxElevationDeg, 0)}` : ""}.`,
        detail: `But it hardly sets: it is above the skyline ${pct(here.upHours / here.hours)} of the time. Switch to B to stand at the equator.`,
      };
    },
  },
  {
    id: "ridge",
    title: "Ridge or crater floor?",
    scene: { site: "connecting_ridge", compare: "shackleton", date: "2026-12-16", windowHours: 336, speed: 24 },
    look: "sun",
    caption(a, b) {
      const ridge = sunFacts(a, 336);
      if (!b) return { lead: `On the ridge the Sun is above the skyline ${pct(ridge.upHours / ridge.hours)} of these 14 days.` };
      const floor = sunFacts(b, 336);
      const walls = b.data.horizon ? Math.min(...Array.from(b.data.horizon.horizonDeg)) : 0;
      const apart = formatDistance(surfaceDistanceM(a.data.lat, a.data.lon, b.data.lat, b.data.lon));
      return {
        lead: `On the ridge the Sun is above the skyline ${pct(ridge.upHours / ridge.hours)} of these 14 days; on the crater floor ${apart} away, ${pct(floor.upHours / floor.hours)}.`,
        detail: `The crater walls rise at least ${degrees(walls)} all around, higher than the Sun ever gets. Switch to B to stand on the floor.`,
      };
    },
  },
  {
    id: "slip",
    title: "A one-week slip",
    scene: { site: "mons_mouton", slipDays: 7, date: "2026-12-16", windowHours: 336, speed: 24 },
    look: "sun",
    caption(a, b) {
      if (!b) return { lead: `Landing on ${formatUtcDate(a.startMs)}: ${risk(a)}.` };
      const later = missionScore(b);
      const dark = later ? later.window.power.longest_darkness_h : 0;
      const battery = b.data.series.profile.battery_survival_h;
      return {
        lead: `Landing on ${formatUtcDate(a.startMs)}: ${risk(a)}. The same landing ${Math.round((b.startMs - a.startMs) / DAY_MS)} days later: ${risk(b)}.`,
        detail: `A week later the mission runs into the night: ${days(dark)} days of darkness, but the battery lasts ${battery} h. Switch to B and press play.`,
      };
    },
  },
  {
    id: "nearby",
    title: "500 m matters",
    scene: { site: "malapert_a", date: "2026-12-16", windowHours: 336, speed: 24 },
    nearbySpot: true,
    look: "sun",
    caption(a, b) {
      const here = missionScore(a);
      const lead = `${placeTitle(a.data.place)}, near where IM-1 landed: ${risk(a)}${here ? `, usable Sun ${here.window.power.sunlit_pct.toFixed(0)}%` : ""}.`;
      if (!b) return { lead, detail: "Scoring the points around it…" };
      const there = missionScore(b);
      const apart = formatDistance(surfaceDistanceM(a.data.lat, a.data.lon, b.data.lat, b.data.lon));
      return {
        lead,
        detail: `The best point within ±500 m, ${apart} away: ${risk(b)}${there ? `, usable Sun ${there.window.power.sunlit_pct.toFixed(0)}%` : ""}. Switch to B to stand there.`,
      };
    },
  },
];

function resolve(key: string, sites: SiteInfo[]): Place | null {
  if (key === "apollo11") return APOLLO_11;
  const site = sites.find((s) => s.key === key);
  return site ? sitePlace(site) : null;
}

/** Sets up a scene from scratch (mission parameters back to their defaults) and plays it. */
export function applyScene(scene: Scene, sites: SiteInfo[]) {
  const placeA = resolve(scene.site, sites);
  if (!placeA) return;
  actions.setPlaying(false);
  actions.setProfile("generic");
  actions.setMast(MAST_RANGE_M.min);
  actions.setWindowHours(scene.windowHours);
  actions.clearComparison();
  actions.setStart(Date.parse(`${scene.date}T00:00:00Z`));
  actions.setOffsetMs(0);
  actions.setSpeed(scene.speed);
  actions.selectPlace(placeA);
  const placeB = scene.compare ? resolve(scene.compare, sites) : null;
  if (placeB) actions.compareWith(placeB);
  else if (scene.slipDays) actions.slip(scene.slipDays);
  if (scene.autoplay !== false) actions.setPlaying(true);
}

/** The landing game starts at the IM-1 area, where the site itself does not survive 16 Dec. */
export const GAME_SCENE: Scene = { site: "malapert_a", date: "2026-12-16", windowHours: 336, speed: 72, autoplay: false };
