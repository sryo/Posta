import { dayOffset, formatDayLabel, localeOrApp, relativeDayName, threadGroupLabel } from "./dateFormat";

export type GroupHeading = { text: string; oneDay: boolean };

const DAY_BUCKETS = new Set(["This week", "Last 30 days", "Older"]);

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);
const sameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

// A date bucket's heading named from the days its threads fall on: the day
// itself when there is one ("Tuesday"), else the span as a person would say
// it ("Earlier this week", "In September", "Since Sep 3"). oneDay says the
// heading already names the day, so rows can show the clock.
export function threadGroupHeading(label: string, dates: number[], now: Date, locale?: string): GroupHeading {
  if (label === "Today" || label === "Yesterday") return { text: threadGroupLabel(label, locale), oneDay: true };
  if (!DAY_BUCKETS.has(label) || dates.length === 0) return { text: label, oneDay: false };

  const loc = localeOrApp(locale);
  const days = [...new Set(dates.map(startOfDay))].sort((a, b) => a - b).map(d => new Date(d));
  const oldest = days[0];
  const weekday = (d: Date) => new Intl.DateTimeFormat(loc, { weekday: "long" }).format(d);
  const month = (d: Date) => new Intl.DateTimeFormat(loc, { month: "long" }).format(d);
  const span = (text: string): GroupHeading => ({ text, oneDay: false });

  if (days.length === 1) {
    const text = relativeDayName(oldest, now, locale)
      ?? (dayOffset(oldest, now) >= -6 ? weekday(oldest) : formatDayLabel(oldest, now, locale));
    return { text, oneDay: true };
  }

  const oneMonth = days.every(d => sameMonth(d, oldest));

  if (label === "This week") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return span(oldest >= monday ? "Earlier this week" : `Since last ${weekday(oldest)}`);
  }

  if (label === "Last 30 days") {
    if (oneMonth) return span(sameMonth(oldest, now) ? `Earlier in ${month(now)}` : `In ${month(oldest)}`);
    return span(`Since ${new Intl.DateTimeFormat(loc, { month: "short", day: "numeric" }).format(oldest)}`);
  }

  const year = oldest.getFullYear();
  if (oneMonth) return span(`In ${month(oldest)}${year !== now.getFullYear() ? ` ${year}` : ""}`);
  if (days.every(d => d.getFullYear() === year)) return span(year === now.getFullYear() ? `Earlier in ${year}` : `In ${year}`);
  return span(label);
}
