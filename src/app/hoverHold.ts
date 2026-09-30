import { nearWheel, RADIAL_HOVER_PAD, type Circle } from "./radial";

// Whether the pointer is near an open wheel, measured from where its anchor
// and petals are on screen now
export function pointNearWheel(menu: Element, x: number, y: number, pad = RADIAL_HOVER_PAD): boolean {
  if (!menu.isConnected) return false;
  const box = menu.getBoundingClientRect();
  const petals: Circle[] = Array.from(menu.querySelectorAll(".radial-petal"), el => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, r: r.width / 2 };
  });
  return nearWheel({ x: box.left, y: box.top }, petals, { x, y }, pad);
}

// Keeps a hover wheel open while the pointer, having left what the wheel
// opened from, stays near the wheel: a safety zone round its petals, as a
// menu keeps its submenu open on the way to it. Another row entered inside
// the zone waits until the pointer leaves it, and then takes the wheel.
export function createHoverHold() {
  let held: { menu: Element; exit: () => void } | null = null;
  let waiting: { key: string; run: () => void } | null = null;
  let pointer = { x: 0, y: 0 };

  const letGo = () => {
    if (!held) return;
    const { exit } = held;
    const next = waiting;
    release();
    if (next) next.run();
    else exit();
  };
  const move = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (held && !pointNearWheel(held.menu, pointer.x, pointer.y)) letGo();
  };
  // A scroll moves the wheel under a pointer that stays still, and sends no move
  const scroll = () => {
    if (held && !pointNearWheel(held.menu, pointer.x, pointer.y)) letGo();
  };
  // Nor does a pointer that leaves the window, or a window put behind another;
  // no row is under it then to take the wheel
  const gone = () => {
    waiting = null;
    letGo();
  };

  function watch(on: boolean) {
    const toggle = on ? "addEventListener" : "removeEventListener";
    document[toggle]("pointermove", move as EventListener, true);
    document[toggle]("scroll", scroll, true);
    document.documentElement[toggle]("mouseleave", gone);
    window[toggle]("blur", gone);
  }

  function release() {
    if (held) watch(false);
    held = null;
    waiting = null;
  }

  return {
    // On leaving what an open wheel belongs to: true when the pointer is still
    // near `menu`, which then stays until it moves away and `exit` runs
    hold(menu: Element | null | undefined, x: number, y: number, exit: () => void): boolean {
      release();
      if (!menu || !pointNearWheel(menu, x, y)) return false;
      held = { menu, exit };
      pointer = { x, y };
      watch(true);
      return true;
    },
    // On entering another row: true when the pointer is still near the held
    // wheel, and the row's `run` waits for it to move away
    wait(key: string, x: number, y: number, run: () => void): boolean {
      if (!held || !pointNearWheel(held.menu, x, y)) return false;
      waiting = { key, run };
      return true;
    },
    // On leaving a row: it no longer waits for the wheel. True while a wheel
    // is held, so leaving that row doesn't close it
    leave(key: string): boolean {
      if (waiting?.key === key) waiting = null;
      return held !== null;
    },
    release,
  };
}
