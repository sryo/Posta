import { toDateInputString } from "../utils";

export interface EventFormTimes {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Round up to the next 30-minute mark, lasting 30 minutes
export function smartEventDefaults(now: Date = new Date()) {
  const startTime = new Date(now);
  if (now.getMinutes() <= 30) {
    startTime.setMinutes(30, 0, 0);
  } else {
    startTime.setHours(startTime.getHours() + 1, 0, 0, 0);
  }
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
  // Derive the date from startTime so rounding past midnight advances the day
  return { date: toDateInputString(startTime), startTime: hhmm(startTime), endTime: hhmm(endTime) };
}

// All-day dates are anchored at UTC noon: the backend formats the UTC date,
// and noon keeps it on the chosen day. The all-day end date is inclusive.
function utcNoon(date: string): number {
  const [y, m, d] = date.split('-').map(n => parseInt(n, 10));
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

export function eventTimesFromForm(form: EventFormTimes): { start: number; end: number } | { error: string } {
  const start = form.allDay ? utcNoon(form.startDate) : new Date(`${form.startDate}T${form.startTime}`).getTime();
  const end = form.allDay ? utcNoon(form.endDate) : new Date(`${form.endDate}T${form.endTime}`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: "Enter a valid start and end" };
  if (end < start) return { error: "End must be after start" };
  return { start, end };
}
