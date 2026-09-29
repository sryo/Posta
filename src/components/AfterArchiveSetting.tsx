import { For } from "solid-js";
import { loadAfterArchive, saveAfterArchive, type AfterArchive } from "../app/threadNavigation";

const CHOICES: { value: AfterArchive; label: string }[] = [
  { value: "next", label: "Open the next thread" },
  { value: "previous", label: "Open the previous thread" },
  { value: "board", label: "Go back to the board" },
];

export const AfterArchiveSetting = () => (
  <div class="settings-section">
    <div class="settings-section-title">After archiving</div>
    <p class="settings-hint">Where an open thread goes once it is archived, deleted or marked as spam.</p>
    <div class="settings-form-group">
      <select aria-label="After archiving" value={loadAfterArchive()} onChange={(e) => saveAfterArchive(e.currentTarget.value as AfterArchive)}>
        <For each={CHOICES}>{(choice) => <option value={choice.value}>{choice.label}</option>}</For>
      </select>
    </div>
  </div>
);
