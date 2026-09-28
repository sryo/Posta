import { createSignal, onCleanup } from "solid-js";

// window.confirm returns false without showing a dialog in the macOS webview,
// so destructive actions ask for a second press instead
export function createTwoStepConfirm(timeoutMs = 4000) {
  const [armed, setArmed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setArmed(false);
  };

  const press = (action: () => void) => {
    if (armed()) {
      disarm();
      action();
      return;
    }
    setArmed(true);
    clearTimeout(timer);
    timer = setTimeout(disarm, timeoutMs);
  };

  onCleanup(() => clearTimeout(timer));

  return { armed, press, disarm };
}
