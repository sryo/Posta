// The handstamp between two letters of a thread that lay quiet a long time,
// and the line a reply to a long-quiet thread opens with.

import { MONTHS } from "./postmark";

const TRANSIT_DAYS = 90;
const MONTHS_UNTIL_YEARS = 24;
const LAST_LETTER_MONTHS = 12;
const DAY_MS = 864e5;

export type Transit = {
  // "14 MONTHS", the stamp's middle line
  span: string;
  // "AUG 2025 – OCT 2026"
  range: string;
  // "14 months between letters.", its accessible name
  label: string;
};

// Whole calendar months, so 31 Aug to 1 Oct is one
export function monthsBetween(earlier: Date, later: Date): number {
  const months = (later.getFullYear() - earlier.getFullYear()) * 12 + later.getMonth() - earlier.getMonth();
  return later.getDate() < earlier.getDate() ? months - 1 : months;
}

// Calendar days, so the hour each was sent and daylight saving don't count
function daysBetween(earlier: Date, later: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(later) - midnight(earlier)) / DAY_MS);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const stampMonth = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Whole months under two years, then whole years; null under 90 days, which
// is always at least two months, so the stamp never counts weeks
export function transitGap(earlier: Date, later: Date): Transit | null {
  if (daysBetween(earlier, later) < TRANSIT_DAYS) return null;
  const months = monthsBetween(earlier, later);
  const words = months < MONTHS_UNTIL_YEARS ? plural(months, "month") : plural(Math.floor(months / 12), "year");
  return {
    span: words.toUpperCase(),
    range: `${stampMonth(earlier)} – ${stampMonth(later)}`,
    label: `${words.charAt(0).toUpperCase()}${words.slice(1)} between letters.`,
  };
}

// The gap shown before each message, by thread position. A hidden message
// never carries a stamp but still broke the silence on its date, and a stamp
// needs a shown message above it to join.
export function transitGaps(dates: (Date | null)[], hidden: boolean[]): (Transit | null)[] {
  let latest: Date | null = null;
  let shownAbove = false;
  return dates.map((date, i) => {
    const gap = date && latest && shownAbove && !hidden[i] ? transitGap(latest, date) : null;
    if (date && (!latest || date > latest)) latest = date;
    if (!hidden[i]) shownAbove = true;
    return gap;
  });
}

export function latestDate(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((latest, d) => (d && (!latest || d > latest) ? d : latest), null);
}

// "Last letter here: Aug 2025." once the thread's last letter is a year old
export function lastLetterLine(last: Date | null, now: Date): string | null {
  if (!last || monthsBetween(last, now) < LAST_LETTER_MONTHS) return null;
  const month = MONTHS[last.getMonth()];
  return `Last letter here: ${month.charAt(0)}${month.slice(1).toLowerCase()} ${last.getFullYear()}.`;
}
