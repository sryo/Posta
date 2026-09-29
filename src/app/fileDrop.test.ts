import { describe, expect, it } from "vitest";
import { carriesFiles, preventFileDropNavigation, transferredFiles } from "./fileDrop";
import { readRepoFile } from "../test/files";

const file = new File(["x"], "a.txt", { type: "text/plain" });

describe("file transfers", () => {
  it("tells file drags from text drags", () => {
    expect(carriesFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(carriesFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });

  it("reads the files of a drop or paste", () => {
    expect(transferredFiles({ types: ["Files"], files: [file] } as unknown as DataTransfer)).toEqual([file]);
    expect(transferredFiles({ types: ["text/plain"], files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(transferredFiles(null)).toEqual([]);
  });

  it("names an unnamed pasted image after its type", () => {
    const unnamed = new File(["png"], "", { type: "image/png" });
    const [named] = transferredFiles({ types: ["Files"], files: [unnamed] } as unknown as DataTransfer);
    expect(named.name).toBe("pasted-image.png");
    expect(named.type).toBe("image/png");
  });
});

describe("preventFileDropNavigation", () => {
  it("keeps a file dropped outside a drop target from replacing the page", () => {
    const stop = preventFileDropNavigation(window);
    const drop = new Event("drop", { cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [file] } });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    const text = new Event("drop", { cancelable: true });
    Object.defineProperty(text, "dataTransfer", { value: { types: ["text/plain"], files: [] } });
    window.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);

    stop();
    const after = new Event("dragover", { cancelable: true });
    Object.defineProperty(after, "dataTransfer", { value: { types: ["Files"], files: [file] } });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe("window drop handling", () => {
  it("leaves file drops to the page, which guards against them from the start", () => {
    const windows = JSON.parse(readRepoFile("src-tauri/tauri.conf.json")).app.windows as { dragDropEnabled?: boolean }[];
    expect(windows.map(w => w.dragDropEnabled)).toEqual(windows.map(() => false));
    expect(readRepoFile("src/index.tsx")).toMatch(/preventFileDropNavigation\(window\)/);
  });
});
