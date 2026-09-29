import { createSignal, Show } from "solid-js";
import { ScopeMenu } from "../components/ScopeMenu";
import type { RecurrenceScope } from "./recurrence";

// Where the menu sits: under the button that opened it, which may be gone
// by the time the menu shows (the card wheel closes on click)
export interface ScopeAnchor {
  left: number;
  bottom: number;
}

interface ScopeRequest {
  title: string;
  anchor: ScopeAnchor | null;
  resolve: (scope: RecurrenceScope | null) => void;
}

const [request, setRequest] = createSignal<ScopeRequest | null>(null);

// Asks which occurrences of a repeating event an action applies to, for
// callers without a ScopeMenu of their own; null when dismissed. A question
// still open is answered null.
export function askScope(title: string, anchor: ScopeAnchor | null = null): Promise<RecurrenceScope | null> {
  request()?.resolve(null);
  return new Promise(resolve => setRequest({ title, anchor, resolve }));
}

function answer(scope: RecurrenceScope | null) {
  const open = request();
  if (!open) return;
  setRequest(null);
  open.resolve(scope);
}

// Room the menu takes, to keep it inside the window
const MENU_WIDTH = 216;
const MENU_HEIGHT = 180;

function placement(anchor: ScopeAnchor) {
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH));
  const top = Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - MENU_HEIGHT));
  return { left: `${left}px`, top: `${top}px` };
}

export function ScopePrompt() {
  return (
    <Show when={request()}>
      {(open) => (
        <div
          class="scope-prompt"
          style={open().anchor ? placement(open().anchor!) : undefined}
          classList={{ "scope-prompt-centered": !open().anchor }}
        >
          <ScopeMenu title={open().title} onChoose={answer} onCancel={() => answer(null)} />
        </div>
      )}
    </Show>
  );
}
