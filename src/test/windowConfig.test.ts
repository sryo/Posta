import { describe, expect, it } from "vitest";
import { readRepoFile } from "./files";

const windows = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).app.windows as { dragDropEnabled?: boolean }[];

describe("main window", () => {
  // Tauri's native file-drop handler otherwise swallows drops before the
  // page sees them, and setup accepts a dropped client_secret file
  it("lets the page receive dropped files", () => {
    expect(windows[0].dragDropEnabled).toBe(false);
  });
});
