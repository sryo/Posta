import { noticesEnabled, setNoticesEnabled } from "../app/notices";
import { SettingsRow } from "./FormParts";

export const NoticesSetting = () => (
  <SettingsRow label="Point out things Posta notices">
    <button
      type="button"
      class="settings-switch"
      role="switch"
      aria-checked={noticesEnabled()}
      aria-label="Point out things Posta notices"
      onClick={() => setNoticesEnabled(!noticesEnabled())}
    />
  </SettingsRow>
);
