// Every date and time the app shows, in one locale: appLocale() unless a
// caller (a test) names another. Day names like "Today" come from the same
// locale as the dates next to them.

const DAY_MS = 86_400_000;

// The app's copy is English, so month and day names are too ("20 ago" would
// read as English); the system region still sets the order and the clock.
// A region English has no data for falls back to international English.
export function appLocale(system: string): string {
  const systemLocale = new Intl.Locale(system);
  if (systemLocale.language === "en") return system;
  const region = systemLocale.maximize().region;
  const regional = region ? `en-${region}` : "en-001";
  const resolved = new Intl.Locale(new Intl.DateTimeFormat(regional).resolvedOptions().locale);
  const base = resolved.region ? regional : "en-001";
  const { hourCycle } = new Intl.DateTimeFormat(system, { hour: "numeric" }).resolvedOptions() as { hourCycle?: Intl.LocaleOptions["hourCycle"] };
  return new Intl.Locale(base, hourCycle ? { hourCycle } : {}).toString();
}

let cachedSystem: string | undefined;
let cachedLocale = "";
export function localeOrApp(locale?: string): string {
  if (locale) return locale;
  const system = navigator.language;
  if (system !== cachedSystem) {
    cachedSystem = system;
    cachedLocale = appLocale(system);
  }
  return cachedLocale;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Whole calendar days from `now` to `day`; rounding absorbs DST's 23/25h days
export function dayOffset(day: Date, now: Date): number {
  return Math.round((startOfDay(day) - startOfDay(now)) / DAY_MS);
}

export function capitalise(text: string, locale?: string): string {
  return text.charAt(0).toLocaleUpperCase(localeOrApp(locale)) + text.slice(1);
}

export function uses12HourClock(locale?: string): boolean {
  return new Intl.DateTimeFormat(localeOrApp(locale), { hour: "numeric" }).resolvedOptions().hour12 === true;
}

// A 24-hour clock pads the hour ("09:00"); a 12-hour one doesn't ("9:00 AM")
const hourStyle = (locale?: string) => (uses12HourClock(locale) ? "numeric" as const : "2-digit" as const);

// "2:05 PM" or "14:05", as the locale writes the time
export function formatClock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(localeOrApp(locale), { hour: hourStyle(locale), minute: "2-digit" }).format(date);
}

// "Today", "Tomorrow", "Yesterday" (or "Hoy", "Mañana"...), null for other days
export function relativeDayName(day: Date, now: Date, locale?: string): string | null {
  const offset = dayOffset(day, now);
  if (Math.abs(offset) > 1) return null;
  return capitalise(new Intl.RelativeTimeFormat(localeOrApp(locale), { numeric: "auto" }).format(offset, "day"), locale);
}

// "Sep 29", with the weekday or the year when asked
export function formatShortDate(date: Date, locale?: string, { weekday = false, year = false } = {}): string {
  return new Intl.DateTimeFormat(localeOrApp(locale), {
    month: "short",
    day: "numeric",
    ...(weekday ? { weekday: "short" as const } : {}),
    ...(year ? { year: "numeric" as const } : {}),
  }).format(date);
}

// "Thu", for a day picker
export function shortWeekday(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "short" }).format(date);
}

// January to December, standalone as a month picker lists them
export function monthNames(locale?: string): string[] {
  const format = new Intl.DateTimeFormat(localeOrApp(locale), { month: "long" });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2000, month, 1)));
}

// A day heading: its relative name, else "Thursday, Oct 1"
export function formatDayLabel(day: Date, now: Date, locale?: string): string {
  return relativeDayName(day, now, locale)
    ?? new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "long", month: "short", day: "numeric" }).format(day);
}

// A moment: "Today, 12:42 AM", "Sep 22, 10:14 AM", with the year when not this one
export function formatWhen(date: Date, now: Date, locale?: string): string {
  const relative = relativeDayName(date, now, locale);
  if (relative) return `${relative}, ${formatClock(date, locale)}`;
  return new Intl.DateTimeFormat(localeOrApp(locale), {
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
  return capitalise(new Intl.RelativeTimeFormat(localeOrApp(locale), { numeric: "auto" }).format(offset, "day"), locale);
}
