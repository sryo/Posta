import { extractEmail, extractName } from "../utils";
import { formatClock, localeOrApp } from "./dateFormat";

type NameFor = (email: string) => string | undefined;

// The people an address list reaches, by first name where one is known
// (the contact's own name first), else by address; the user and repeats left out
export function firstNames(addresses: readonly string[], ownEmails: readonly string[], nameFor?: NameFor): string[] {
  const seen = new Set(ownEmails.map(e => e.toLowerCase()));
  const names: string[] = [];
  for (const address of addresses) {
    const email = extractEmail(address).trim();
    const key = email.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const name = nameFor?.(key) || extractName(address);
    names.push(name?.split(/\s+/)[0] || email);
  }
  return names;
}

// "Ana", "Ana and Ben", "Ana, Ben and Cleo", "Ana, Ben and 3 others"
export function namesLine(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2 || names.length === 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

// The reply box's placeholder, naming who the reply goes to
export function replyPlaceholder(addresses: readonly string[], ownEmails: readonly string[], nameFor?: NameFor): string | null {
  const names = firstNames(addresses, ownEmails, nameFor);
  return names.length > 0 ? `Reply to ${namesLine(names)}…` : null;
}

const LATE_FROM = 22;
const LATE_UNTIL = 6;

// "to Ana", with the day at the weekend and the time from 10 PM to 6 AM:
// "to Ana on Sunday at 11:48 PM"
export function sendingTo(addresses: readonly string[], ownEmails: readonly string[], now: Date, nameFor?: NameFor, locale?: string): string {
  const names = firstNames(addresses, ownEmails, nameFor);
  if (names.length === 0) return "";
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const late = now.getHours() >= LATE_FROM || now.getHours() < LATE_UNTIL;
  const day = weekend ? ` on ${new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "long" }).format(now)}` : "";
  const time = late ? ` at ${formatClock(now, locale)}` : "";
  return `to ${namesLine(names)}${day}${time}`;
}
