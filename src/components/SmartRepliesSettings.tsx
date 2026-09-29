import { Show } from "solid-js";

// Settings' Smart replies section: what it sends to Google, and the Gemini key
export function SmartRepliesSettings(props: {
  open: boolean;
  onToggle: () => void;
  // undefined until the keychain has answered
  keySaved: boolean | undefined;
  draft: string;
  onDraft: (value: string) => void;
  onSave: (key: string) => void;
}) {
  return (
    <div class={`settings-section collapsible ${props.open ? "open" : ""}`}>
      <button class="settings-section-title" aria-expanded={props.open} onClick={() => props.onToggle()}>
        <span>Smart replies</span>
        <span class="collapse-icon" aria-hidden="true">{props.open ? "−" : "+"}</span>
      </button>
      <Show when={props.open}>
        <p class="settings-hint">
          Suggests replies with Google Gemini. When on, the text of each email you open is sent to Google.
        </p>
        <Show
          when={props.keySaved}
          fallback={
            <div class="settings-form-group">
              <label for="settings-gemini-key">Gemini API key</label>
              <input
                id="settings-gemini-key"
                type="password"
                value={props.draft}
                onInput={(e) => props.onDraft(e.currentTarget.value)}
                onChange={(e) => { if (e.currentTarget.value.trim()) props.onSave(e.currentTarget.value); }}
                placeholder="AIza..."
              />
              <p class="settings-hint">
                Get one from <a href="https://aistudio.google.com/apikey" class="settings-link">Google AI Studio</a>.
              </p>
            </div>
          }
        >
          <p class="settings-hint">
            Saved in Keychain · <button class="link-btn" onClick={() => props.onSave("")}>Remove</button>
          </p>
        </Show>
      </Show>
    </div>
  );
}
