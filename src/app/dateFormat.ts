// Every date and time the app shows, in one locale: the system's unless a
// caller (a test) names another. Day names like "Today" come from the same
// locale as the dates next to them.

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Whole calendar days from `now` to `day`; rounding absorbs DST's 23/25h days
function dayOffset(day: Date, now: Date): number {
  return Math.round((startOfDay(day) - startOfDay(now)) / DAY_MS);
}

function capitalise(text: string, locale?: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function uses12HourClock(locale?: string): boolean {
  return new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12 === true;
}

// A 24-hour clock pads the hour ("09:00"); a 12-hour one doesn't ("9:00 AM")
const hourStyle = (locale?: string) => (uses12HourClock(locale) ? "numeric" as const : "2-digit" as const);

// "2:05 PM" or "14:05", as the locale writes the time
export function formatClock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: hourStyle(locale), minute: "2-digit" }).format(date);
}

// "Today", "Tomorrow", "Yesterday" (or "Hoy", "Mañana"...), null for other days
export function relativeDayName(day: Date, now: Date, locale?: string): string | null {
  const offset = dayOffset(day, now);
  if (Math.abs(offset) > 1) return null;
  return capitalise(new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day"), locale);
}

// "Sep 29", with the weekday or the year when asked
export function formatShortDate(date: Date, locale?: string, { weekday = false, year = false } = {}): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(weekday ? { weekday: "short" as const } : {}),
    ...(year ? { year: "numeric" as const } : {}),
  }).format(date);
}

// "Thu", for a day picker
export function shortWeekday(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
}

// January to December, standalone as a month picker lists them
export function monthNames(locale?: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { month: "long" });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2000, month, 1)));
}

// A day heading: its relative name, else "Thursday, Oct 1"
export function formatDayLabel(day: Date, now: Date, locale?: string): string {
  return relativeDayName(day, now, locale)
    ?? new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric" }).format(day);
}

// A moment: "Today, 12:42 AM", "Sep 22, 10:14 AM", with the year when not this one
export function formatWhen(date: Date, now: Date, locale?: string): string {
  const relative = relativeDayName(date, now, locale);
  if (relative) return `${relative}, ${formatClock(date, locale)}`;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    hour: hourStyle(locale),
    minute: "2-digit",
  }).format(date);
}

// The backend names thread groups in English; the two that are days read
// like the calendar's day headings
export function threadGroupLabel(label: string, locale?: string): string {
  const offset = label === "Today" ? 0 : label === "Yesterday" ? -1 : null;
  if (offset === null) return label;
  return capitalise(new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day"), locale);
}
