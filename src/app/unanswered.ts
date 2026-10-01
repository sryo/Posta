import type { Thread } from "../api/tauri";
import { extractEmail } from "../utils";
import { dayOffset, formatShortDate, localeOrApp } from "./dateFormat";
import { isRobot } from "./people";

// Weekdays after `from`'s day, up to and including `now`'s
function workingDaysSince(from: Date, now: Date): number {
  let count = 0;
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1); dayOffset(d, now) <= 0; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

// A read inbox thread a person wrote last, two working days or more ago:
// "Unanswered since Friday", "for a week", "for two weeks", then the date
export function unansweredLine(thread: Thread, ownEmails: readonly string[], now: Date, locale?: string): string | null {
  const sender = thread.last_sender;
  if (!sender || thread.last_from_list || thread.unread_count > 0 || thread.calendar_event) return null;
  if (!thread.labels.includes("INBOX")) return null;
  const email = extractEmail(sender).toLowerCase();
  if (ownEmails.some(own => own.toLowerCase() === email) || isRobot(sender)) return null;

  const wrote = new Date(thread.last_message_date);
  if (workingDaysSince(wrote, now) < 2) return null;
  const days = -dayOffset(wrote, now);
  if (days < 7) return `Unanswered since ${new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "long" }).format(wrote)}`;
  if (days < 14) return "Unanswered for a week";
  if (days < 21) return "Unanswered for two weeks";
  return `Unanswered since ${formatShortDate(wrote, locale, { year: wrote.getFullYear() !== now.getFullYear() })}`;
}
