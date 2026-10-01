import { Show } from "solid-js";
import { SettingsGroup, SettingsRow } from "./FormParts";

// Settings' Smart replies: a switch that is on while a Gemini key is saved.
// Turning it on asks for a key; turning it off removes the key
export function SmartRepliesSettings(props: {
  open: boolean;
  onToggle: () => void;
  // undefined until the keychain has answered
  keySaved: boolean | undefined;
  draft: string;
  onDraft: (value: string) => void;
  onSave: (key: string) => void;
}) {
  const on = () => !!props.keySaved || props.open;
  return (
    <SettingsGroup heading="Smart replies" hint="Uses Google Gemini. Each email you open is sent to Google.">
      <SettingsRow label="Suggest replies">
        <Show when={props.keySaved}>
          <span class="settings-row-meta">Saved in Keychain</span>
        </Show>
        <button
          type="button"
          class="settings-switch"
          role="switch"
          aria-checked={on()}
          aria-label="Suggest replies"
          onClick={() => {
            if (!props.keySaved) return props.onToggle();
            props.onSave("");
            if (props.open) props.onToggle();
          }}
        />
      </SettingsRow>
      <Show when={on() && !props.keySaved}>
        <SettingsRow label="Gemini API key" for="settings-gemini-key" stacked>
          <input
            id="settings-gemini-key"
            type="password"
            value={props.draft}
            onInput={(e) => props.onDraft(e.currentTarget.value)}
            onChange={(e) => { if (e.currentTarget.value.trim()) props.onSave(e.currentTarget.value); }}
            placeholder="AIza..."
          />
          <span class="settings-row-meta">
            Get one from <a href="https://aistudio.google.com/apikey" class="settings-link">Google AI Studio</a>.
          </span>
        </SettingsRow>
      </Show>
    </SettingsGroup>
  );
}
