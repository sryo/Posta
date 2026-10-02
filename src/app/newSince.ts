import { createStore } from "solid-js/store";
import { onCleanup } from "solid-js";
import { safeGetJSON, safeSetJSON } from "../shared/storage";
import { dayOffset, formatClock, formatShortDate, localeOrApp } from "./dateFormat";

const AWAY_MS = 3_600_000;
const EVENING_HOUR = 18;
const KEY = "lastLook";

// When you last looked, said the way you'd remember it
function sincePhrase(lastLook: Date, now: Date, locale?: string): string {
  const offset = dayOffset(lastLook, now);
  if (offset === 0) return `since ${formatClock(lastLook, locale)}`;
  if (offset === -1) return lastLook.getHours() >= EVENING_HOUR ? "since last night" : "since yesterday";
  if (offset >= -6) return `since ${new Intl.DateTimeFormat(localeOrApp(locale), { weekday: "long" }).format(lastLook)}`;
  return `since ${formatShortDate(lastLook, locale, { year: lastLook.getFullYear() !== now.getFullYear() })}`;
}

// "6 new since last night": what arrived after a look an hour or more ago
export function newSinceLine(dates: number[], lastLook: number | null, now: Date, locale?: string): string | null {
  if (lastLook === null || now.getTime() - lastLook < AWAY_MS) return null;
  const count = dates.filter(d => d > lastLook).length;
  if (count === 0) return null;
  return `${count} new ${sincePhrase(new Date(lastLook), now, locale)}`;
}

// When each card was last looked at, kept on this Mac. Leaving the window
// counts as a look at every card; coming back an hour or more later offers
// that moment as the card's `since` until the card is scrolled or a thread
// in it is opened.
export function createLastLook(cardIds: () => string[], now: () => number = Date.now) {
  const looked: Record<string, number> = safeGetJSON(KEY, {});
  const [since, setSince] = createStore<Record<string, number | null>>({ ...looked });
  const save = () => safeSetJSON(KEY, looked);

  const look = (cardId: string) => {
    looked[cardId] = now();
    save();
    if (since[cardId] != null) setSince(cardId, null);
  };
  const leave = () => {
    const at = now();
    const ids = cardIds();
    if (ids.length > 0) for (const id of Object.keys(looked)) if (!ids.includes(id)) delete looked[id];
    for (const id of ids) looked[id] = at;
    save();
  };
  const comeBack = () => {
    const at = now();
    for (const id of cardIds()) {
      const last = looked[id];
      if (last !== undefined && at - last >= AWAY_MS) setSince(id, last);
    }
  };

  window.addEventListener("blur", leave);
  window.addEventListener("focus", comeBack);
  window.addEventListener("pagehide", leave);
  onCleanup(() => {
    window.removeEventListener("blur", leave);
    window.removeEventListener("focus", comeBack);
    window.removeEventListener("pagehide", leave);
  });

  return { since: (cardId: string): number | null => since[cardId] ?? null, look };
}
