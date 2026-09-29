// Files dragged in from the Finder or pasted from the clipboard. The webview
// gets them as DOM drag and paste events because the window leaves drops to
// the page (dragDropEnabled is off in tauri.conf.json).

export function carriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes("Files");
}

// A screenshot pasted from the clipboard can come without a name
export function transferredFiles(transfer: DataTransfer | null | undefined): File[] {
  if (!carriesFiles(transfer)) return [];
  return Array.from(transfer!.files ?? []).map(file => {
    if (file.name) return file;
    const extension = file.type.split("/")[1]?.split("+")[0] || "bin";
    const base = file.type.startsWith("image/") ? "pasted-image" : "pasted-file";
    return new File([file], `${base}.${extension}`, { type: file.type });
  });
}

// A file dropped where nothing takes it would otherwise open in the webview
// in place of the app
export function preventFileDropNavigation(target: Window): () => void {
  const block = (e: Event) => {
    if (carriesFiles((e as DragEvent).dataTransfer)) e.preventDefault();
  };
  target.addEventListener("dragover", block);
  target.addEventListener("drop", block);
  return () => {
    target.removeEventListener("dragover", block);
    target.removeEventListener("drop", block);
  };
}
