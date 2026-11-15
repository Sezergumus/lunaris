// Ready-made scenarios that each show one thing about landing near the lunar south pole.
// A story sets the whole scenario (place, date, comparison, mission parameters) so that what
// it shows does not depend on what was on screen before.
import type { SiteInfo } from "../data/load.ts";
import { MAST_RANGE_M } from "../engine/mast.ts";
import { APOLLO_11, WINDOW_HOURS, actions, sitePlace, type Place } from "./scenario.ts";

export interface Story {
  id: string;
  title: string;
  /** One sentence on what to look at. */
  teaser: string;
  /** Scenario A: a built-in site key. */
  site: string;
  /** Scenario B: a built-in site key or "apollo11"; omitted for a slip of the same site. */
  compare?: string;
  /** Scenario B lands this many days after A. */
  slipDays?: number;
  /** Landing date of scenario A, YYYY-MM-DD (UTC). */
  date: string;
}

export const STORIES: Story[] = [
  {
    id: "slip",
    title: "The launch slips a week",
    teaser: "Same site, landing 7 days later: compare the Sun and the darkness.",
    site: "mons_mouton",
    slipDays: 7,
    date: "2026-12-16",
  },
  {
    id: "ridge-crater",
    title: "Sunlit ridge or crater floor?",
    teaser: "About 20 km apart: a ridge in near-constant sunlight, a floor that never sees the Sun.",
    site: "connecting_ridge",
    compare: "shackleton",
    date: "2026-12-16",
  },
  {
    id: "nearby",
    title: "Is there a better spot nearby?",
    teaser: "The IM-1 landing area: the map shows how the risk changes within 500 m.",
    site: "malapert_a",
    date: "2026-12-16",
  },
  {
    id: "equator",
    title: "Pole versus equator",
    teaser: "Why the south pole Sun skims the horizon while Apollo 11's climbs high.",
    site: "mons_mouton",
    compare: "apollo11",
    date: "2026-12-16",
  },
];

/** Shown on a first visit (no scenario in the link), so the panels are never empty. */
export const OPENING_SITE = "mons_mouton";

function resolve(key: string, sites: SiteInfo[]): Place | null {
  if (key === "apollo11") return APOLLO_11;
  const site = sites.find((s) => s.key === key);
  return site ? sitePlace(site) : null;
}

/** Whether every place the story needs exists in the loaded site list. */
export function storyAvailable(story: Story, sites: SiteInfo[]): boolean {
  return resolve(story.site, sites) !== null && (!story.compare || resolve(story.compare, sites) !== null);
}

/**
 * Applies a story. `choose` selects scenario A the way a click on a site does (it also
 * flies the map there). The mission parameters go back to their defaults first.
 */
export function applyStory(story: Story, sites: SiteInfo[], choose: (place: Place) => void) {
  const placeA = resolve(story.site, sites);
  const placeB = story.compare ? resolve(story.compare, sites) : null;
  if (!placeA) return;
  actions.setProfile("generic");
  actions.setMast(MAST_RANGE_M.min);
  actions.setWindowHours(WINDOW_HOURS.mission);
  actions.clearComparison();
  actions.setStart(Date.parse(`${story.date}T00:00:00Z`));
  actions.setOffsetMs(0);
  choose(placeA);
  if (placeB) actions.compareWith(placeB);
  else if (story.slipDays) actions.slip(story.slipDays);
}
