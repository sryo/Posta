// Trackpad detents while a card is dragged to another place on the board:
// a light tick each time it passes into another card's slot, and a firmer
// one when it lands somewhere new. Dropping it back where it was is silent.

export type Haptic = "alignment" | "levelChange";

const MIN_GAP_MS = 40;

export function createDetents(perform: (kind: Haptic) => void, now: () => number = Date.now) {
  let dragging = false;
  let slot: string | null = null;
  let lastTick = -Infinity;
  return {
    start(cardId: string) {
      dragging = true;
      slot = cardId;
    },
    over(cardId: string | null) {
      if (!dragging || cardId === null || cardId === slot) return;
      slot = cardId;
      if (now() - lastTick < MIN_GAP_MS) return;
      lastTick = now();
      perform("alignment");
    },
    end(changed: boolean) {
      if (dragging && changed) perform("levelChange");
      dragging = false;
      slot = null;
    },
  };
}
