import { For, Show } from "solid-js";
import type { Attachment } from "../api/tauri";
import { formatFileSize, normalizeBase64Url } from "../utils";

const MAX_THUMBNAILS = 4;
const MAX_FILES = 3;

const hasThumbnail = (a: Attachment) => !!a.inline_data && a.mime_type.startsWith("image/");

// An image the message body shows in place (a logo, a signature) rather than a
// file sent along: the thread view draws it inside the mail. Photos from Apple
// Mail carry a Content-ID too, so it also takes an unnamed part (named after
// its Content-ID), an Outlook-style "image001.png", or a small size. The
// backend's Attachment::looks_embedded is the same rule.
const EMBEDDED_IMAGE_MAX_SIZE = 15_000;
const inBody = (a: Attachment) => {
  if (!a.content_id || !a.mime_type.startsWith("image/")) return false;
  const stem = a.filename.replace(/\.[^.]*$/, "");
  return stem === a.content_id || /^image\d{3}$/i.test(stem) || a.size < EMBEDDED_IMAGE_MAX_SIZE;
};

// A file's name, cut short before its extension
export const FileName = (props: { filename: string }) => (
  <>
    <span class="file-stem">{splitName(props.filename).stem}</span>
    <span class="file-ext">{splitName(props.filename).ext}</span>
  </>
);

// The attachments a row shows
export const shownAttachments = (attachments: Attachment[]) => attachments.filter(a => !inBody(a));

// "80431_EXPENSAS_OCT.pdf" as a stem that can be cut short and the extension that can't
function splitName(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0 && filename.length - dot <= 6 ? { stem: filename.slice(0, dot), ext: filename.slice(dot) } : { stem: filename, ext: "" };
}

// A card row's attachments: image thumbnails, then file chips. Events stop at
// the buttons (natively, so document-level handlers don't see them either):
// the row behind opens the thread, and the board has its own keys.
export const CardAttachments = (props: {
  attachments: Attachment[];
  onOpen: (attachment: Attachment, index: number) => void;
  onMenu: (attachment: Attachment) => void;
}) => {
  const shown = () => shownAttachments(props.attachments);
  const images = () => shown().filter(hasThumbnail);
  const files = () => shown().filter(a => !hasThumbnail(a));
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
            <FileName filename={attachment.filename} />
          </button>
        )}
      </For>
      <Show when={shown().length > shownCount()}>
        <span class="thread-attachment-more">+{shown().length - shownCount()}</span>
      </Show>
    </div>
  );
};
