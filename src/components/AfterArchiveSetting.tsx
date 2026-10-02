import { For } from "solid-js";
import { loadAfterArchive, saveAfterArchive, type AfterArchive } from "../app/threadNavigation";
import { SettingsGroup, SettingsRow } from "./FormParts";
import { NoticesSetting } from "./NoticesSetting";

const CHOICES: { value: AfterArchive; label: string }[] = [
  { value: "next", label: "Next thread" },
  { value: "previous", label: "Previous thread" },
  { value: "board", label: "Board" },
];

// Where an open thread goes once it is archived, deleted or marked as spam,
// and whether Posta points out what it noticed while reading and writing
export const AfterArchiveSetting = () => (
  <SettingsGroup heading="Reading">
    <SettingsRow label="After archiving" for="settings-after-archive">
      <select id="settings-after-archive" aria-label="After archiving" value={loadAfterArchive()} onChange={(e) => saveAfterArchive(e.currentTarget.value as AfterArchive)}>
        <For each={CHOICES}>{(choice) => <option value={choice.value}>{choice.label}</option>}</For>
      </select>
    </SettingsRow>
    <NoticesSetting />
  </SettingsGroup>
);
