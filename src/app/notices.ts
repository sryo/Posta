// Whether Posta points out what it noticed (a Bcc reply all, a thread already
// going, a newer file, a late regular sender...). One switch covers them all.

import { createSignal } from "solid-js";
import { safeGetItem, safeSetItem } from "../shared/storage";

const KEY = "noticesEnabled";

const [enabled, setEnabled] = createSignal(safeGetItem(KEY) !== "false");

export const noticesEnabled = enabled;

export function setNoticesEnabled(on: boolean): void {
  setEnabled(on);
  safeSetItem(KEY, String(on));
}
