import { For, Show } from "solid-js";
import type { Attachment } from "../api/tauri";
import { formatFileSize, normalizeBase64Url, truncateMiddle } from "../utils";

const MAX_THUMBNAILS = 4;
const MAX_FILES = 3;

const hasThumbnail = (a: Attachment) => !!a.inline_data && a.mime_type.startsWith("image/");

// A card row's attachments: image thumbnails, then file chips. Events stop at
// the buttons (natively, so document-level handlers don't see them either):
// the row behind opens the thread, and the board has its own keys.
export const CardAttachments = (props: {
  attachments: Attachment[];
  onOpen: (attachment: Attachment, index: number) => void;
  onMenu: (attachment: Attachment) => void;
}) => {
  const images = () => props.attachments.filter(hasThumbnail);
  const files = () => props.attachments.filter(a => !hasThumbnail(a));
  const shownCount = () => Math.min(images().length, MAX_THUMBNAILS) + Math.min(files().length, MAX_FILES);

  const handlers = (attachment: Attachment) => ({
    "aria-label": `${attachment.filename}, ${formatFileSize(attachment.size)}`,
    title: `${attachment.filename} (${formatFileSize(attachment.size)})`,
    "on:click": (e: MouseEvent) => {
      e.stopPropagation();
      if (e.ctrlKey) props.onMenu(attachment);
      else props.onOpen(attachment, props.attachments.indexOf(attachment));
    },
    "on:contextmenu": (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // macOS sends ctrl-click as a context menu too; the click handler has it
      if (!e.ctrlKey) props.onMenu(attachment);
    },
    "on:keydown": (e: KeyboardEvent) => {
      if (e.key === "F10" && e.shiftKey) {
        e.preventDefault();
        props.onMenu(attachment);
      }
      if (e.key === "F10" || e.key === "Enter" || e.key === " ") e.stopPropagation();
    },
  });

  return (
    <div class="thread-attachments">
      <For each={images().slice(0, MAX_THUMBNAILS)}>
        {(attachment) => (
          <button type="button" class="thread-image-btn" {...handlers(attachment)}>
            <img
              class="thread-image-thumb"
              src={`data:${attachment.mime_type};base64,${normalizeBase64Url(attachment.inline_data || "")}`}
              alt=""
            />
          </button>
        )}
      </For>
      <For each={files().slice(0, MAX_FILES)}>
        {(attachment) => (
          <button type="button" class="thread-file-item" {...handlers(attachment)}>
            <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
          </button>
        )}
      </For>
      <Show when={props.attachments.length > shownCount()}>
        <span class="thread-attachment-more">+{props.attachments.length - shownCount()}</span>
      </Show>
    </div>
  );
};
