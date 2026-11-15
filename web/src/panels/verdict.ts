// One plain-language sentence for a risk score: what the number means and what drives it,
// for readers who do not know the limits behind the three bars.
import { limitRisk, shortfallRisk, type MissionWindow, type Profile, type RiskLevel, type Score } from "../engine/risk.ts";
import { formatHours } from "../ui/format.ts";

export interface Verdict {
  /** With its punctuation: "Not recommended:", or "Looks good." before a separate sentence. */
  headline: string;
  reason: string;
}

const HEADLINE: Record<RiskLevel, string> = { low: "Looks good", medium: "Risky", high: "Not recommended" };

/** Below this a low score is shown with the mission's good news instead of its tightest margin. */
const MARGIN_WORTH_NAMING = 10;

const pct = (value: number) => `${value.toFixed(value > 99 && value < 100 ? 1 : 0)}%`;

/** The largest of the three reasons the link was down. */
function outageCause(window: MissionWindow): string {
  const { terrain_occultation_h: terrain, station_gap_h: station, conjunction_h: conjunction } = window.comm;
  if (terrain >= station && terrain >= conjunction) return "Earth behind terrain";
  return station >= conjunction ? "no ground station in view" : "Sun next to Earth";
}

/** Why the category scores what it does, in the words of whichever of its two tests is worse. */
function categoryReason(category: Score["driver"], window: MissionWindow, profile: Profile, slopeP95Deg: number | null): string {
  const { power, comm } = window;
  if (category === "power") {
    const darkness = limitRisk(power.longest_darkness_h, profile.battery_survival_h);
    const shortfall = shortfallRisk(power.sunlit_pct, profile.min_sunlit_pct);
    if (darkness >= shortfall) return `${formatHours(power.longest_darkness_h)} without usable Sun; the battery lasts ${profile.battery_survival_h} h`;
    return `usable Sun only ${pct(power.sunlit_pct)} of the time; ${profile.min_sunlit_pct}% needed`;
  }
  if (category === "comm") {
    const outage = limitRisk(comm.longest_outage_h, profile.max_comm_outage_h);
    const daily = shortfallRisk(comm.worst_day_contact_h, profile.min_daily_contact_h);
    if (comm.available_pct === 0) return `no direct contact with Earth (${outageCause(window)})`;
    if (outage >= daily) return `no contact with Earth for up to ${formatHours(comm.longest_outage_h)} (${outageCause(window)}); limit ${profile.max_comm_outage_h} h`;
    return `only ${formatHours(comm.worst_day_contact_h)} of Earth contact on the worst day; ${profile.min_daily_contact_h} h needed`;
  }
  return `slopes reach ${(slopeP95Deg ?? 0).toFixed(1)}° in the landing area; limit ${profile.max_slope_deg}°`;
}

export function verdict(window: MissionWindow, score: Score, profile: Profile, slopeP95Deg: number | null): Verdict {
  const headline = HEADLINE[score.level];
  if (score.level === "low" && score.overall < MARGIN_WORTH_NAMING) {
    return { headline: `${headline}:`, reason: `usable Sun ${pct(window.power.sunlit_pct)}, Earth contact ${pct(window.comm.available_pct)}.` };
  }
  const reason = categoryReason(score.driver, window, profile, slopeP95Deg);
  if (score.level === "low") return { headline: `${headline}.`, reason: `Tightest margin: ${reason}.` };
  return { headline: `${headline}:`, reason: `${reason}.` };
}
