import { isWritableCalendar } from "./eventActions";
import { safeGetItem, safeSetItem } from "../shared/storage";

type CalendarChoice = { id: string; is_primary: boolean; access_role: string };

const storageKey = (accountId: string) => `event_calendar_${accountId}`;

// The calendar a new event goes to: the one used last, then the primary one,
// then any the user can write to
export function defaultCalendarId(calendars: CalendarChoice[], lastUsed: string | null): string | null {
  const writable = calendars.filter(isWritableCalendar);
  return (writable.find(c => c.id === lastUsed) ?? writable.find(c => c.is_primary) ?? writable[0])?.id ?? null;
}

export function lastUsedCalendar(accountId: string): string | null {
  return safeGetItem(storageKey(accountId));
}

export function rememberCalendar(accountId: string, calendarId: string): void {
  safeSetItem(storageKey(accountId), calendarId);
}
