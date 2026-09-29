import { Show, For, onCleanup, createUniqueId, createSignal, createEffect } from "solid-js";
import type { SendAttachment } from "../api/tauri";
import { truncateMiddle } from "../utils";
import { CloseIcon, AttachmentIcon } from "./Icons";
import { CloseButton } from "./ComposeAtoms";
import { isImeComposing } from "../shared/keyboard";
import { splitQuotedText } from "../app/quotedHistory";
import { RecipientInput, type RecipientSuggestion } from "./RecipientInput";
import { carriesFiles, transferredFiles } from "../app/fileDrop";
import { FieldRow, FormFooter, SubmitButton } from "./FormParts";

// Shared Compose Form component
interface ComposeFormProps {
  // Mode and display
  mode: 'new' | 'reply' | 'forward' | 'batchReply';
  title?: string;
  showHeader?: boolean;
  showSubject?: boolean;
  showFields?: boolean; // Show To/Cc/Bcc fields (default true)
  // Field values (optional when showFields=false)
  to?: string;
  setTo?: (v: string) => void;
  cc?: string;
  setCc?: (v: string) => void;
  bcc?: string;
  setBcc?: (v: string) => void;
  showCcBcc?: boolean;
  setShowCcBcc?: (v: boolean) => void;
  subject?: string;
  setSubject?: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  placeholder?: string;
  // Attachments
  attachments: SendAttachment[];
  onRemoveAttachment: (i: number) => void;
  onFileSelect: (e: Event) => void;
  // Files dropped on the compose or pasted into it
  onAddFiles?: (files: File[]) => void;
  fileInputId: string;
  // Status
  error?: string | null;
  draftSaving?: boolean;
  draftSaved?: boolean;
  sending?: boolean;
  // Actions
  onSend: () => void;
  onClose: () => void;
  onInput?: () => void;
  onSkip?: () => void; // For batch reply
  canSend?: boolean; // Override send button enabled state
  // Focus
  focusBody?: boolean;
  focusTo?: boolean;
  // Contacts to suggest for the recipient being typed in To, Cc and Bcc
  suggestContacts?: (query: string) => RecipientSuggestion[];
}

export const ComposeForm = (props: ComposeFormProps) => {
  const defaultTitle = props.mode === 'new' ? 'New message'
    : props.mode === 'forward' ? 'Forward'
      : props.mode === 'batchReply' ? 'Reply'
        : 'Reply';

  // Determine if send is enabled (for keyboard shortcut and button)
  const canSend = () => props.canSend !== undefined ? props.canSend : (props.to || '').trim().length > 0;

  const fieldId = createUniqueId();

  // dragenter and dragleave fire for every child crossed; the target is
  // left once each enter has had its leave
  const [dragDepth, setDragDepth] = createSignal(0);
  const acceptsFiles = (e: DragEvent) => !!props.onAddFiles && carriesFiles(e.dataTransfer);
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      setDragDepth(d => d + 1);
    },
    onDragOver: (e: DragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!acceptsFiles(e)) return;
      setDragDepth(d => Math.max(0, d - 1));
    },
    onDrop: (e: DragEvent) => {
      if (!acceptsFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      const files = transferredFiles(e.dataTransfer);
      if (files.length > 0) props.onAddFiles!(files);
    },
  };

  const handlePaste = (e: ClipboardEvent) => {
    if (!props.onAddFiles) return;
    const files = transferredFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    props.onAddFiles(files);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (e.key === 'Escape') {
      props.onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend() && !props.sending) {
      e.preventDefault();
      props.onSend();
    }
  };

  // Shared field components (only rendered when showFields !== false)
  const ToField = () => (
    <FieldRow label="To" for={`${fieldId}-to`}>
      <div class="compose-to-row">
        <RecipientInput
          id={`${fieldId}-to`}
          inputRef={(el) => {
            const focusTimer = setTimeout(() => { if (props.focusTo !== false && !props.focusBody) el.focus(); }, 50);
            onCleanup(() => clearTimeout(focusTimer));
          }}
          value={props.to || ''}
          onChange={(v) => { props.setTo?.(v); props.onInput?.(); }}
          suggest={props.suggestContacts}
          onKeyDown={handleKeyDown}
          placeholder="Recipients"
        />
        <Show when={!props.showCcBcc && props.setShowCcBcc}>
          <button type="button" class="cc-bcc-toggle" onClick={() => props.setShowCcBcc!(true)}>Cc/Bcc</button>
        </Show>
      </div>
    </FieldRow>
  );

  const CcBccFields = () => (
    <Show when={props.showCcBcc && props.setCc && props.setBcc}>
      <FieldRow label="Cc" for={`${fieldId}-cc`}>
        <RecipientInput
          id={`${fieldId}-cc`}
          value={props.cc || ''}
          onChange={(v) => { props.setCc!(v); props.onInput?.(); }}
          suggest={props.suggestContacts}
          onKeyDown={handleKeyDown}
          placeholder="Cc recipients"
        />
      </FieldRow>
      <FieldRow label="Bcc" for={`${fieldId}-bcc`}>
        <RecipientInput
          id={`${fieldId}-bcc`}
          value={props.bcc || ''}
          onChange={(v) => { props.setBcc!(v); props.onInput?.(); }}
          suggest={props.suggestContacts}
          onKeyDown={handleKeyDown}
          placeholder="Bcc recipients"
        />
      </FieldRow>
    </Show>
  );

  const SubjectField = () => (
    <Show when={props.showSubject && props.setSubject}>
      <FieldRow label="Subject" for={`${fieldId}-subject`}>
        <input
          id={`${fieldId}-subject`}
          type="text"
          value={props.subject || ''}
          onInput={(e) => { props.setSubject!(e.currentTarget.value); props.onInput?.(); }}
          onKeyDown={handleKeyDown}
          placeholder="Subject"
        />
      </FieldRow>
    </Show>
  );

  // A reply's quoted history, captured once so typing above it never
  // re-splits the body; folded away until the toggle opens it
  const [quotedTail, setQuotedTail] = createSignal<string | null>(null);
  const [quoteShown, setQuoteShown] = createSignal(false);
  createEffect(() => {
    if (props.mode !== 'reply' || quotedTail() !== null) return;
    const split = splitQuotedText(props.body);
    if (split) setQuotedTail(split.quoted);
  });
  const foldedTail = () => {
    const tail = quotedTail();
    return tail && props.body.endsWith(tail) ? tail : null;
  };
  const visibleBody = () => {
    const tail = foldedTail();
    return tail && !quoteShown() ? props.body.slice(0, props.body.length - tail.length) : props.body;
  };

  const BodyTextarea = () => (
    <div class="compose-content">
      <textarea
        ref={(el) => {
          if (props.focusBody && el) {
            // Use requestAnimationFrame to ensure the value is rendered first
            requestAnimationFrame(() => {
              el.focus();
              el.setSelectionRange(0, 0);
              el.scrollTop = 0;
            });
          }
        }}
        value={visibleBody()}
        onInput={(e) => {
          const value = e.currentTarget.value;
          if (quoteShown()) {
            if (quotedTail() !== null) setQuotedTail(splitQuotedText(value)?.quoted ?? '');
            props.setBody(value);
          } else {
            props.setBody(value + (foldedTail() ?? ''));
          }
          props.onInput?.();
        }}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder || (props.mode === 'new' ? "Write something..." : "Write your reply...")}
      />
      <Show when={foldedTail()}>
        <button
          class="quoted-toggle"
          aria-expanded={quoteShown()}
          aria-label={quoteShown() ? 'Hide quoted text' : 'Show quoted text'}
          title={quoteShown() ? 'Hide quoted text' : 'Show quoted text'}
          onClick={() => setQuoteShown(!quoteShown())}
        >•••</button>
      </Show>
    </div>
  );

  const Attachments = () => (
    <Show when={props.attachments.length > 0}>
      <div class="compose-attachments">
        <For each={props.attachments}>
          {(attachment, i) => (
            <div class="compose-attachment">
              <span class="attachment-name" title={attachment.filename}>
                {truncateMiddle(attachment.filename, 20)}
              </span>
              <button class="attachment-remove" onClick={() => props.onRemoveAttachment(i())} title="Remove">
                <CloseIcon />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );

  const Footer = () => (
    <FormFooter
      class="compose-footer"
      error={props.error}
      leading={
        <>
          <input
            type="file"
            id={props.fileInputId}
            onChange={props.onFileSelect}
            multiple
            style={{ display: 'none' }}
          />
          <button
            class="compose-attach-btn"
            onClick={() => (document.getElementById(props.fileInputId) as HTMLInputElement)?.click()}
            title="Attach files"
          >
            <AttachmentIcon />
          </button>
        </>
      }
      status={
        <>
          <Show when={props.draftSaving}>
            <div class="draft-saved">Saving...</div>
          </Show>
          <Show when={props.draftSaved && !props.draftSaving}>
            <div class="draft-saved">Draft saved</div>
          </Show>
        </>
      }
    >
      <SubmitButton label="Send" busy={props.sending} busyLabel="Sending..." disabled={!canSend()} onClick={props.onSend} />
    </FormFooter>
  );

  return (
    <div class="compose-drop-zone" {...dropHandlers} onPaste={handlePaste}>
      <Show when={dragDepth() > 0}>
        <div class="compose-drop-overlay">Drop to attach</div>
      </Show>
      <Show when={props.showHeader !== false}>
        <div class="compose-header">
          <h3>{props.title || defaultTitle}</h3>
          <Show when={props.onSkip}>
            <button class="btn btn-sm batch-reply-skip" onClick={props.onSkip} title="Skip this thread">
              Skip
            </button>
          </Show>
          <Show when={!props.onSkip}>
            <CloseButton onClick={props.onClose} />
          </Show>
        </div>
      </Show>
      <div class="compose-body">
        <Show when={props.showFields !== false}>
          <ToField />
          <CcBccFields />
          <SubjectField />
        </Show>
        <BodyTextarea />
      </div>
      <Attachments />
      <Footer />
    </div>
  );
};
