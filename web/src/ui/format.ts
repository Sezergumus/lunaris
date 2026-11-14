// Text formatting shared by the panels. All mission times are UTC.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "16 Dec 2026" */
export function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "16 Dec" */
export function formatUtcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "16 Dec 2026, 14:00 UTC" */
export function formatUtcDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatUtcDate(ms)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "30 Dec, 08:27 UTC" */
export function formatUtcDayTime(ms: number): string {
  const d = new Date(ms);
  return `${formatUtcDay(ms)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "2026-12-16" (for URLs). */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A time span in its two most significant units: "14 d 8 h", "5 h 12 min", "9 min".
 * Rounded to the minute.
 */
export function formatDuration(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Whole-hour spans as the risk model counts them: "0 h", "32 h", "6.6 d". */
export function formatHours(hours: number): string {
  return hours < 48 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1)} d`;
}

/** Signed angle with a real minus sign: "+1.42°", "−0.31°". */
export function formatAngle(deg: number, digits = 2): string {
  const text = Math.abs(deg).toFixed(digits);
  return `${deg < 0 && Number(text) !== 0 ? "−" : "+"}${text}°`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)} %`;
}

/** Decimal number from user text; accepts a comma as the decimal sign. NaN if it is not a number. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(",", ".");
  return /^-?\d+(\.\d*)?$|^-?\.\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}
