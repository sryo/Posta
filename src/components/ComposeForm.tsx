import { Show, For, onCleanup, createUniqueId, createSignal } from "solid-js";
import type { SendAttachment } from "../api/tauri";
import { truncateMiddle } from "../utils";
import { CloseIcon, AttachmentIcon } from "./Icons";
import { CloseButton } from "./ComposeAtoms";
import { isImeComposing } from "../shared/keyboard";
import { RecipientInput, type RecipientSuggestion } from "./RecipientInput";
import { carriesFiles, transferredFiles } from "../app/fileDrop";

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
    <div class="compose-field">
      <label for={`${fieldId}-to`}>To</label>
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
    </div>
  );

  const CcBccFields = () => (
    <Show when={props.showCcBcc && props.setCc && props.setBcc}>
      <div class="compose-field">
        <label for={`${fieldId}-cc`}>Cc</label>
        <RecipientInput
          id={`${fieldId}-cc`}
          value={props.cc || ''}
          onChange={(v) => { props.setCc!(v); props.onInput?.(); }}
          suggest={props.suggestContacts}
          onKeyDown={handleKeyDown}
          placeholder="Cc recipients"
        />
      </div>
      <div class="compose-field">
        <label for={`${fieldId}-bcc`}>Bcc</label>
        <RecipientInput
          id={`${fieldId}-bcc`}
          value={props.bcc || ''}
          onChange={(v) => { props.setBcc!(v); props.onInput?.(); }}
          suggest={props.suggestContacts}
          onKeyDown={handleKeyDown}
          placeholder="Bcc recipients"
        />
      </div>
    </Show>
  );

  const SubjectField = () => (
    <Show when={props.showSubject && props.setSubject}>
      <div class="compose-field">
        <label for={`${fieldId}-subject`}>Subject</label>
        <input
          id={`${fieldId}-subject`}
          type="text"
          value={props.subject || ''}
          onInput={(e) => { props.setSubject!(e.currentTarget.value); props.onInput?.(); }}
          onKeyDown={handleKeyDown}
          placeholder="Subject"
        />
      </div>
    </Show>
  );

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
        value={props.body}
        onInput={(e) => { props.setBody(e.currentTarget.value); props.onInput?.(); }}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder || (props.mode === 'new' ? "Write something..." : "Write your reply...")}
      />
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
    <div class="compose-footer">
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
      <Show when={props.error}>
        <div class="compose-error">{props.error}</div>
      </Show>
      <Show when={props.draftSaving && !props.error}>
        <div class="draft-saved">Saving...</div>
      </Show>
      <Show when={props.draftSaved && !props.draftSaving && !props.error}>
        <div class="draft-saved">Draft saved</div>
      </Show>
      <div class="compose-spacer" />
      <button
        class="btn btn-primary"
        disabled={!canSend() || props.sending}
        onClick={props.onSend}
      >
        {props.sending ? 'Sending...' : <>Send <span class="shortcut-hint">⌘↵</span></>}
      </button>
    </div>
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
