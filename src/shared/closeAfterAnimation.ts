import { createSignal, onCleanup } from "solid-js";

// Plays the overlay's closing animation, then closes it once; a view torn
// down before the animation ends does not close whatever replaced it
export function createCloseAfterAnimation(onClose: () => void, durationMs = 200) {
  const [closing, setClosing] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    if (closing()) return;
    setClosing(true);
    timer = setTimeout(onClose, durationMs);
  };

  onCleanup(() => clearTimeout(timer));

  return { closing, close };
}
