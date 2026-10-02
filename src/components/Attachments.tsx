import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Attachment } from "../api/tauri";
import { formatFileSize, normalizeBase64Url } from "../utils";
import { MAX_PREVIEW_BYTES } from "../app/thumbnails";
import { kindOf, splitName, visibleAttachments, type AttachmentKind } from "../app/attachments";
import { CalendarIcon, FileIcon, FileTextIcon, ImageIcon } from "./Icons";

const ROW_IMAGES = 6;
const ROW_FILES = 3;

// Images the webview can draw: a preview comes with the thread when the image
// is small, and is downloaded when the attachment first shows otherwise
const DRAWABLE = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
const hasPreview = (a: Attachment) => DRAWABLE.test(a.mime_type) && (!!a.inline_data || a.size <= MAX_PREVIEW_BYTES);

const dataUrl = (a: Attachment, data: string) => `data:${a.mime_type};base64,${normalizeBase64Url(data)}`;

const KIND_ICONS: Record<AttachmentKind, (p: { size?: "tool" }) => JSX.Element> = {
  image: ImageIcon, pdf: FileTextIcon, calendar: CalendarIcon, file: FileIcon,
};

// A file's name, cut short before its extension
export const FileName = (props: { filename: string }) => (
  <>
    <span class="file-stem">{splitName(props.filename).stem}</span>
    <span class="file-ext">{splitName(props.filename).ext}</span>
  </>
);

type Size = "row" | "detail";

// A line under an attachment, such as that a later version of it came
export type LaterNote = { text: string; action: string; open: () => void };

// One attachment, as a button: an image's preview, or its name. At detail size
// a square holds the preview or a plain glyph of the file's kind, beside the
// name and its size. A preview downloads once the attachment is on screen; one
// that can't be had leaves the name. Events stop at the button (natively, so
// document-level handlers don't see them either): the row behind opens the
// thread, and the board and thread view have their own keys.
function AttachmentItem(props: {
  attachment: Attachment;
  size: Size;
  loadPreview?: (a: Attachment) => Promise<string>;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const a = () => props.attachment;
  const canPreview = hasPreview(props.attachment) && (!!props.attachment.inline_data || !!props.loadPreview);
  const [src, setSrc] = createSignal(props.attachment.inline_data && canPreview ? dataUrl(props.attachment, props.attachment.inline_data) : null);
  const [failed, setFailed] = createSignal(!canPreview);
  const previewing = () => !failed();
  const watch = (el: HTMLElement) => {
    if (src() || !props.loadPreview || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      seen.disconnect();
      props.loadPreview!(props.attachment).then(data => setSrc(dataUrl(props.attachment, data)), () => setFailed(true));
    }, { rootMargin: "200px" });
    seen.observe(el);
    onCleanup(() => seen.disconnect());
  };
  const preview = () => (
    <Show when={src()} fallback={<span ref={watch} class="attachment-pending" aria-hidden="true" />}>
      {(url) => <img src={url()} alt="" />}
    </Show>
  );
  const name = () => <span class="attachment-name"><FileName filename={a().filename} /></span>;
  const ext = () => splitName(a().filename).ext.slice(1).toUpperCase();

  return (
    <button
      type="button"
      class="attachment"
      data-kind={kindOf(a())}
      data-preview={previewing() ? "" : undefined}
      aria-label={`${a().filename}, ${formatFileSize(a().size)}`}
      title={`${a().filename} (${formatFileSize(a().size)})`}
      on:click={(e: MouseEvent) => {
        e.stopPropagation();
        if (e.ctrlKey) props.onMenu();
        else props.onOpen();
      }}
      on:contextmenu={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // macOS sends ctrl-click as a context menu too; the click handler has it
        if (!e.ctrlKey) props.onMenu();
      }}
      on:keydown={(e: KeyboardEvent) => {
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          e.preventDefault();
          props.onMenu();
        }
        if (e.key === "F10" || e.key === "ContextMenu" || e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <Show
        when={props.size === "detail"}
        fallback={<Show when={previewing()} fallback={name()}><span class="attachment-media">{preview()}</span></Show>}
      >
        <span class="attachment-media">
          <Show when={previewing()} fallback={<Dynamic component={KIND_ICONS[kindOf(a())]} size="tool" />}>{preview()}</Show>
        </span>
        <span class="attachment-body">
          {name()}
          <span class="attachment-meta">{formatFileSize(a().size)}{ext() ? ` · ${ext()}` : ""}</span>
        </span>
      </Show>
    </button>
  );
}

// A list of attachments, the same in a card row and under an opened message:
//   row     image previews first (up to six), then file names (up to three),
//           then how many more; quiet on the card, in the text's own colour
//   detail  every attachment, each with its preview or glyph, name and size
// Both leave out what shouldn't show (see visibleAttachments), and name every
// file with its extension.
export function AttachmentList(props: {
  attachments: Attachment[];
  size?: Size;
  hideCalendar?: boolean;
  onOpen: (attachment: Attachment, index: number) => void;
  onMenu: (attachment: Attachment) => void;
  // Downloads an image's preview when it didn't come with the thread
  loadPreview?: (attachment: Attachment) => Promise<string>;
  // A newer file of the same series, said under the attachment at detail size
  laterVersion?: (attachment: Attachment) => LaterNote | null;
}) {
  const size = (): Size => props.size ?? "row";
  const shown = () => visibleAttachments(props.attachments, { hideCalendar: props.hideCalendar });
  const images = () => shown().filter(hasPreview);
  const files = () => shown().filter(a => !hasPreview(a));
  const listed = () => size() === "detail" ? shown() : [...images().slice(0, ROW_IMAGES), ...files().slice(0, ROW_FILES)];
  const item = (attachment: Attachment) => {
    const button = (
      <AttachmentItem
        attachment={attachment}
        size={size()}
        loadPreview={props.loadPreview}
        onOpen={() => props.onOpen(attachment, props.attachments.indexOf(attachment))}
        onMenu={() => props.onMenu(attachment)}
      />
    );
    const later = () => (size() === "detail" ? props.laterVersion?.(attachment) ?? null : null);
    if (size() !== "detail") return button;
    return (
      <div class="attachment-entry" classList={{ "attachment-noted": !!later() }}>
        {button}
        <Show when={later()}>
          {(note) => (
            <p class="attachment-later">
              <span>{note().text}</span>{" "}
              <button type="button" class="attachment-later-open" onClick={() => note().open()}>{note().action}</button>
            </p>
          )}
        </Show>
      </div>
    );
  };
  return (
    <Show when={shown().length > 0}>
      <div class="attachments" data-size={size()}>
        <For each={listed()}>{item}</For>
        <Show when={shown().length > listed().length}>
          <span class="attachments-more">+{shown().length - listed().length}</span>
        </Show>
      </div>
    </Show>
  );
}
