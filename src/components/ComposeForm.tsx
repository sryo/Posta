import { Show, For } from "solid-js";
import type { SendAttachment } from "../api/tauri";
import { getAvatarColor, truncateMiddle } from "../utils";
import { CloseIcon, AttachmentIcon } from "./Icons";
import { CloseButton } from "./ComposeAtoms";

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
  // Autocomplete (optional, for new email)
  autocomplete?: {
    show: boolean;
    candidates: { email: string; name?: string }[];
    selectedIndex: number;
    setSelectedIndex: (i: number) => void;
    onSelect: (email: string) => void;
    setShow: (v: boolean) => void;
  };
}

export const ComposeForm = (props: ComposeFormProps) => {
  const defaultTitle = props.mode === 'new' ? 'New message'
    : props.mode === 'forward' ? 'Forward'
      : props.mode === 'batchReply' ? 'Reply'
        : 'Reply';

  // Determine if send is enabled (for keyboard shortcut and button)
  const canSend = () => props.canSend !== undefined ? props.canSend : (props.to || '').trim().length > 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (props.autocomplete?.show) {
        props.autocomplete.setShow(false);
      } else {
        props.onClose();
      }
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend()) {
      e.preventDefault();
      props.onSend();
    }
  };

  const handleToKeyDown = (e: KeyboardEvent) => {
    const ac = props.autocomplete;
    if (ac && ac.show && ac.candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        ac.setSelectedIndex((ac.selectedIndex + 1) % ac.candidates.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        ac.setSelectedIndex((ac.selectedIndex - 1 + ac.candidates.length) % ac.candidates.length);
        return;
      } else if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ac.onSelect(ac.candidates[ac.selectedIndex].email);
        return;
      }
    }
    handleKeyDown(e);
  };

  // Shared field components (only rendered when showFields !== false)
  const ToField = () => (
    <div class="compose-field" style={props.autocomplete ? "position: relative;" : undefined}>
      <label>To</label>
      <div class="compose-to-row">
        <input
          ref={(el) => setTimeout(() => { if (props.focusTo !== false && !props.focusBody) el?.focus(); }, 50)}
          type="email"
          value={props.to || ''}
          onInput={(e) => { props.setTo?.(e.currentTarget.value); props.onInput?.(); }}
          onFocus={() => props.autocomplete?.setShow(true)}
          onBlur={() => props.autocomplete && setTimeout(() => props.autocomplete!.setShow(false), 150)}
          onKeyDown={handleToKeyDown}
          placeholder="Recipients"
        />
        <Show when={!props.showCcBcc && props.setShowCcBcc}>
          <button type="button" class="cc-bcc-toggle" onClick={() => props.setShowCcBcc!(true)}>Cc/Bcc</button>
        </Show>
      </div>
      <Show when={props.autocomplete?.show && props.autocomplete.candidates.length > 0}>
        <div class="compose-autocomplete">
          <For each={props.autocomplete!.candidates}>
            {(contact, i) => (
              <div
                class={`compose-autocomplete-item ${i() === props.autocomplete!.selectedIndex ? 'selected' : ''}`}
                onMouseDown={() => props.autocomplete!.onSelect(contact.email)}
                onMouseEnter={() => props.autocomplete!.setSelectedIndex(i())}
              >
                <div class="compose-autocomplete-avatar" style={{ background: getAvatarColor(contact.name || contact.email) }}>
                  {(contact.name || contact.email).charAt(0).toUpperCase()}
                </div>
                <div class="compose-autocomplete-info">
                  <Show when={contact.name}>
                    <div class="compose-autocomplete-name">{contact.name}</div>
                  </Show>
                  <div class="compose-autocomplete-email">{contact.email}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );

  const CcBccFields = () => (
    <Show when={props.showCcBcc && props.setCc && props.setBcc}>
      <div class="compose-field">
        <label>Cc</label>
        <input
          type="text"
          value={props.cc || ''}
          onInput={(e) => { props.setCc!(e.currentTarget.value); props.onInput?.(); }}
          onKeyDown={handleKeyDown}
          placeholder="Cc recipients"
        />
      </div>
      <div class="compose-field">
        <label>Bcc</label>
        <input
          type="text"
          value={props.bcc || ''}
          onInput={(e) => { props.setBcc!(e.currentTarget.value); props.onInput?.(); }}
          onKeyDown={handleKeyDown}
          placeholder="Bcc recipients"
        />
      </div>
    </Show>
  );

  const SubjectField = () => (
    <Show when={props.showSubject && props.setSubject}>
      <div class="compose-field">
        <label>Subject</label>
        <input
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
        class={`btn btn-primary ${props.sending ? 'sending' : ''}`}
        disabled={!canSend() || props.sending}
        onClick={props.onSend}
      >
        {props.sending ? 'Sending...' : <>Send <span class="shortcut-hint">⌘↵</span></>}
      </button>
    </div>
  );

  return (
    <>
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
    </>
  );
};
