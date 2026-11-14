import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { DayPicker } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import "react-day-picker/style.css";
import { Segmented } from "./Segmented.tsx";
import { formatUtcDate } from "./format.ts";

interface DatePickerProps {
  /** Selected instant, milliseconds since the Unix epoch. Only its UTC calendar day is shown. */
  valueMs: number;
  /** First and last selectable instants. */
  minMs: number;
  maxMs: number;
  /** Receives midnight UTC of the chosen day. */
  onChange: (ms: number) => void;
  /** Accessible name of the trigger, e.g. "Landing date". */
  label: string;
}

// The calendar works on local dates; mission time is UTC. A UTC day is shown as the local
// date with the same year, month and day, and converted back the same way.
const utcDayAsLocal = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const localDayAsUtc = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

export function DatePicker({ valueMs, minMs, maxMs, onChange, label }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = utcDayAsLocal(valueMs);
  const [month, setMonth] = useState(selected);
  const first = useMemo(() => utcDayAsLocal(minMs), [minMs]);
  const last = useMemo(() => utcDayAsLocal(maxMs), [maxMs]);
  const years = useMemo(() => {
    const list: string[] = [];
    for (let y = first.getFullYear(); y <= last.getFullYear(); y++) list.push(String(y));
    return list;
  }, [first, last]);

  const showYear = (year: string) => {
    const target = new Date(Number(year), month.getMonth(), 1);
    setMonth(target < first ? first : target > last ? last : target);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(selected);
        setOpen(next);
      }}
    >
      <Popover.Trigger className="btn btn--filled btn--md date-trigger" aria-label={`${label}: ${formatUtcDate(valueMs)}`}>
        <CalendarDays aria-hidden="true" />
        <span>{formatUtcDate(valueMs)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover glass glass--thick" side="top" align="start" sideOffset={10} collisionPadding={12}>
          {years.length > 1 ? (
            <Segmented
              label="Year"
              size="sm"
              value={String(month.getFullYear())}
              onChange={showYear}
              options={years.map((year) => ({ value: year, label: year }))}
            />
          ) : null}
          <DayPicker
            mode="single"
            required
            selected={selected}
            onSelect={(day: Date) => {
              onChange(localDayAsUtc(day));
              setOpen(false);
            }}
            month={month}
            onMonthChange={setMonth}
            startMonth={first}
            endMonth={last}
            disabled={{ before: first, after: last }}
            weekStartsOn={1}
            showOutsideDays
          />
          <p className="popover__note">Dates are UTC.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
