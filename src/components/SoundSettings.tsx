import { For, Show } from "solid-js";
import { arrivalCards, playCue, setArrivalCard, setSoundsEnabled, soundsEnabled } from "../app/sounds";
import { SettingsGroup, SettingsRow } from "./FormParts";

function SoundSwitch(props: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="settings-switch"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      onClick={() => props.onToggle()}
    />
  );
}

// Settings' Sounds: off by default. Turning one on plays it, so it can be
// heard before it means anything
export function SoundSettings(props: { cards: { id: string; name: string }[] }) {
  return (
    <SettingsGroup heading="Sounds" hint="A soft note when a message has actually left, after Undo is no longer possible.">
      <SettingsRow label="Sounds">
        <SoundSwitch
          label="Sounds"
          on={soundsEnabled()}
          onToggle={() => {
            setSoundsEnabled(!soundsEnabled());
            if (soundsEnabled()) playCue("sent");
          }}
        />
      </SettingsRow>
      <Show when={soundsEnabled()}>
        <For each={props.cards}>
          {(card) => (
            <SettingsRow label={`New mail in ${card.name}`}>
              <SoundSwitch
                label={`New mail in ${card.name}`}
                on={arrivalCards().has(card.id)}
                onToggle={() => {
                  const on = !arrivalCards().has(card.id);
                  setArrivalCard(card.id, on);
                  if (on) playCue("arrived");
                }}
              />
            </SettingsRow>
          )}
        </For>
      </Show>
    </SettingsGroup>
  );
}
