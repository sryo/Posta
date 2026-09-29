import { For, Show } from "solid-js";
import { useDialog } from "../app/dialog";
import type { CardPreset } from "../app/presets";
import { PlusIcon } from "./Icons";

type PreviewCard = { name: string; color?: string | null };

function PresetPreview(props: { cards: PreviewCard[] }) {
  return (
    <Show when={props.cards.length > 0} fallback={<div class="preset-preview empty"><PlusIcon size="tool" /></div>}>
      <div class="preset-preview">
        <For each={props.cards}>
          {(c) => <div class={`preset-card ${c.color || "none"}`}></div>}
        </For>
      </div>
    </Show>
  );
}

const cardNames = (cards: PreviewCard[]) => (cards.length ? cards.map(c => c.name).join(" · ") : "No cards");

export function PresetPicker(props: {
  presets: Record<string, { label: string; description: string; cards: CardPreset[] }>;
  onPick: (key: string) => void;
  onDismiss: () => void;
}) {
  let recommended: HTMLButtonElement | undefined;
  const dialogRef = useDialog({
    onClose: () => props.onDismiss(),
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
                onClick={() => props.onPick(key)}
              >
                <PresetPreview cards={preset.cards} />
                <span class="preset-label">
                  {preset.label}
                  <Show when={key === "posta"}><span class="preset-badge">Recommended</span></Show>
                </span>
                <span class="preset-desc">{preset.description}</span>
                <span class="preset-cards">{cardNames(preset.cards)}</span>
              </button>
            )}
          </For>
        </div>
        <div class="restore-actions">
          <button class="btn btn-ghost" onClick={() => props.onDismiss()}>Not now</button>
        </div>
      </div>
    </div>
  );
}
