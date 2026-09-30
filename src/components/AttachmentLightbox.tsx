import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { formatFileSize, normalizeBase64Url } from "../utils";
import { CloseButton } from "./ComposeAtoms";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

export type PreviewAttachment = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  inlineData: string | null;
};

type Shown = { kind: "loading" } | { kind: "error" } | { kind: "image"; src: string } | { kind: "pdf"; src: string };

function pdfUrl(base64: string): string {
  const binary = atob(normalizeBase64Url(base64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

// Images and PDFs of a thread, one at a time, over everything else
export const AttachmentLightbox = (props: {
  items: PreviewAttachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  // Base64 (or base64url) data of an attachment the listing didn't carry
  loadData: (item: PreviewAttachment) => Promise<string>;
  onDownload: (item: PreviewAttachment) => void;
  onOpenExternally: (item: PreviewAttachment) => void;
}) => {
  const current = () => props.items[props.index];
  const [shown, setShown] = createSignal<Shown>({ kind: "loading" });
  let blobUrl: string | null = null;
  const releaseBlob = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  };

  createEffect(() => {
    const item = current();
    releaseBlob();
    if (!item) return;
    const show = (data: string) => {
      if (current() !== item) return;
      if (item.mimeType === "application/pdf") {
        blobUrl = pdfUrl(data);
        setShown({ kind: "pdf", src: blobUrl });
      } else {
        setShown({ kind: "image", src: `data:${item.mimeType};base64,${normalizeBase64Url(data)}` });
      }
    };
    if (item.inlineData) { show(item.inlineData); return; }
    setShown({ kind: "loading" });
    props.loadData(item).then(show, () => { if (current() === item) setShown({ kind: "error" }); });
  });
  onCleanup(releaseBlob);

  const step = (by: number) => {
    const next = Math.min(Math.max(props.index + by, 0), props.items.length - 1);
    if (next !== props.index) props.onIndexChange(next);
  };

  // Captured on window so nothing behind the lightbox (the thread view's
  // Escape, the board's shortcuts) sees keys meant for it. Enter and Space
  // still press the focused
  // button: that is the key's default action, not a listener.
  const keyActions: Record<string, () => void> = {
    Escape: () => props.onClose(),
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
  };
  let dialogEl: HTMLDivElement | undefined;
  // Tab cycles through the lightbox's own controls, never the page behind it
  const keepTabInside = (e: KeyboardEvent) => {
    if (!dialogEl) return;
    const focusable = Array.from(dialogEl.querySelectorAll<HTMLElement>("button:not([disabled]), iframe"));
    if (focusable.length === 0) return;
    const at = focusable.indexOf(document.activeElement as HTMLElement);
    const wrapTo = e.shiftKey
      ? (at <= 0 ? focusable[focusable.length - 1] : null)
      : (at === -1 || at === focusable.length - 1 ? focusable[0] : null);
    if (wrapTo) {
      e.preventDefault();
      wrapTo.focus();
    }
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    if (e.key === "Tab") { keepTabInside(e); return; }
    const action = keyActions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };
  const returnFocus = document.activeElement;
  onMount(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    dialogEl?.focus();
  });
  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  });

  return (
    <Show when={current()}>
      {(item) => (
        <div ref={dialogEl} tabIndex={-1} class="lightbox" role="dialog" aria-modal="true" aria-label={item().filename} onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
          <div class="lightbox-bar">
            <CloseButton onClick={props.onClose} />
            <div class="lightbox-title">
              <span class="lightbox-name">{item().filename}</span>
              <span class="lightbox-meta">
                {formatFileSize(item().size)}
                <Show when={props.items.length > 1}> · {props.index + 1} of {props.items.length}</Show>
              </span>
            </div>
            <button class="btn btn-sm" onClick={() => props.onDownload(item())}>Download</button>
            <button class="btn btn-sm" onClick={() => props.onOpenExternally(item())}>Open in…</button>
          </div>
          <div class="lightbox-stage">
            <Show when={props.items.length > 1}>
              <button class="lightbox-nav lightbox-prev" aria-label="Previous attachment" disabled={props.index === 0} onClick={() => step(-1)}>
                <ChevronLeftIcon size="tool" />
              </button>
            </Show>
            {(() => {
              const s = shown();
              if (s.kind === "image") {
                return <img class="lightbox-image" src={s.src} alt={item().filename} onError={() => { if (shown() === s) setShown({ kind: "error" }); }} />;
              }
              if (s.kind === "pdf") return <iframe class="lightbox-pdf" src={s.src} title={item().filename} />;
              if (s.kind === "error") return <div class="lightbox-status">Couldn't load a preview. Open it in another app instead.</div>;
              return <div class="lightbox-status">Loading…</div>;
            })()}
            <Show when={props.items.length > 1}>
              <button class="lightbox-nav lightbox-next" aria-label="Next attachment" disabled={props.index === props.items.length - 1} onClick={() => step(1)}>
                <ChevronRightIcon size="tool" />
              </button>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
};
