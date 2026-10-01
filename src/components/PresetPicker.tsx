import { createSignal, For, onCleanup, Show } from "solid-js";
import { useDialog } from "../app/dialog";
import type { CardPreset } from "../app/presets";
import { lettersDrop, SORT_MS, SortingFrame } from "./SortingFrame";

const cardList = (cards: CardPreset[]) =>
  cards.length ? `${cards.length} card${cards.length === 1 ? "" : "s"}: ${cards.map(c => c.name).join(", ")}` : "No cards";

export function PresetPicker(props: {
  presets: Record<string, { label: string; description: string; cards: CardPreset[] }>;
  onPick: (key: string) => unknown;
  onDismiss: () => void;
}) {
  // The preset whose letters are dropping in, or being sorted onto the board
  const [sorting, setSorting] = createSignal<string | null>(null);
  let dropping: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(dropping));

  function dismiss() {
    clearTimeout(dropping);
    props.onDismiss();
  }

  function pick(key: string) {
    if (sorting()) return;
    setSorting(key);
    const sort = async () => {
      try {
        await props.onPick(key);
      } finally {
        setSorting(null);
      }
    };
    if (lettersDrop()) dropping = setTimeout(sort, SORT_MS);
    else void sort();
  }

  let recommended: HTMLButtonElement | undefined;
  const dialogRef = useDialog({
    onClose: dismiss,
    labelledBy: "preset-picker-title",
    initialFocus: () => recommended,
  });

  return (
    <div class="preset-overlay">
      <div class="preset-modal" ref={dialogRef}>
        <h2 id="preset-picker-title">Pick a starting layout</h2>
        <p>You can change cards any time</p>
        <div class="preset-options">
          <For each={Object.entries(props.presets)}>
            {([key, preset]) => (
              <button
                ref={(el) => { if (key === "posta") recommended = el; }}
                class={`preset-option ${key === "posta" ? "recommended" : ""}`}
                onClick={() => pick(key)}
              >
                <span class="preset-heading">
                  <span class="preset-label">
                    {preset.label}
                    <Show when={key === "posta"}><span class="preset-badge">Recommended</span></Show>
                  </span>
                  <span class="preset-desc">{preset.description}</span>
                </span>
                <SortingFrame cards={preset.cards} lit={() => sorting() === key} filled={() => sorting() === key} />
                <span class="visually-hidden">{cardList(preset.cards)}</span>
              </button>
            )}
          </For>
        </div>
        <div class="restore-actions">
          <button class="btn btn-ghost" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </div>
  );
}
