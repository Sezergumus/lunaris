// Mission limits the user can change: the numbers the risk score is judged against.
// A preset (engine/risk.ts, PROFILE_PRESETS) sets them; the sliders override single values.
import { presetProfile, type Profile, type ProfileKey } from "../engine/risk.ts";

export type LimitKey = "battery_survival_h" | "min_sunlit_pct" | "max_comm_outage_h" | "min_daily_contact_h" | "max_slope_deg";

export interface LimitSpec {
  key: LimitKey;
  /** Query parameter that carries an overridden value. */
  param: string;
  category: "Power" | "Comm" | "Surface";
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** Ranges start above zero where the score divides by the limit. */
export const LIMITS: LimitSpec[] = [
  { key: "battery_survival_h", param: "dark", category: "Power", label: "Darkness survived", hint: "longest time without usable Sun", unit: "h", min: 2, max: 400, step: 2 },
  { key: "min_sunlit_pct", param: "sun", category: "Power", label: "Usable Sun needed", hint: "share of the mission", unit: "%", min: 5, max: 100, step: 5 },
  { key: "max_comm_outage_h", param: "outage", category: "Comm", label: "Longest outage", hint: "time without an Earth link", unit: "h", min: 1, max: 96, step: 1 },
  { key: "min_daily_contact_h", param: "contact", category: "Comm", label: "Contact per day", hint: "in every 24 h", unit: "h", min: 1, max: 24, step: 1 },
  { key: "max_slope_deg", param: "slope", category: "Surface", label: "Slope limit", hint: "95th percentile at the site", unit: "°", min: 3, max: 30, step: 1 },
];

export type LimitOverrides = Partial<Pick<Profile, LimitKey>>;

/** The profile in use: the preset with the user's overrides on top. */
export function effectiveProfile(key: ProfileKey, overrides: LimitOverrides): Profile {
  return { ...presetProfile(key), ...overrides };
}
