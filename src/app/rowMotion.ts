import { EASE_SETTLE, reducedMotion, settled } from "./motion";

// Where each row of a list sits in it, by thread id, measured from the top
// of its content (so a scroll between two measurements doesn't count)
export function measureRows(list: Element): Map<string, number> {
  const top = list.getBoundingClientRect().top - list.scrollTop;
  return new Map(Array.from(list.querySelectorAll<HTMLElement>("[data-thread-id]"), row => [row.dataset.threadId!, row.getBoundingClientRect().top - top]));
}

// After a list changed: rows already there slide from where `before` had
// them, and the `entering` ones grow in, a little apart. A list scrolled
// down instead keeps the rows in view where they are and nothing moves.
export function slideRows(list: HTMLElement, before: Map<string, number>, { entering }: { entering: Set<string> }) {
  const after = measureRows(list);
  if (list.scrollTop > 0) {
    const anchor = [...before].find(([id, top]) => after.has(id) && top + 1 > list.scrollTop - rowHeight(list, id));
    if (anchor) list.scrollTop += after.get(anchor[0])! - anchor[1];
    return;
  }
  if (reducedMotion() || typeof list.animate !== "function") return;
  let order = 0;
  for (const row of list.querySelectorAll<HTMLElement>("[data-thread-id]")) {
    const id = row.dataset.threadId!;
    if (entering.has(id)) {
      const height = row.offsetHeight;
      const { paddingTop, paddingBottom } = getComputedStyle(row);
      row.style.overflow = "hidden";
      const grow = row.animate([
        { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 },
        { height: `${height}px`, paddingTop, paddingBottom, opacity: 1 },
      ], { duration: 240, delay: order++ * 30, easing: EASE_SETTLE, fill: "backwards" });
      settled(grow).then(() => { row.style.overflow = ""; });
      continue;
    }
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined || now === undefined || Math.abs(was - now) < 1) continue;
    row.animate([{ transform: `translateY(${was - now}px)` }, { transform: "none" }], { duration: 260, easing: EASE_SETTLE });
  }
}

const rowHeight = (list: Element, id: string) =>
  list.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`)?.offsetHeight ?? 0;
