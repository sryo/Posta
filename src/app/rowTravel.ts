import { EASE_EXIT, EASE_SETTLE, reducedMotion, settled } from "./motion";
import { measureRows, slideRows } from "./rowMotion";

const listOf = (card: Element) => card.querySelector<HTMLElement>(".card-body");
const rowIn = (list: Element, id: string) => list.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`);
const badgeOf = (card: Element) => card.querySelector<HTMLElement>(".card-header .card-unread-badge");
// More than this many rows acted on at once fold without a copy each
const MAX_CARRIED = 8;

// Where a thread went when an action moved it: called before the change, it
// takes a copy of each acted-on row in `cardId` and notes where every row on
// the board is. `land`, called once the board shows the change, carries each
// copy to the row's place in the card it went to, which makes room for it,
// or, when no card on the board took it and it left its card, slides it
// aside while the gap folds. Counts that changed roll to their new number.
// Null when none of the rows is on screen.
export function liftRows(cardId: string, threadIds: string[]): { land: () => void } | null {
  if (typeof document.body.animate !== "function") return null;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".card[data-id]"));
  const source = cards.find(card => card.dataset.id === cardId);
  const sourceList = source && listOf(source);
  if (!sourceList) return null;
  const departing = threadIds.slice(0, MAX_CARRIED).flatMap(id => {
    const row = rowIn(sourceList, id);
    return row ? [{ id, row: row.cloneNode(true) as HTMLElement, from: row.getBoundingClientRect() }] : [];
  });
  if (departing.length === 0) return null;
  const before = new Map(cards.flatMap(card => {
    const list = listOf(card);
    return list ? [[card.dataset.id!, { rows: measureRows(list), count: badgeOf(card)?.textContent ?? "" }] as const] : [];
  }));

  return {
    land() {
      const reduce = reducedMotion();
      const shown = (card: string) => document.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(card)}"]`);
      const left = new Set<string>();
      const arrivals: { id: string; row: HTMLElement; to: DOMRect }[] = [];
      const gone = (id: string) => !rowIn(listOf(shown(cardId)!) ?? sourceList, id);
      // Where each row went: a card that didn't have it before
      for (const { id } of departing) {
        if (gone(id)) left.add(id);
        for (const [otherId, was] of before) {
          if (otherId === cardId || was.rows.has(id)) continue;
          const list = listOf(shown(otherId) ?? document.body);
          const row = list && rowIn(list, id);
          if (row) arrivals.push({ id, row, to: row.getBoundingClientRect() });
        }
      }
      if (left.size === 0 && arrivals.length === 0) return;

      const carried = arrivals.length > 0;
      // The gaps: the card it left closes after it, the cards it went to open
      for (const [id, was] of before) {
        const list = listOf(shown(id) ?? document.body);
        if (!list || reduce) continue;
        const entering = new Set(arrivals.filter(a => list.contains(a.row)).map(a => a.id));
        if (id === cardId && left.size === 0) continue;
        if (id !== cardId && entering.size === 0) continue;
        slideRows(list, was.rows, carried ? { entering, delay: 60, duration: 240 } : { entering, delay: 140, duration: 200 });
      }

      for (const { id, row, from } of departing) {
        const arrival = arrivals.find(a => a.id === id);
        if (!arrival && !left.has(id)) continue;
        const copy = travelling(row, from);
        if (reduce) {
          if (left.has(id)) settled(copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" })).then(() => copy.remove());
          else copy.remove();
          arrival?.row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
          continue;
        }
        if (!arrival) {
          settled(copy.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(24px)", opacity: 0 }], {
            duration: 140, easing: EASE_EXIT, fill: "forwards",
          })).then(() => copy.remove());
          continue;
        }
        const dx = arrival.to.left - from.left;
        const dy = arrival.to.top - from.top;
        arrival.row.style.visibility = "hidden";
        settled(copy.animate([
          { transform: "translate(0px, 0px) scale(1)", boxShadow: "none" },
          { offset: 0.16, transform: "translate(0px, -3px) scale(1.02)", boxShadow: "var(--shadow-md)" },
          { offset: 0.8, boxShadow: "var(--shadow-sm)" },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, boxShadow: "none" },
        ], { duration: 360, easing: EASE_SETTLE, fill: "forwards" })).then(() => {
          copy.remove();
          arrival.row.style.visibility = "";
        });
      }

      if (reduce) return;
      for (const [id, was] of before) {
        const badge = shown(id) && badgeOf(shown(id)!);
        const now = badge?.textContent ?? "";
        if (!badge || now === was.count) continue;
        const up = Number(now) > Number(was.count || 0);
        badge.animate([{ transform: `translateY(${up ? 60 : -60}%)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: EASE_SETTLE });
      }
    },
  };
}

// A row's copy, fixed where the row was, over the board
function travelling(row: HTMLElement, from: DOMRect): HTMLElement {
  row.querySelectorAll(".thread-checkbox-wrap, .quick-reply-box").forEach(el => el.remove());
  row.classList.add("row-traveller");
  row.classList.remove("focused", "selected");
  row.removeAttribute("tabindex");
  row.removeAttribute("role");
  row.removeAttribute("aria-label");
  row.removeAttribute("data-thread-id");
  row.setAttribute("aria-hidden", "true");
  row.style.left = `${from.left}px`;
  row.style.top = `${from.top}px`;
  row.style.width = `${from.width}px`;
  row.style.height = `${from.height}px`;
  document.body.append(row);
  return row;
}
