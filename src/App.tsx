import { createSignal, onMount, onCleanup, Show, For, createMemo, createEffect, type JSX } from "solid-js";
import DOMPurify from 'dompurify';

// Configure DOMPurify with safe defaults for email HTML
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'a', 'b', 'i', 'u', 'strong', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'pre', 'code',
    'hr', 'sub', 'sup', 'font', 'center'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'class', 'target', 'width', 'height', 'color', 'size', 'face'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
};

// Safe localStorage helpers (handles private browsing, quota exceeded, etc.)
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently fail - localStorage unavailable or quota exceeded
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Silently fail
  }
}

function safeGetJSON<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function safeSetJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silently fail
  }
}
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  createSortable,
  closestCenter,
  createPointerSensor,
} from "@thisbeyond/solid-dnd";
import {
  initApp,
  configureAuth,
  getStoredCredentials,
  runOAuthFlow,
  getAccounts,
  getCards,
  createCard,
  updateCard,
  deleteCard,
  deleteAccount,
  fetchThreadsPaginated,
  searchThreadsPreview,
  modifyThreads,
  type Account,
  type Card,
  type ThreadGroup,
  type Thread,
  getThreadDetails,
  type FullThread,
  sendEmail,
  replyToThread,
  getCachedCardThreads,
  saveCachedCardThreads,
  downloadAttachment,
  type SendAttachment,
  listLabels,
  type GmailLabel,
} from "./api/tauri";
import {
  decodeBase64Utf8,
  formatFileSize,
  formatTime,
  formatSyncTime,
  truncateMiddle,
  getInitial,
  base64ToBlob,
  extractEmail,
  parseContact,
  getAvatarColor,
  validateEmailList,
} from "./utils";
import "./App.css";
import {
  ChevronIcon,
  RefreshIcon,
  PlusIcon,
  GoogleLogo,
  SettingsIcon,
  LogoutIcon,
  ComposeIcon,
  CloseIcon,
  ClearIcon,
  AttachmentIcon,
  ReplyIcon,
  ReplyAllIcon,
  ForwardIcon,
  ArchiveIcon,
  StarIcon,
  StarFilledIcon,
  TrashIcon,
  MailIcon,
  EditIcon,
  AlertIcon,
  SpamIcon,
  ThumbsUpIcon,
  ThumbsUpFilledIcon,
  EyeOpenIcon,
  EyeOpenFilledIcon,
  EyeClosedIcon,
  LabelIcon,
} from "./components/Icons";

// Shared compose components
const ComposeTextarea = (props: {
  value: string,
  onChange: (value: string) => void,
  onSend: () => void,
  onCancel: () => void,
  placeholder?: string,
  disabled?: boolean,
  autofocus?: boolean,
  class?: string,
}) => {
  return (
    <textarea
      class={props.class || "compose-textarea"}
      placeholder={props.placeholder || "Write your message..."}
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      disabled={props.disabled}
      ref={(el) => props.autofocus && setTimeout(() => el?.focus(), 50)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          props.onCancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && props.value.trim()) {
          e.preventDefault();
          props.onSend();
        }
      }}
    />
  );
};

const ComposeSendButton = (props: {
  onClick: () => void,
  disabled?: boolean,
  sending?: boolean,
  label?: string,
  showShortcut?: boolean,
  class?: string,
}) => {
  return (
    <button
      class={`btn btn-primary ${props.sending ? 'sending' : ''} ${props.class || ''}`}
      disabled={props.disabled || props.sending}
      onClick={props.onClick}
    >
      {props.sending ? 'Sending...' : (
        <>
          {props.label || 'Send'}
          {props.showShortcut !== false && <span class="shortcut-hint">⌘↵</span>}
        </>
      )}
    </button>
  );
};

const CloseButton = (props: {
  onClick: () => void,
  showHint?: boolean,
  title?: string,
  class?: string,
}) => {
  return (
    <button
      class={`close-btn ${props.class || ''}`}
      onClick={props.onClick}
      title={props.title || "Close (Esc)"}
    >
      <CloseIcon />
      {props.showHint !== false && <span class="shortcut-hint">ESC</span>}
    </button>
  );
};

const Spinner = (props: {
  size?: 'sm' | 'md' | 'lg',
  class?: string,
}) => {
  const sizeClass = props.size === 'sm' ? 'spinner-sm' : props.size === 'lg' ? 'spinner-lg' : '';
  return <div class={`spinner ${sizeClass} ${props.class || ''}`} />;
};

const CARD_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
const COLOR_HEX: Record<string, string> = {
  red: "#E53935",
  orange: "#FB8C00",
  yellow: "#FDD835",
  green: "#43A047",
  cyan: "#00ACC1",
  blue: "#1E88E5",
  purple: "#5E35B1",
  pink: "#D81B60",
};

const ThreadView = (props: {
  thread: FullThread | null,
  loading: boolean,
  error: string | null,
  color: string | null,
  onClose: () => void,
  focusedMessageIndex: number,
  onFocusChange: (index: number) => void,
  onOpenAttachment: (messageId: string, attachmentId: string, filename: string, mimeType: string) => void,
  onReply: (to: string, cc: string, subject: string, quotedBody: string, messageId: string) => void,
  onForward: (subject: string, body: string) => void,
  // Toolbar action props
  onAction: (action: string) => void,
  onOpenLabels: () => void,
  isStarred: boolean,
  isRead: boolean,
  isImportant: boolean,
}) => {
  let messageRefs: (HTMLDivElement | undefined)[] = [];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
      return;
    }

    // Toolbar action shortcuts (only when not in input)
    const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (!isTyping && props.thread) {
      if (e.key === 'a') { e.preventDefault(); props.onAction('archive'); return; }
      if (e.key === 's') { e.preventDefault(); props.onAction(props.isStarred ? 'unstar' : 'star'); return; }
      if (e.key === 'd') { e.preventDefault(); props.onAction('trash'); return; }
      if (e.key === 'l') { e.preventDefault(); props.onOpenLabels(); return; }
    }

    // j/k for message navigation
    if (props.thread && (e.key === 'j' || e.key === 'k')) {
      e.preventDefault();
      const maxIndex = props.thread.messages.length - 1;
      let newIndex = props.focusedMessageIndex;

      if (e.key === 'j') {
        newIndex = Math.min(props.focusedMessageIndex + 1, maxIndex);
      } else if (e.key === 'k') {
        newIndex = Math.max(props.focusedMessageIndex - 1, 0);
      }

      if (newIndex !== props.focusedMessageIndex) {
        props.onFocusChange(newIndex);
        // Scroll to focused message
        messageRefs[newIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class="thread-overlay" data-color={props.color || undefined}>
      <div class="thread-view-header">
        <CloseButton onClick={props.onClose} />
        <div class="thread-subject-header">
          <Show when={props.thread} fallback={<span>Loading...</span>}>
            <h2>{props.thread?.messages[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '(No Subject)'}</h2>
          </Show>
        </div>
      </div>

      {/* Action Toolbar */}
      <Show when={props.thread}>
        <div class="thread-actions-toolbar">
          <button class="thread-toolbar-btn" onClick={() => props.onAction('archive')} title="Archive">
            <ArchiveIcon />
            <span class="thread-toolbar-label">Archive</span>
            <span class="shortcut-hint">A</span>
          </button>

          <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isStarred ? 'unstar' : 'star')} title={props.isStarred ? "Unstar" : "Star"}>
            {props.isStarred ? <StarFilledIcon /> : <StarIcon />}
            <span class="thread-toolbar-label">{props.isStarred ? 'Starred' : 'Star'}</span>
            <span class="shortcut-hint">S</span>
          </button>

          <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isRead ? 'unread' : 'read')} title={props.isRead ? "Mark Unread" : "Mark Read"}>
            {props.isRead ? <EyeClosedIcon /> : <EyeOpenIcon />}
            <span class="thread-toolbar-label">{props.isRead ? 'Unread' : 'Read'}</span>
            <span class="shortcut-hint">U</span>
          </button>

          <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isImportant ? 'notImportant' : 'important')} title={props.isImportant ? "Not Important" : "Mark Important"}>
            {props.isImportant ? <ThumbsUpFilledIcon /> : <ThumbsUpIcon />}
            <span class="thread-toolbar-label">Important</span>
            <span class="shortcut-hint">I</span>
          </button>

          <div class="thread-toolbar-divider" />

          <button class="thread-toolbar-btn" onClick={props.onOpenLabels} title="Labels">
            <LabelIcon />
            <span class="thread-toolbar-label">Labels</span>
            <span class="shortcut-hint">L</span>
          </button>

          <div class="thread-toolbar-spacer" />

          <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('spam')} title="Mark as Spam">
            <SpamIcon />
            <span class="shortcut-hint">X</span>
          </button>

          <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('trash')} title="Delete">
            <TrashIcon />
            <span class="shortcut-hint">D</span>
          </button>
        </div>
      </Show>

      <div class="thread-content">
          <Show when={props.loading}>
            <div class="thread-skeleton">
              <div class="skeleton-message">
                <div class="skeleton-header">
                  <div class="skeleton-avatar"></div>
                  <div class="skeleton-meta">
                    <div class="skeleton-line skeleton-name"></div>
                    <div class="skeleton-line skeleton-date"></div>
                  </div>
                </div>
                <div class="skeleton-body">
                  <div class="skeleton-line"></div>
                  <div class="skeleton-line"></div>
                  <div class="skeleton-line skeleton-short"></div>
                </div>
              </div>
            </div>
          </Show>

          <Show when={props.error}>
            <div class="error-message">{props.error}</div>
          </Show>

          <Show when={props.thread}>
            <div class="messages-list">
            <For each={props.thread!.messages}>
              {(msg, index) => {
                const headers = msg.payload?.headers || [];
                const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                const date = headers.find(h => h.name === 'Date')?.value || '';

                const getBody = () => {
                  if (msg.payload?.body?.data) return decodeBase64Utf8(msg.payload.body.data);

                  // Recursively search for content in nested parts
                  const findContent = (parts: any[] | undefined, mimeType: string): string | null => {
                    if (!parts) return null;
                    for (const part of parts) {
                      if (part.mimeType === mimeType && part.body?.data) {
                        return decodeBase64Utf8(part.body.data);
                      }
                      // Search nested parts (multipart/alternative, multipart/mixed, etc.)
                      if (part.parts) {
                        const found = findContent(part.parts, mimeType);
                        if (found) return found;
                      }
                    }
                    return null;
                  };

                  // Prefer HTML, fall back to plain text
                  const htmlContent = findContent(msg.payload?.parts, 'text/html');
                  if (htmlContent) return htmlContent;

                  const textContent = findContent(msg.payload?.parts, 'text/plain');
                  if (textContent) return textContent;

                  // Last resort: use snippet if available
                  if (msg.snippet) return msg.snippet;

                  return "(No content)";
                };

                // Extract attachments from message parts
                const getAttachments = () => {
                  const attachments: { filename: string; mimeType: string; size: number; attachmentId?: string }[] = [];
                  const findAttachments = (parts: any[]) => {
                    parts?.forEach(part => {
                      if (part.filename && part.filename.length > 0) {
                        attachments.push({
                          filename: part.filename,
                          mimeType: part.mimeType || 'application/octet-stream',
                          size: part.body?.size || 0,
                          attachmentId: part.body?.attachmentId,
                        });
                      }
                      if (part.parts) findAttachments(part.parts);
                    });
                  };
                  findAttachments(msg.payload?.parts || []);
                  return attachments;
                };

                const attachments = getAttachments();
                const isImage = (mime: string) => mime.startsWith('image/');
                const isPdf = (mime: string) => mime === 'application/pdf';

                const getSubject = () => {
                  const subj = headers.find(h => h.name === 'Subject')?.value || '';
                  return subj.startsWith('Re:') ? subj : `Re: ${subj}`;
                };

                const getPlainTextBody = () => {
                  const body = getBody();
                  // Strip HTML tags for quoting
                  const temp = document.createElement('div');
                  temp.innerHTML = body;
                  return temp.textContent || temp.innerText || '';
                };

                const handleReply = () => {
                  const replyTo = extractEmail(from);
                  const subject = getSubject();
                  const plainBody = getPlainTextBody();
                  const quotedBody = `\n\nOn ${date}, ${from} wrote:\n> ${plainBody.split('\n').join('\n> ')}`;
                  props.onReply(replyTo, "", subject, quotedBody, msg.id);
                };

                const handleReplyAll = () => {
                  const replyTo = extractEmail(from);
                  const toHeader = headers.find(h => h.name === 'To')?.value || '';
                  const ccHeader = headers.find(h => h.name === 'Cc')?.value || '';
                  // Combine To and CC, excluding the sender
                  const allRecipients = [toHeader, ccHeader]
                    .filter(Boolean)
                    .join(', ')
                    .split(',')
                    .map(e => extractEmail(e.trim()))
                    .filter(e => e && e !== replyTo);
                  const ccList = allRecipients.join(', ');
                  const subject = getSubject();
                  const plainBody = getPlainTextBody();
                  const quotedBody = `\n\nOn ${date}, ${from} wrote:\n> ${plainBody.split('\n').join('\n> ')}`;
                  props.onReply(replyTo, ccList, subject, quotedBody, msg.id);
                };

                const handleForward = () => {
                  const origSubject = headers.find(h => h.name === 'Subject')?.value || '';
                  const fwdSubject = origSubject.startsWith('Fwd:') ? origSubject : `Fwd: ${origSubject}`;
                  const plainBody = getPlainTextBody();
                  const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${date}\nSubject: ${origSubject}\n\n${plainBody}`;
                  props.onForward(fwdSubject, fwdBody);
                };

                return (
                  <div
                    class={`message-card ${props.focusedMessageIndex === index() ? 'message-focused' : ''}`}
                    ref={(el) => { messageRefs[index()] = el; }}
                  >
                    <div class="message-header">
                      <div class="message-sender">{from}</div>
                      <div class="message-header-actions">
                        <button class="message-reply-btn" onClick={handleReply} title="Reply">
                          <ReplyIcon />
                          <span class="shortcut-hint">R</span>
                        </button>
                        <button class="message-reply-btn" onClick={handleReplyAll} title="Reply All">
                          <ReplyAllIcon />
                          <span class="shortcut-hint">A</span>
                        </button>
                        <button class="message-reply-btn" onClick={handleForward} title="Forward">
                          <ForwardIcon />
                          <span class="shortcut-hint">F</span>
                        </button>
                        <div class="message-date">{date}</div>
                      </div>
                    </div>
                    <div class="message-body" innerHTML={DOMPurify.sanitize(getBody(), DOMPURIFY_CONFIG)}></div>
                    <Show when={attachments.length > 0}>
                      <div class="message-attachments">
                        <For each={attachments}>
                          {(att) => (
                            <div
                              class="attachment-thumb clickable"
                              title={`${att.filename} - Click to open`}
                              onClick={() => att.attachmentId && props.onOpenAttachment(msg.id, att.attachmentId, att.filename, att.mimeType)}
                            >
                              <div class={`attachment-icon ${isImage(att.mimeType) ? 'image' : isPdf(att.mimeType) ? 'pdf' : 'file'}`}>
                                {isImage(att.mimeType) ? '🖼' : isPdf(att.mimeType) ? '📄' : '📎'}
                              </div>
                              <div class="attachment-info">
                                <div class="attachment-name">{att.filename}</div>
                                <div class="attachment-size">{formatFileSize(att.size)}</div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

type CardColor = typeof CARD_COLORS[number] | null;

// Background colors with light/dark mode support (same base colors, lower opacity)
const BG_COLORS = [
  { light: "rgba(229, 57, 53, 0.18)", dark: "rgba(229, 57, 53, 0.25)", hex: "#E53935" },
  { light: "rgba(251, 140, 0, 0.18)", dark: "rgba(251, 140, 0, 0.25)", hex: "#FB8C00" },
  { light: "rgba(253, 216, 53, 0.20)", dark: "rgba(253, 216, 53, 0.22)", hex: "#FDD835" },
  { light: "rgba(67, 160, 71, 0.18)", dark: "rgba(67, 160, 71, 0.25)", hex: "#43A047" },
  { light: "rgba(0, 172, 193, 0.18)", dark: "rgba(0, 172, 193, 0.25)", hex: "#00ACC1" },
  { light: "rgba(30, 136, 229, 0.18)", dark: "rgba(30, 136, 229, 0.25)", hex: "#1E88E5" },
  { light: "rgba(94, 53, 177, 0.18)", dark: "rgba(94, 53, 177, 0.25)", hex: "#5E35B1" },
  { light: "rgba(216, 27, 96, 0.18)", dark: "rgba(216, 27, 96, 0.25)", hex: "#D81B60" },
];
type GroupBy = "date" | "sender" | "label";
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "sender", label: "Sender" },
  { value: "label", label: "Label" },
];

// Gmail search operators for autocomplete
const GMAIL_OPERATORS: { op: string; desc: string; values?: string[] }[] = [
  { op: "from:", desc: "Sender address" },
  { op: "to:", desc: "Recipient address" },
  { op: "cc:", desc: "CC recipient" },
  { op: "bcc:", desc: "BCC recipient" },
  { op: "subject:", desc: "Words in subject" },
  { op: "label:", desc: "Messages with label" },
  { op: "has:attachment", desc: "Has attachments" },
  { op: "has:drive", desc: "Has Google Drive files" },
  { op: "has:document", desc: "Has Google Docs" },
  { op: "has:spreadsheet", desc: "Has Google Sheets" },
  { op: "has:presentation", desc: "Has Google Slides" },
  { op: "has:youtube", desc: "Has YouTube videos" },
  { op: "is:unread", desc: "Unread messages" },
  { op: "is:read", desc: "Read messages" },
  { op: "is:starred", desc: "Starred messages" },
  { op: "is:important", desc: "Important messages" },
  { op: "is:snoozed", desc: "Snoozed messages" },
  { op: "is:muted", desc: "Muted conversations" },
  { op: "in:inbox", desc: "In inbox" },
  { op: "in:sent", desc: "In sent" },
  { op: "in:drafts", desc: "In drafts" },
  { op: "in:spam", desc: "In spam" },
  { op: "in:trash", desc: "In trash" },
  { op: "in:anywhere", desc: "All mail including spam/trash" },
  { op: "category:primary", desc: "Primary category" },
  { op: "category:social", desc: "Social category" },
  { op: "category:promotions", desc: "Promotions category" },
  { op: "category:updates", desc: "Updates category" },
  { op: "category:forums", desc: "Forums category" },
  { op: "filename:", desc: "Attachment filename" },
  { op: "larger:", desc: "Larger than size (e.g. 5M)" },
  { op: "smaller:", desc: "Smaller than size" },
  { op: "older_than:", desc: "Older than (e.g. 1y, 2m, 3d)" },
  { op: "newer_than:", desc: "Newer than" },
  { op: "after:", desc: "After date (YYYY/MM/DD)" },
  { op: "before:", desc: "Before date" },
  { op: "deliveredto:", desc: "Delivered to address" },
  { op: "list:", desc: "Mailing list" },
];

function App() {
  const [loading, setLoading] = createSignal(true);

  // Thread View State
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [activeThreadCardId, setActiveThreadCardId] = createSignal<string | null>(null);
  const [activeThread, setActiveThread] = createSignal<FullThread | null>(null);
  const [threadLoading, setThreadLoading] = createSignal(false);
  const [threadError, setThreadError] = createSignal<string | null>(null);
  const [focusedMessageIndex, setFocusedMessageIndex] = createSignal(0);

  // Label drawer state
  const [labelDrawerOpen, setLabelDrawerOpen] = createSignal(false);
  const [accountLabels, setAccountLabels] = createSignal<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = createSignal(false);
  const [labelSearchQuery, setLabelSearchQuery] = createSignal("");

  const [error, setError] = createSignal<string | null>(null);
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = createSignal<Account | null>(null);
  const [cards, setCards] = createSignal<Card[]>([]);
  const [authLoading, setAuthLoading] = createSignal(false);
  const [cardThreads, setCardThreads] = createSignal<Record<string, ThreadGroup[]>>({});
  const [loadingThreads, setLoadingThreads] = createSignal<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = createSignal<Record<string, string | null>>({});
  const [collapsedCards, setCollapsedCards] = createSignal<Record<string, boolean>>({});
  const [cardPageTokens, setCardPageTokens] = createSignal<Record<string, string | null>>({});
  const [cardHasMore, setCardHasMore] = createSignal<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = createSignal<Record<string, boolean>>({});
  const [cardGroupBy, setCardGroupBy] = createSignal<Record<string, GroupBy>>(
    safeGetJSON<Record<string, string>>("cardGroupBy", {})
  );

  // Sync status tracking
  const [lastSyncTimes, setLastSyncTimes] = createSignal<Record<string, number>>({});
  const [syncErrors, setSyncErrors] = createSignal<Record<string, string | null>>({});

  // Undo/toast state
  interface UndoableAction {
    action: string;
    threadIds: string[];
    cardId: string;
    addedLabels: string[];
    removedLabels: string[];
    timestamp: number;
  }
  const [lastAction, setLastAction] = createSignal<UndoableAction | null>(null);
  const [toastVisible, setToastVisible] = createSignal(false);
  const [toastClosing, setToastClosing] = createSignal(false);
  let toastTimeoutId: number | undefined;

  // Settings
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);
  const [accountChooserOpen, setAccountChooserOpen] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const MIN_CARD_WIDTH = 200;
  const MAX_CARD_WIDTH = 600;
  const [cardWidth, setCardWidth] = createSignal<number>(
    Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, parseInt(safeGetItem("cardWidth") || "320", 10)))
  );
  const snippetLines = 5; // Fixed at 5 lines

  // Thread action visibility settings
  const [actionSettings, setActionSettings] = createSignal<Record<string, boolean>>(
    safeGetJSON<ActionSettings>("actionSettings", {"archive":false,"star":true,"trash":false,"markRead":true,"markUnread":false,"markImportant":true,"spam":false,"quickReply":true,"quickForward":false})
  );
  const DEFAULT_ACTION_ORDER = ["markImportant", "markRead", "star", "quickReply", "quickForward", "archive", "spam", "trash"];
  const [actionOrder, setActionOrder] = createSignal<string[]>(
    safeGetJSON<string[]>("actionOrder", DEFAULT_ACTION_ORDER)
  );
  const [draggingAction, setDraggingAction] = createSignal<string | null>(null);

  // Background color picker (stores index, not color value)
  const [bgColorPickerOpen, setBgColorPickerOpen] = createSignal(false);
  const [selectedBgColorIndex, setSelectedBgColorIndex] = createSignal<number | null>(
    safeGetItem("bgColorIndex") ? parseInt(safeGetItem("bgColorIndex")!) : null
  );

  // Add card form
  const [addingCard, setAddingCard] = createSignal(false);
  const [closingAddCard, setClosingAddCard] = createSignal(false);
  const [previewThreads, setPreviewThreads] = createSignal<ThreadGroup[]>([]);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  let previewDebounceTimer: number | undefined;
  const [newCardName, setNewCardName] = createSignal("");
  const [newCardQuery, setNewCardQuery] = createSignal("");
  const [newCardColor, setNewCardColor] = createSignal<CardColor>(null);
  const [newCardGroupBy, setNewCardGroupBy] = createSignal<GroupBy>("date");
  const [colorPickerOpen, setColorPickerOpen] = createSignal(false);

  // Edit card state
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editCardName, setEditCardName] = createSignal("");
  const [editCardQuery, setEditCardQuery] = createSignal("");
  const [editCardColor, setEditCardColor] = createSignal<CardColor>(null);
  const [editColorPickerOpen, setEditColorPickerOpen] = createSignal(false);

  // Keyboard navigation focus state
  const [focusedCardId, setFocusedCardId] = createSignal<string | null>(null);
  const [focusedThreadIndex, setFocusedThreadIndex] = createSignal<number>(-1);

  // Gmail search autocomplete
  const [queryAutocompleteOpen, setQueryAutocompleteOpen] = createSignal(false);
  const [queryAutocompleteIndex, setQueryAutocompleteIndex] = createSignal(0);
  const [queryInputRef, setQueryInputRef] = createSignal<HTMLInputElement | null>(null);
  const [queryDropdownPos, setQueryDropdownPos] = createSignal<{ top: number; left: number; width: number } | null>(null);
  const [queryPreviewThreads, setQueryPreviewThreads] = createSignal<ThreadGroup[]>([]);
  const [queryPreviewLoading, setQueryPreviewLoading] = createSignal(false);
  const [globalFilter, setGlobalFilter] = createSignal("");
  const [showGlobalFilter, setShowGlobalFilter] = createSignal(false);
  let filterInputRef: HTMLInputElement | undefined;
  const [activeQueryGetter, setActiveQueryGetter] = createSignal<(() => string) | null>(null);
  const [activeQuerySetter, setActiveQuerySetter] = createSignal<((q: string) => void) | null>(null);
  let queryPreviewTimeout: number | undefined;

  function updateDropdownPosition() {
    const input = queryInputRef();
    if (input) {
      const rect = input.getBoundingClientRect();
      setQueryDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }

  function getCurrentQuery(): string {
    const getter = activeQueryGetter();
    return getter ? getter() : "";
  }

  async function fetchQueryPreview(query: string) {
    if (!query.trim()) {
      setQueryPreviewThreads([]);
      return;
    }
    const account = selectedAccount();
    if (!account) return;

    setQueryPreviewLoading(true);
    try {
      const groups = await searchThreadsPreview(account.id, query);
      setQueryPreviewThreads(groups);
    } catch {
      setQueryPreviewThreads([]);
    } finally {
      setQueryPreviewLoading(false);
    }
  }

  function debounceQueryPreview(query: string) {
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
    queryPreviewTimeout = window.setTimeout(() => {
      fetchQueryPreview(query);
    }, 500);
  }

  // Quick Reply
  const [quickReplyThreadId, setQuickReplyThreadId] = createSignal<string | null>(null);
  const [quickReplyCardId, setQuickReplyCardId] = createSignal<string | null>(null);
  const [quickReplyText, setQuickReplyText] = createSignal("");
  const [quickReplySending, setQuickReplySending] = createSignal(false);
  const [sending, setSending] = createSignal(false);

  // Thread actions wheel
  const [hoveredThread, setHoveredThread] = createSignal<string | null>(null);
  const [actionsWheelOpen, setActionsWheelOpen] = createSignal(false);
  const [actionConfigMenu, setActionConfigMenu] = createSignal<{ x: number; y: number } | null>(null);
  let hoverActionsTimeout: number | undefined;

  function showThreadHoverActions(cardId: string, threadId: string) {
    if (hoverActionsTimeout) {
      clearTimeout(hoverActionsTimeout);
      hoverActionsTimeout = undefined;
    }
    // Logic from scripts.html:
    // If we have selection, we only show hover actions if THIS thread is selected?
    // Actually scripts.html says: "If threads are selected, don't show hover actions on non-selected threads"
    const hasSelection = (selectedThreads()[cardId]?.size || 0) > 0;
    const isSelected = selectedThreads()[cardId]?.has(threadId);

    if (hasSelection && !isSelected) {
      return;
    }

    setHoveredThread(threadId);
    setActionsWheelOpen(true);
  }

  function hideThreadHoverActions() {
    hoverActionsTimeout = window.setTimeout(() => {
      setActionsWheelOpen(false);
      setHoveredThread(null);
    }, 100);
  }

  const [selectedThreads, setSelectedThreads] = createSignal<Record<string, Set<string>>>({});
  const [lastSelectedThread, setLastSelectedThread] = createSignal<Record<string, string | null>>({});

  // Compose
  const [composing, setComposing] = createSignal(false);
  const [closingCompose, setClosingCompose] = createSignal(false);
  const [composeTo, setComposeTo] = createSignal("");
  const [composeCc, setComposeCc] = createSignal("");
  const [composeBcc, setComposeBcc] = createSignal("");
  const [showCcBcc, setShowCcBcc] = createSignal(false);
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [showAutocomplete, setShowAutocomplete] = createSignal(false);
  const [autocompleteIndex, setAutocompleteIndex] = createSignal(0);
  const [composeFabHovered, setComposeFabHovered] = createSignal(false);
  const [forwardingThread, setForwardingThread] = createSignal<{ threadId: string; subject: string; body: string } | null>(null);
  const [replyingToThread, setReplyingToThread] = createSignal<{ threadId: string; messageId: string } | null>(null);
  const [focusComposeBody, setFocusComposeBody] = createSignal(false);
  const [composeEmailError, setComposeEmailError] = createSignal<string | null>(null);
  const [draftSaved, setDraftSaved] = createSignal(false);
  const [composeAttachments, setComposeAttachments] = createSignal<SendAttachment[]>([]);
  let fabHoverTimeout: number | undefined;
  let draftSaveTimeout: number | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  // Draft management
  interface Draft {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    threadId?: string;
    savedAt: number;
  }

  function getDraftKey(): string {
    const account = selectedAccount();
    const reply = replyingToThread();
    const forward = forwardingThread();
    if (reply) return `draft_reply_${account?.id}_${reply.threadId}`;
    if (forward) return `draft_forward_${account?.id}`;
    return `draft_new_${account?.id}`;
  }

  function saveDraft() {
    if (!composing()) return;
    const key = getDraftKey();
    const draft: Draft = {
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      threadId: replyingToThread()?.threadId,
      savedAt: Date.now(),
    };
    // Only save if there's content
    if (draft.to || draft.subject || draft.body) {
      safeSetJSON(key, draft);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    }
  }

  function loadDraft(): Draft | null {
    const key = getDraftKey();
    const saved = safeGetItem(key);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  }

  function clearDraft() {
    const key = getDraftKey();
    safeRemoveItem(key);
  }

  function debouncedSaveDraft() {
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
    draftSaveTimeout = setTimeout(saveDraft, 2000) as unknown as number;
  }

  // Load draft when compose opens (only for new emails, not reply/forward with pre-filled content)
  createEffect(() => {
    if (composing() && !replyingToThread() && !forwardingThread()) {
      const draft = loadDraft();
      if (draft) {
        setComposeTo(draft.to);
        setComposeCc(draft.cc);
        setComposeBcc(draft.bcc);
        setComposeSubject(draft.subject);
        setComposeBody(draft.body);
        if (draft.cc || draft.bcc) {
          setShowCcBcc(true);
        }
      }
    }
  });

  // Batch Reply
  interface BatchReplyThread {
    threadId: string;
    subject: string;
    snippet: string;
    body: string; // Full HTML body
    from: string;
    date: string;
    messageId: string;
    to: string; // Reply-to address
  }
  const [batchReplyOpen, setBatchReplyOpen] = createSignal(false);
  const [batchReplyCardId, setBatchReplyCardId] = createSignal<string | null>(null);
  const [batchReplyThreads, setBatchReplyThreads] = createSignal<BatchReplyThread[]>([]);
  const [batchReplyMessages, setBatchReplyMessages] = createSignal<Record<string, string>>({});
  const [batchReplySending, setBatchReplySending] = createSignal<Record<string, boolean>>({});
  const [batchReplyLoading, setBatchReplyLoading] = createSignal(false);
  const [batchReplyAttachments, setBatchReplyAttachments] = createSignal<Record<string, SendAttachment[]>>({});

  // Recent contacts (stored locally for now - would come from backend)
  interface RecentContact {
    email: string;
    name?: string;
    picture?: string;
    lastContacted: number; // timestamp
    frequency: number; // count of interactions
  }

  const [recentContacts, setRecentContacts] = createSignal<RecentContact[]>([
    { email: "alice@example.com", name: "Alice Smith", lastContacted: Date.now(), frequency: 10 },
    { email: "bob@example.com", name: "Bob Jones", lastContacted: Date.now(), frequency: 8 },
    { email: "charlie@example.com", name: "Charlie Day", lastContacted: Date.now(), frequency: 5 },
  ]);

  // Card colors (stored locally since not in backend yet)
  const [cardColors, setCardColors] = createSignal<Record<string, CardColor>>(
    safeGetJSON<Record<string, CardColor>>("cardColors", {})
  );

  // Settings form
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");

  // Preset selection for new accounts
  const [showPresetSelection, setShowPresetSelection] = createSignal(false);

  interface CardPreset {
    name: string;
    query: string;
    color?: CardColor;
  }

  const PRESETS: Record<string, { label: string; description: string; cards: CardPreset[] }> = {
    posta: {
      label: "Posta",
      description: "Focus on what matters",
      cards: [
        { name: "Hot", query: "is:important newer_than:1d", color: "blue" },
        { name: "Meh", query: "category:promotions OR category:updates OR category:social -is:important -is:starred", color: "red" },
        { name: "Files", query: "has:attachment newer_than:1d", color: "purple" },
      ],
    },
    traditional: {
      label: "Traditional",
      description: "The familiar setup",
      cards: [
        { name: "Inbox", query: "is:inbox", color: "blue" },
        { name: "Starred", query: "is:starred", color: "yellow" },
        { name: "Drafts", query: "is:draft", color: "orange" },
        { name: "Sent", query: "in:sent", color: "green" },
      ],
    },
    power: {
      label: "Power User",
      description: "Track everything",
      cards: [
        { name: "Hot", query: "is:important newer_than:1d", color: "blue" },
        { name: "Waiting", query: "in:sent newer_than:7d", color: "yellow" },
        { name: "Drafts", query: "is:draft", color: "orange" },
        { name: "Meh", query: "category:promotions OR category:updates OR category:social -is:important -is:starred", color: "red" },
      ],
    },
    empty: {
      label: "Blank",
      description: "Build from scratch",
      cards: [],
    },
  };

  // Auto-refresh interval
  const AUTO_REFRESH_INTERVAL = 60000; // 1 minute
  let refreshIntervalId: number | undefined;

  // Drag and drop
  const cardIds = () => cards().map(c => c.id);
  let wasDragging = false;

  const onDragStart = () => {
    wasDragging = true;
  };

  const onDragEnd = async ({ draggable, droppable }: { draggable: any; droppable: any }) => {
    // Reset drag flag after a short delay to prevent click from firing
    setTimeout(() => { wasDragging = false; }, 50);
    if (draggable && droppable) {
      const currentIds = cardIds();
      const fromIndex = currentIds.indexOf(draggable.id);
      const toIndex = currentIds.indexOf(droppable.id);
      if (fromIndex !== toIndex) {
        const currentCards = [...cards()];
        const [movedCard] = currentCards.splice(fromIndex, 1);
        currentCards.splice(toIndex, 0, movedCard);

        const reorderedCards = currentCards.map((card, index) => ({
          ...card,
          position: index
        }));

        setCards(reorderedCards);

        try {
          for (const card of reorderedCards) {
            await updateCard(card);
          }
        } catch (err) {
          console.error("Failed to persist card order:", err);
        }
      }
    }
  };

  // Update dock badge with total unread count
  createEffect(() => {
    const threads = cardThreads();
    let totalUnread = 0;

    for (const groups of Object.values(threads)) {
      for (const group of groups) {
        for (const thread of group.threads) {
          if (thread.unread_count > 0) {
            totalUnread++;
          }
        }
      }
    }

    // Update badge (undefined removes it)
    getCurrentWindow().setBadgeCount(totalUnread > 0 ? totalUnread : undefined).catch(() => {
      // Badge not supported on this platform
    });
  });

  onMount(async () => {
    // Apply saved card width
    const savedWidth = safeGetItem("cardWidth");
    if (savedWidth) {
      document.documentElement.style.setProperty("--card-width", `${savedWidth}px`);
    }

    // Listen for color scheme changes
    const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handleColorSchemeChange = (e: MediaQueryListEvent) => {
      const cardRow = document.querySelector(".card-row") as HTMLElement;
      if (cardRow?.dataset.bgLight || cardRow?.dataset.bgDark) {
        cardRow.style.background = e.matches ? cardRow.dataset.bgDark! : cardRow.dataset.bgLight!;
      }
    };
    colorSchemeQuery?.addEventListener("change", handleColorSchemeChange);

    // Set snippet lines CSS variable
    document.documentElement.style.setProperty("--snippet-lines", String(snippetLines));

    try {
      await initApp();

      // Configure auth from stored credentials if available
      const storedCreds = await getStoredCredentials();
      if (storedCreds) {
        await configureAuth({
          client_id: storedCreds.client_id,
          client_secret: storedCreds.client_secret,
        });
      }

      const accts = await getAccounts();
      setAccounts(accts);
      if (accts.length > 0) {
        setSelectedAccount(accts[0]);
        const cardList = await getCards(accts[0].id);
        setCards(cardList);
        // Load collapsed state from localStorage, defaulting to expanded
        const savedCollapsed = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
        const collapsed: Record<string, boolean> = {};
        cardList.forEach(c => { collapsed[c.id] = savedCollapsed[c.id] ?? false; });
        setCollapsedCards(collapsed);

        // Auto-fetch threads for all cards
        for (const card of cardList) {
          if (!collapsed[card.id]) {
            loadCardThreads(card.id);
          }
        }

        // Set up auto-refresh
        refreshIntervalId = window.setInterval(() => {
          refreshAllCards();
        }, AUTO_REFRESH_INTERVAL);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      // Apply saved background color after UI is rendered
      const savedBgColorIndex = safeGetItem("bgColorIndex");
      if (savedBgColorIndex !== null) {
        setTimeout(() => applyBgColor(parseInt(savedBgColorIndex)), 0);
      }
    }
  });

  onCleanup(() => {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
    }
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
  });

  // Helper to get all threads from a card as a flat array
  function getCardThreadsFlat(cardId: string): Thread[] {
    const groups = cardThreads()[cardId] || [];
    return groups.flatMap(g => g.threads);
  }

  // Get the focused thread
  function getFocusedThread(): Thread | null {
    const cardId = focusedCardId();
    const idx = focusedThreadIndex();
    if (!cardId || idx < 0) return null;
    const threads = getCardThreadsFlat(cardId);
    return threads[idx] || null;
  }

  // Check if a specific thread in a card is focused
  function isThreadFocused(cardId: string, threadId: string): boolean {
    if (focusedCardId() !== cardId) return false;
    const idx = focusedThreadIndex();
    if (idx < 0) return false;
    const threads = getCardThreadsFlat(cardId);
    return threads[idx]?.gmail_thread_id === threadId;
  }

  // Global keyboard shortcuts
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Cmd/Ctrl+F to open filter (works even when typing)
    if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setShowGlobalFilter(true);
      setTimeout(() => filterInputRef?.focus(), 0);
      return;
    }

    // Skip other shortcuts if typing in an input
    if (isTyping) {
      return;
    }

    // / to open filter
    if (e.key === '/') {
      e.preventDefault();
      setShowGlobalFilter(true);
      setTimeout(() => filterInputRef?.focus(), 0);
      return;
    }

    // ? to open keyboard shortcuts help
    if (e.key === '?') {
      e.preventDefault();
      setShortcutsHelpOpen(true);
      return;
    }

    // z to undo last action (when toast is visible)
    if (e.key === 'z' && toastVisible() && lastAction()) {
      e.preventDefault();
      undoLastAction();
      return;
    }

    if (e.key === 'Escape') {
      // Priority: filter > dropdowns > color pickers > batch reply > compose > card editing > sidebar > action menu > focus
      if (showGlobalFilter()) {
        setShowGlobalFilter(false);
        setGlobalFilter("");
      } else if (accountChooserOpen()) {
        setAccountChooserOpen(false);
      } else if (colorPickerOpen() || editColorPickerOpen() || bgColorPickerOpen()) {
        setColorPickerOpen(false);
        setEditColorPickerOpen(false);
        setBgColorPickerOpen(false);
      } else if (batchReplyOpen()) {
        closeBatchReply();
      } else if (composing()) {
        closeCompose();
      } else if (editingCardId()) {
        setEditingCardId(null);
      } else if (shortcutsHelpOpen()) {
        setShortcutsHelpOpen(false);
      } else if (settingsOpen()) {
        setSettingsOpen(false);
      } else if (actionConfigMenu()) {
        setActionConfigMenu(null);
      } else if (focusedCardId()) {
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
      }
      return;
    }

    // Cmd/Ctrl+Enter to save card when editing
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (editingCardId() && editCardName() && editCardQuery()) {
        e.preventDefault();
        saveEditCard();
      }
      return;
    }

    // Thread navigation - j/k for up/down
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const cardsList = cards().filter(c => !collapsedCards()[c.id]);
      if (cardsList.length === 0) return;

      let cardId = focusedCardId();
      let idx = focusedThreadIndex();

      // If no focus, start at first card first thread
      if (!cardId) {
        cardId = cardsList[0].id;
        idx = e.key === 'j' ? 0 : -1;
      }

      const threads = getCardThreadsFlat(cardId);
      const newIdx = e.key === 'j' ? idx + 1 : idx - 1;

      if (newIdx >= 0 && newIdx < threads.length) {
        // Move within same card
        setFocusedCardId(cardId);
        setFocusedThreadIndex(newIdx);
      } else if (e.key === 'j' && newIdx >= threads.length) {
        // Move to next card
        const cardIndex = cardsList.findIndex(c => c.id === cardId);
        if (cardIndex < cardsList.length - 1) {
          const nextCardId = cardsList[cardIndex + 1].id;
          setFocusedCardId(nextCardId);
          setFocusedThreadIndex(0);
        }
      } else if (e.key === 'k' && newIdx < 0 && idx >= 0) {
        // Move to previous card
        const cardIndex = cardsList.findIndex(c => c.id === cardId);
        if (cardIndex > 0) {
          const prevCardId = cardsList[cardIndex - 1].id;
          const prevThreads = getCardThreadsFlat(prevCardId);
          setFocusedCardId(prevCardId);
          setFocusedThreadIndex(prevThreads.length - 1);
        }
      }
      return;
    }

    // Enter to open thread view
    if (e.key === 'Enter') {
      const thread = getFocusedThread();
      const cardId = focusedCardId();
      if (thread && cardId) {
        openThread(thread.gmail_thread_id, cardId);
      }
      return;
    }

    // Quick actions on focused thread
    const thread = getFocusedThread();
    const cardId = focusedCardId();
    if (thread && cardId) {
      if (e.key === 'a') {
        e.preventDefault();
        handleThreadAction('archive', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 's') {
        e.preventDefault();
        handleThreadAction('star', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'd' || e.key === '#') {
        e.preventDefault();
        handleThreadAction('trash', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'r') {
        e.preventDefault();
        setQuickReplyThreadId(thread.gmail_thread_id);
        setQuickReplyCardId(cardId);
        return;
      }
      if (e.key === 'u') {
        e.preventDefault();
        handleThreadAction('unread', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'f') {
        e.preventDefault();
        handleForward(thread.gmail_thread_id, cardId);
        return;
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    document.addEventListener('click', handleGlobalClick);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleGlobalKeyDown);
    document.removeEventListener('click', handleGlobalClick);
  });

  function handleGlobalClick(e: MouseEvent) {
    // Close account chooser when clicking outside
    const target = e.target as HTMLElement;
    if (accountChooserOpen() && !target.closest('.account-chooser-container')) {
      setAccountChooserOpen(false);
    }
  }

  async function refreshAllCards() {
    const cardList = cards();
    const collapsed = collapsedCards();
    for (const card of cardList) {
      if (!collapsed[card.id] && !loadingThreads()[card.id]) {
        loadCardThreads(card.id);
      }
    }
  }

  async function handleSignIn() {
    const storedCreds = await getStoredCredentials();

    if (!storedCreds) {
      // No credentials stored - open settings to configure OAuth
      setSettingsOpen(true);
      setError("Connect your Google account in Settings");
      return;
    }

    setAuthLoading(true);
    setError(null);
    try {
      await configureAuth({
        client_id: storedCreds.client_id,
        client_secret: storedCreds.client_secret,
      });

      const account = await runOAuthFlow();
      setAccounts([...accounts(), account]);
      setSelectedAccount(account);
      const cardList = await getCards(account.id);
      setCards(cardList);

      // Show preset selection if no cards exist
      if (cardList.length === 0) {
        setShowPresetSelection(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAuthLoading(false);
    }
  }

  async function applyPreset(presetKey: string) {
    const account = selectedAccount();
    if (!account) return;

    const preset = PRESETS[presetKey];
    if (!preset) return;

    try {
      const newCards: Card[] = [];
      const newColors: Record<string, CardColor> = { ...cardColors() };

      for (const cardPreset of preset.cards) {
        const card = await createCard(account.id, cardPreset.name, cardPreset.query);
        newCards.push(card);
        if (cardPreset.color) {
          newColors[card.id] = cardPreset.color;
        }
      }

      setCards(newCards);
      saveCardColors(newColors);

      // Initialize collapsed state
      const collapsed: Record<string, boolean> = {};
      newCards.forEach(c => { collapsed[c.id] = false; });
      setCollapsedCards(collapsed);

      setShowPresetSelection(false);

      // Fetch threads for all new cards
      newCards.forEach(card => loadCardThreads(card.id));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSaveSettings() {
    if (!clientId() || !clientSecret()) return;

    // configureAuth stores credentials securely on the backend
    await configureAuth({
      client_id: clientId(),
      client_secret: clientSecret(),
    });
    setSettingsOpen(false);
    handleSignIn();
  }

  async function toggleSettings() {
    if (!settingsOpen()) {
      // Load stored credentials when opening settings
      const storedCreds = await getStoredCredentials();
      if (storedCreds) {
        setClientId(storedCreds.client_id);
        setClientSecret(storedCreds.client_secret);
      }
    }
    setSettingsOpen(!settingsOpen());
  }

  async function handleSignOut() {
    const account = selectedAccount();
    if (!account) return;

    try {
      await deleteAccount(account.id);
      setAccounts(accounts().filter(a => a.id !== account.id));
      setSelectedAccount(null);
      setCards([]);
      setCardThreads({});
      // Clean up localStorage
      safeRemoveItem("cardColors");
      safeRemoveItem("collapsedCards");
      safeRemoveItem("cardGroupBy");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAddCard() {
    const account = selectedAccount();
    if (!account || !newCardName() || !newCardQuery()) return;

    try {
      const card = await createCard(account.id, newCardName(), newCardQuery());
      setCards([...cards(), card]);
      setCollapsedCards({ ...collapsedCards(), [card.id]: false });
      if (newCardColor()) {
        saveCardColors({ ...cardColors(), [card.id]: newCardColor() });
      }
      setGroupByForCard(card.id, newCardGroupBy());
      setNewCardName("");
      setNewCardQuery("");
      setNewCardColor(null);
      setNewCardGroupBy("date");
      setAddingCard(false);
      // Fetch threads for the new card
      loadCardThreads(card.id);
    } catch (e) {
      setError(String(e));
    }
  }

  function cancelAddCard() {
    setClosingAddCard(true);
    setTimeout(() => {
      setNewCardQuery("");
      setNewCardColor(null);
      setNewCardGroupBy("date");
      setColorPickerOpen(false);
      setAddingCard(false);
      setClosingAddCard(false);
    }, 200);
  }

  function closeCompose() {
    setClosingCompose(true);
    clearDraft(); // Clear draft from localStorage when compose closes
    setTimeout(() => {
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setShowCcBcc(false);
      setComposeSubject("");
      setComposeBody("");
      setForwardingThread(null);
      setReplyingToThread(null);
      setFocusComposeBody(false);
      setComposeEmailError(null);
      setComposeAttachments([]);
      setComposing(false);
      setClosingCompose(false);
    }, 200);
  }

  const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB Gmail limit

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const newAttachments: SendAttachment[] = [];
    const skippedFiles: string[] = [];

    for (const file of Array.from(input.files)) {
      // Check file size
      if (file.size > MAX_ATTACHMENT_SIZE) {
        skippedFiles.push(`${file.name} (${formatFileSize(file.size)} - max 25MB)`);
        continue;
      }

      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the "data:mime/type;base64," prefix
          resolve(result.split(',')[1] || '');
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        data,
      });
    }

    if (skippedFiles.length > 0) {
      setComposeEmailError(`Files too large: ${skippedFiles.join(', ')}`);
    }

    if (newAttachments.length > 0) {
      setComposeAttachments([...composeAttachments(), ...newAttachments]);
    }
    input.value = ''; // Reset input so same file can be selected again
  }

  function removeAttachment(index: number) {
    setComposeAttachments(composeAttachments().filter((_, i) => i !== index));
  }

  async function handleSendEmail() {
    const account = selectedAccount();
    if (!account || !composeTo().trim()) return;

    // Validate email addresses
    const toValidation = validateEmailList(composeTo());
    const ccValidation = validateEmailList(composeCc());
    const bccValidation = validateEmailList(composeBcc());

    const allInvalid = [
      ...toValidation.invalidEmails,
      ...ccValidation.invalidEmails,
      ...bccValidation.invalidEmails,
    ];

    if (allInvalid.length > 0) {
      setComposeEmailError(`Invalid email${allInvalid.length > 1 ? 's' : ''}: ${allInvalid.join(', ')}`);
      return;
    }

    setComposeEmailError(null);
    setSending(true);
    try {
      const reply = replyingToThread();
      const attachments = composeAttachments();
      if (reply) {
        // Sending as a reply to a thread
        await replyToThread(
          account.id,
          reply.threadId,
          composeTo(),
          composeCc(),
          composeBcc(),
          composeSubject(),
          composeBody(),
          reply.messageId,
          attachments
        );
      } else {
        // Sending a new email
        await sendEmail(account.id, composeTo(), composeCc(), composeBcc(), composeSubject(), composeBody(), attachments);
      }
      clearDraft();
      closeCompose();
    } catch (e) {
      console.error("Failed to send email:", e);
      setError(`Failed to send email: ${e}`);
    } finally {
      setSending(false);
    }
  }

  async function handleQuickReply() {
    const account = selectedAccount();
    const threadId = quickReplyThreadId();
    const cardId = quickReplyCardId();
    const text = quickReplyText();
    if (!account || !threadId || !cardId || !text.trim()) return;

    // Get thread info for reply
    const threads = getCardThreadsFlat(cardId);
    const thread = threads.find(t => t.gmail_thread_id === threadId);
    if (!thread) return;

    // Get the sender to reply to
    const replyTo = thread.participants[0] || "";
    const subject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;

    setQuickReplySending(true);
    try {
      await replyToThread(account.id, threadId, replyTo, "", "", subject, text);
      setQuickReplyThreadId(null);
      setQuickReplyCardId(null);
      setQuickReplyText("");
    } catch (e) {
      console.error("Failed to send reply:", e);
      setError(`Failed to send reply: ${e}`);
    } finally {
      setQuickReplySending(false);
    }
  }

  function handleForward(threadId: string, cardId: string) {
    // Find the thread
    const threads = getCardThreadsFlat(cardId);
    const thread = threads.find(t => t.gmail_thread_id === threadId);
    if (!thread) return;

    // Build forwarded subject and body
    const fwdSubject = thread.subject.startsWith("Fwd:") ? thread.subject : `Fwd: ${thread.subject}`;
    const quotedBody = `\n\n---------- Forwarded message ----------\nFrom: ${thread.participants[0] || 'Unknown'}\nSubject: ${thread.subject}\n\n${thread.snippet}`;

    // Open compose panel with forward content
    setForwardingThread({ threadId, subject: fwdSubject, body: quotedBody });
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject(fwdSubject);
    setComposeBody(quotedBody);
    setComposing(true);
  }

  function handleReplyFromThread(to: string, cc: string, subject: string, quotedBody: string, messageId: string) {
    const threadId = activeThreadId();
    if (!threadId) return;

    // Close thread view and open compose
    setActiveThreadId(null);
    setActiveThreadCardId(null);
    setFocusedMessageIndex(0);

    // Set up compose for reply
    setReplyingToThread({ threadId, messageId });
    setComposeTo(to);
    setComposeCc(cc);
    setComposeBcc("");
    setComposeSubject(subject);
    setComposeBody(quotedBody);
    setFocusComposeBody(true);
    setComposing(true);
  }

  function handleForwardFromThread(subject: string, body: string) {
    // Close thread view and open compose
    setActiveThreadId(null);
    setActiveThreadCardId(null);
    setFocusedMessageIndex(0);

    // Set up compose for forward
    setForwardingThread({ threadId: '', subject, body });
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject(subject);
    setComposeBody(body);
    setComposing(true);
  }

  // Label drawer functions
  async function fetchAccountLabels() {
    const account = selectedAccount();
    if (!account || accountLabels().length > 0) return; // Already cached

    setLabelsLoading(true);
    try {
      const labels = await listLabels(account.id);
      // Sort: user labels first (alphabetically), then system labels
      const sorted = labels.sort((a, b) => {
        if (a.label_type === 'user' && b.label_type !== 'user') return -1;
        if (a.label_type !== 'user' && b.label_type === 'user') return 1;
        return a.name.localeCompare(b.name);
      });
      setAccountLabels(sorted);
    } catch (e) {
      console.error("Failed to fetch labels:", e);
    } finally {
      setLabelsLoading(false);
    }
  }

  function getCurrentThreadLabels(): string[] {
    const thread = activeThread();
    if (!thread || !thread.messages.length) return [];
    // Get labels from the first message (thread-level labels)
    return thread.messages[0].labelIds || [];
  }

  function isThreadStarred(): boolean {
    return getCurrentThreadLabels().includes('STARRED');
  }

  function isThreadRead(): boolean {
    const thread = activeThread();
    if (!thread) return true;
    return !thread.messages.some(m => m.labelIds?.includes('UNREAD'));
  }

  function isThreadImportant(): boolean {
    return getCurrentThreadLabels().includes('IMPORTANT');
  }

  async function handleThreadViewAction(action: string) {
    const thread = activeThread();
    const account = selectedAccount();
    const cardId = activeThreadCardId();
    if (!thread || !account) return;

    // Close thread view after action (except for read/unread/important)
    const shouldClose = ['archive', 'trash', 'spam'].includes(action);

    await handleThreadAction(action, [thread.id], cardId || '');

    if (shouldClose) {
      setActiveThreadId(null);
      setActiveThreadCardId(null);
      setFocusedMessageIndex(0);
    } else {
      // Refresh thread to update state
      try {
        const updated = await getThreadDetails(account.id, thread.id);
        setActiveThread(updated);
      } catch (e) {
        console.error("Failed to refresh thread:", e);
      }
    }
  }

  async function handleToggleLabel(labelId: string, labelName: string, isAdding: boolean) {
    const thread = activeThread();
    const account = selectedAccount();
    if (!thread || !account) return;

    const addLabels = isAdding ? [labelId] : [];
    const removeLabels = isAdding ? [] : [labelId];

    try {
      await modifyThreads(account.id, [thread.id], addLabels, removeLabels);

      // Refresh thread to update labels
      const updated = await getThreadDetails(account.id, thread.id);
      setActiveThread(updated);

      showToast(`${isAdding ? 'Added' : 'Removed'} label "${labelName}"`);
    } catch (e) {
      console.error("Failed to modify labels:", e);
      setError(`Failed to ${isAdding ? 'add' : 'remove'} label: ${e}`);
    }
  }

  async function startBatchReply(cardId: string, threadIds: string[]) {
    const account = selectedAccount();
    if (!account || threadIds.length === 0) return;

    setBatchReplyLoading(true);
    setBatchReplyOpen(true);
    setBatchReplyCardId(cardId);
    setBatchReplyMessages({});
    setBatchReplySending({});

    // Helper to extract body from message
    const extractBody = (msg: any): string => {
      if (msg.payload?.body?.data) return decodeBase64Utf8(msg.payload.body.data);

      const findContent = (parts: any[] | undefined, mimeType: string): string | null => {
        if (!parts) return null;
        for (const part of parts) {
          if (part.mimeType === mimeType && part.body?.data) {
            return decodeBase64Utf8(part.body.data);
          }
          if (part.parts) {
            const found = findContent(part.parts, mimeType);
            if (found) return found;
          }
        }
        return null;
      };

      const htmlContent = findContent(msg.payload?.parts, 'text/html');
      if (htmlContent) return htmlContent;

      const textContent = findContent(msg.payload?.parts, 'text/plain');
      if (textContent) return `<pre style="white-space: pre-wrap; font-family: inherit;">${textContent}</pre>`;

      return msg.snippet || '(No content)';
    };

    try {
      const threads: BatchReplyThread[] = [];

      for (const threadId of threadIds) {
        try {
          const details = await getThreadDetails(account.id, threadId);
          if (details.messages && details.messages.length > 0) {
            const lastMsg = details.messages[details.messages.length - 1];
            const headers = lastMsg.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
            const date = lastMsg.internalDate
              ? new Date(parseInt(lastMsg.internalDate)).toLocaleDateString()
              : '';

            threads.push({
              threadId,
              subject,
              snippet: lastMsg.snippet || '',
              body: extractBody(lastMsg),
              from,
              date,
              messageId: lastMsg.id,
              to: extractEmail(from),
            });
          }
        } catch (e) {
          console.error(`Failed to fetch thread ${threadId}:`, e);
        }
      }

      setBatchReplyThreads(threads);
    } finally {
      setBatchReplyLoading(false);
    }
  }

  function closeBatchReply() {
    setBatchReplyOpen(false);
    setBatchReplyCardId(null);
    setBatchReplyThreads([]);
    setBatchReplyMessages({});
    setBatchReplySending({});
    setBatchReplyAttachments({});
  }

  function updateBatchReplyMessage(threadId: string, message: string) {
    setBatchReplyMessages({ ...batchReplyMessages(), [threadId]: message });
  }

  async function handleBatchReplyFileSelect(threadId: string, e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const newAttachments: SendAttachment[] = [];
    const skippedFiles: string[] = [];

    for (const file of Array.from(input.files)) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        skippedFiles.push(`${file.name} (${formatFileSize(file.size)} - max 25MB)`);
        continue;
      }

      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        data
      });
    }

    if (newAttachments.length > 0) {
      const current = batchReplyAttachments()[threadId] || [];
      setBatchReplyAttachments({ ...batchReplyAttachments(), [threadId]: [...current, ...newAttachments] });
    }
    input.value = '';
  }

  function removeBatchReplyAttachment(threadId: string, index: number) {
    const current = batchReplyAttachments()[threadId] || [];
    setBatchReplyAttachments({
      ...batchReplyAttachments(),
      [threadId]: current.filter((_, i) => i !== index)
    });
  }

  function discardBatchReplyThread(threadId: string) {
    setBatchReplyThreads(batchReplyThreads().filter(t => t.threadId !== threadId));
    const newMessages = { ...batchReplyMessages() };
    delete newMessages[threadId];
    setBatchReplyMessages(newMessages);
    const newAttachments = { ...batchReplyAttachments() };
    delete newAttachments[threadId];
    setBatchReplyAttachments(newAttachments);

    // Close if no more threads
    if (batchReplyThreads().length <= 1) {
      closeBatchReply();
    }
  }

  async function sendBatchReply(threadId: string) {
    const account = selectedAccount();
    const thread = batchReplyThreads().find(t => t.threadId === threadId);
    const message = batchReplyMessages()[threadId];
    const attachments = batchReplyAttachments()[threadId] || [];

    if (!account || !thread || !message?.trim()) return;

    setBatchReplySending({ ...batchReplySending(), [threadId]: true });

    try {
      const replySubject = thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`;
      await replyToThread(account.id, threadId, thread.to, "", "", replySubject, message, undefined, attachments);

      // Remove from batch reply list
      setBatchReplyThreads(batchReplyThreads().filter(t => t.threadId !== threadId));
      const newMessages = { ...batchReplyMessages() };
      delete newMessages[threadId];
      setBatchReplyMessages(newMessages);
      const newAttachments = { ...batchReplyAttachments() };
      delete newAttachments[threadId];
      setBatchReplyAttachments(newAttachments);

      // Refresh the card
      const cardId = batchReplyCardId();
      if (cardId) {
        fetchAndCacheThreads(account.id, cardId);
      }

      // Close if no more threads
      if (batchReplyThreads().length <= 1) {
        closeBatchReply();
        // Clear selection
        if (cardId) {
          setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
        }
      }
    } catch (e) {
      console.error('Failed to send reply:', e);
      alert(`Failed to send: ${e}`);
    } finally {
      setBatchReplySending({ ...batchReplySending(), [threadId]: false });
    }
  }

  async function sendAllBatchReplies() {
    const threads = batchReplyThreads();
    const messages = batchReplyMessages();

    // Only send threads that have messages
    const toSend = threads.filter(t => messages[t.threadId]?.trim());

    for (const thread of toSend) {
      await sendBatchReply(thread.threadId);
    }
  }

  function setCardColor(cardId: string, color: CardColor) {
    const newColors = { ...cardColors(), [cardId]: color };
    setCardColors(newColors);
    safeSetJSON("cardColors", newColors);
  }

  function saveCardColors(colors: Record<string, CardColor>) {
    setCardColors(colors);
    safeSetJSON("cardColors", colors);
  }

  function saveCollapsedState(collapsed: Record<string, boolean>) {
    setCollapsedCards(collapsed);
    safeSetJSON("collapsedCards", collapsed);
  }

  function startEditCard(card: Card, e: MouseEvent) {
    e.stopPropagation();
    setEditingCardId(card.id);
    setEditCardName(card.name);
    setEditCardQuery(card.query);
    setEditCardColor(cardColors()[card.id] || null);
    setEditColorPickerOpen(false);
    // Fetch initial preview
    fetchQueryPreview(card.query);
  }

  async function saveEditCard() {
    const cardId = editingCardId();
    if (!cardId) return;

    const card = cards().find(c => c.id === cardId);
    if (!card) return;

    const queryChanged = card.query !== editCardQuery();

    try {
      const updatedCard: Card = {
        ...card,
        name: editCardName(),
        query: editCardQuery(),
      };
      await updateCard(updatedCard);
      setCards(cards().map(c => c.id === cardId ? updatedCard : c));
      saveCardColors({ ...cardColors(), [cardId]: editCardColor() });
      setEditingCardId(null);

      // If query changed, clear cache and refresh
      if (queryChanged) {
        await clearCardCache(cardId);
        setCardThreads(prev => {
          const updated = { ...prev };
          delete updated[cardId];
          return updated;
        });
        setCardNextPageToken(prev => {
          const updated = { ...prev };
          delete updated[cardId];
          return updated;
        });
        loadCardThreads(cardId);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  function cancelEditCard() {
    setEditingCardId(null);
    setEditCardName("");
    setEditCardQuery("");
  }

  async function handleDeleteCard(cardId: string) {
    try {
      await deleteCard(cardId);
      setCards(cards().filter(c => c.id !== cardId));
      setEditingCardId(null);
      // Clean up related state
      const newColors = { ...cardColors() };
      const { [cardId]: _, ...remainingColors } = newColors;
      saveCardColors(remainingColors);

      const newCollapsed = { ...collapsedCards() };
      const { [cardId]: __, ...remainingCollapsed } = newCollapsed;
      saveCollapsedState(remainingCollapsed);
    } catch (err) {
      console.error("Failed to delete card:", err);
      alert(`Failed to delete card: ${err}`);
    }
  }

  function selectEditColor(color: CardColor) {
    setEditCardColor(color);
    setEditColorPickerOpen(false);
  }

  async function toggleCardCollapse(cardId: string) {
    const isCollapsed = collapsedCards()[cardId];
    const newCollapsed = { ...collapsedCards(), [cardId]: !isCollapsed };
    saveCollapsedState(newCollapsed);

    const account = selectedAccount();
    if (isCollapsed && account && !cardThreads()[cardId]) {
      loadCardThreads(cardId);
    }
  }

  async function loadCardThreads(cardId: string, append = false, forceRefresh = false) {
    const account = selectedAccount();
    if (!account) return;

    // Prevent concurrent pagination requests for the same card
    if (append && loadingMore()[cardId]) return;

    // Prevent concurrent initial loads (unless force refresh)
    if (!append && !forceRefresh && loadingThreads()[cardId]) return;

    if (append) {
      setLoadingMore({ ...loadingMore(), [cardId]: true });
    } else {
      setLoadingThreads({ ...loadingThreads(), [cardId]: true });
      setCardErrors({ ...cardErrors(), [cardId]: null });
    }

    try {
      // For initial load (not append), try cache first (unless force refresh)
      if (!append && !forceRefresh) {
        const cached = await getCachedCardThreads(cardId);
        if (cached && cached.groups.length > 0) {
          // Show cached data immediately
          setCardThreads({ ...cardThreads(), [cardId]: cached.groups });
          setCardPageTokens({ ...cardPageTokens(), [cardId]: cached.next_page_token });
          setCardHasMore({ ...cardHasMore(), [cardId]: !!cached.next_page_token });
          // cached_at is in seconds (Unix timestamp), convert to milliseconds
          setLastSyncTimes({ ...lastSyncTimes(), [cardId]: cached.cached_at * 1000 });
          setLoadingThreads({ ...loadingThreads(), [cardId]: false });

          // Fetch fresh data in background (don't await)
          fetchAndCacheThreads(account.id, cardId);
          return;
        }
      }

      const pageToken = append ? cardPageTokens()[cardId] : null;
      const result = await fetchThreadsPaginated(account.id, cardId, pageToken);

      if (append) {
        // Merge new threads into existing groups
        const existingGroups = cardThreads()[cardId] || [];
        const mergedGroups = mergeThreadGroups(existingGroups, result.groups);
        setCardThreads({ ...cardThreads(), [cardId]: mergedGroups });
        // Save merged groups to cache
        await saveCachedCardThreads(cardId, mergedGroups, result.next_page_token);
      } else {
        setCardThreads({ ...cardThreads(), [cardId]: result.groups });
        // Save to cache
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      }

      setCardPageTokens({ ...cardPageTokens(), [cardId]: result.next_page_token });
      setCardHasMore({ ...cardHasMore(), [cardId]: result.has_more });
      setLastSyncTimes({ ...lastSyncTimes(), [cardId]: Date.now() });
      setSyncErrors({ ...syncErrors(), [cardId]: null });
    } catch (e) {
      const errorMsg = String(e);
      if (errorMsg.includes("Keyring error") || errorMsg.includes("No auth token")) {
        // Auto sign out on session expiry
        setError("Session expired");
        setTimeout(async () => {
          await handleSignOut();
          setError(null);
        }, 1500);
      } else {
        setCardErrors({ ...cardErrors(), [cardId]: errorMsg });
        setSyncErrors({ ...syncErrors(), [cardId]: errorMsg });
      }
    } finally {
      if (append) {
        setLoadingMore({ ...loadingMore(), [cardId]: false });
      } else {
        setLoadingThreads({ ...loadingThreads(), [cardId]: false });
      }
    }
  }

  // Background fetch and cache update (no loading state shown)
  async function fetchAndCacheThreads(accountId: string, cardId: string) {
    try {
      const result = await fetchThreadsPaginated(accountId, cardId, null);
      setCardThreads({ ...cardThreads(), [cardId]: result.groups });
      setCardPageTokens({ ...cardPageTokens(), [cardId]: result.next_page_token });
      setCardHasMore({ ...cardHasMore(), [cardId]: result.has_more });
      await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      setLastSyncTimes({ ...lastSyncTimes(), [cardId]: Date.now() });
      setSyncErrors({ ...syncErrors(), [cardId]: null });
    } catch (e) {
      // Background refresh failed - set sync error but keep cached data shown
      setSyncErrors({ ...syncErrors(), [cardId]: String(e) });
    }
  }

  function getGroupByForCard(cardId: string): GroupBy {
    return cardGroupBy()[cardId] || "date";
  }

  function setGroupByForCard(cardId: string, groupBy: GroupBy) {
    const newGroupBy = { ...cardGroupBy(), [cardId]: groupBy };
    setCardGroupBy(newGroupBy);
    safeSetJSON("cardGroupBy", newGroupBy);
  }

  function updateCardWidth(width: number) {
    setCardWidth(width);
    safeSetItem("cardWidth", String(width));
    document.documentElement.style.setProperty("--card-width", `${width}px`);
  }

  function toggleActionSetting(key: string) {
    const newSettings = { ...actionSettings(), [key]: !actionSettings()[key] };
    setActionSettings(newSettings);
    safeSetJSON("actionSettings", newSettings);
  }

  function moveActionInOrder(fromIndex: number, toIndex: number) {
    const order = [...actionOrder()];
    const [item] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, item);
    setActionOrder(order);
    safeSetJSON("actionOrder", order);
  }

  function selectBgColor(colorIndex: number | null) {
    setSelectedBgColorIndex(colorIndex);
    setBgColorPickerOpen(false);
    applyBgColor(colorIndex);
    if (colorIndex !== null) {
      safeSetItem("bgColorIndex", String(colorIndex));
    } else {
      safeRemoveItem("bgColorIndex");
    }
  }

  function applyBgColor(colorIndex: number | null) {
    const cardRow = document.querySelector(".card-row") as HTMLElement;
    if (!cardRow) return;

    if (colorIndex === null) {
      cardRow.style.background = "";
      delete cardRow.dataset.bgLight;
      delete cardRow.dataset.bgDark;
      document.documentElement.style.setProperty("--accent", "#4285f4");
    } else {
      const color = BG_COLORS[colorIndex];
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      cardRow.style.background = isDark ? color.dark : color.light;
      cardRow.dataset.bgLight = color.light;
      cardRow.dataset.bgDark = color.dark;
      document.documentElement.style.setProperty("--accent", color.hex);
    }
  }

  function regroupThreads(threads: ThreadGroup[], groupBy: GroupBy): ThreadGroup[] {
    // Flatten all threads first
    const allThreads = threads.flatMap(g => g.threads);

    if (groupBy === "date") {
      // Already grouped by date from API, just return as-is
      return threads;
    }

    if (groupBy === "sender") {
      const groups: Record<string, typeof allThreads> = {};
      for (const thread of allThreads) {
        const sender = thread.participants[0] || "Unknown";
        if (!groups[sender]) groups[sender] = [];
        groups[sender].push(thread);
      }
      // Sort by sender name, then by date within each group
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, threads]) => ({
          label,
          threads: threads.sort((a, b) => b.last_message_date - a.last_message_date),
        }));
    }

    if (groupBy === "label") {
      const groups: Record<string, typeof allThreads> = {};
      for (const thread of allThreads) {
        // Use the first non-system label, or "Inbox" as fallback
        const label = thread.labels.find(l => !l.startsWith("CATEGORY_") && l !== "UNREAD" && l !== "STARRED") || "Inbox";
        if (!groups[label]) groups[label] = [];
        groups[label].push(thread);
      }
      // Sort labels alphabetically
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, threads]) => ({
          label,
          threads: threads.sort((a, b) => b.last_message_date - a.last_message_date),
        }));
    }

    return threads;
  }

  function getDisplayGroups(cardId: string): ThreadGroup[] {
    const threads = cardThreads()[cardId];
    if (!threads) return [];
    const groupBy = getGroupByForCard(cardId);
    let groups = regroupThreads(threads, groupBy);

    // Apply global filter
    const filter = globalFilter().toLowerCase().trim();
    if (filter) {
      groups = groups.map(group => ({
        ...group,
        threads: group.threads.filter(thread =>
          thread.subject.toLowerCase().includes(filter) ||
          thread.snippet.toLowerCase().includes(filter) ||
          thread.participants.some(p => p.toLowerCase().includes(filter))
        )
      })).filter(group => group.threads.length > 0);
    }

    return groups;
  }

  function getCardUnreadCount(cardId: string): number {
    const groups = cardThreads()[cardId];
    if (!groups) return 0;
    return groups.reduce((total, group) =>
      total + group.threads.filter(t => t.unread_count > 0).length, 0);
  }

  function mergeThreadGroups(existing: ThreadGroup[], incoming: ThreadGroup[]): ThreadGroup[] {
    const groups: Record<string, ThreadGroup> = {};

    // Add existing threads
    for (const group of existing) {
      groups[group.label] = { ...group, threads: [...group.threads] };
    }

    // Merge incoming threads
    for (const group of incoming) {
      if (groups[group.label]) {
        // Add new threads, avoiding duplicates
        const existingIds = new Set(groups[group.label].threads.map(t => t.gmail_thread_id));
        for (const thread of group.threads) {
          if (!existingIds.has(thread.gmail_thread_id)) {
            groups[group.label].threads.push(thread);
          }
        }
      } else {
        groups[group.label] = { ...group, threads: [...group.threads] };
      }
    }

    // Return in date order
    const order = ["Today", "Yesterday", "This week", "Last 30 days", "Older"];
    return order.filter(label => groups[label]).map(label => groups[label]);
  }

  async function refreshCard(cardId: string, e: MouseEvent) {
    e.stopPropagation();
    await loadCardThreads(cardId, false, true);
  }

  async function openAttachment(
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string,
    inlineData?: string | null
  ) {
    const account = selectedAccount();
    if (!account) return;

    try {
      let base64Data: string;
      if (inlineData) {
        base64Data = inlineData;
      } else {
        base64Data = await downloadAttachment(account.id, messageId, attachmentId);
      }

      const blob = base64ToBlob(base64Data, mimeType);
      const url = URL.createObjectURL(blob);

      // Open in new tab for images/PDFs, or download for others
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('Failed to open attachment:', e);
      setError(`Failed to open attachment: ${e}`);
    }
  }

  // Close menus when clicking outside
  function handleAppClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.color-picker') && !target.closest('.bg-color-picker')) {
      setColorPickerOpen(false);
      setEditColorPickerOpen(false);
      setBgColorPickerOpen(false);
    }
    if (!target.closest('.thread')) {
      setActionsWheelOpen(false);
      setHoveredThread(null);
    }
    if (!target.closest('.quick-reply-container')) {
      setQuickReplyThreadId(null);
    }
    if (!target.closest('.action-config-menu')) {
      setActionConfigMenu(null);
    }
  }

  function selectColor(color: CardColor) {
    setNewCardColor(color);
    setColorPickerOpen(false);
  }

  // Get all unique participants from loaded threads as potential contacts
  function getContactCandidates(): RecentContact[] {
    const threads = cardThreads();
    const account = selectedAccount();
    const myEmail = account?.email?.toLowerCase();
    const contactMap = new Map<string, { email: string; name?: string; lastSeen: number; count: number }>();

    Object.values(threads).forEach(groups => {
      groups.forEach(group => {
        group.threads.forEach(thread => {
          thread.participants.forEach(participant => {
            // Parse "Name <email>" format
            const { email, name } = parseContact(participant);
            const emailLower = email.toLowerCase();

            // Skip own email
            if (emailLower === myEmail) return;

            const existing = contactMap.get(emailLower);
            if (existing) {
              existing.count++;
              // Keep the name if we found one (prefer named entries)
              if (name && !existing.name) {
                existing.name = name;
              }
              if (thread.last_message_date > existing.lastSeen) {
                existing.lastSeen = thread.last_message_date;
              }
            } else {
              contactMap.set(emailLower, {
                email,
                name,
                lastSeen: thread.last_message_date,
                count: 1,
              });
            }
          });
        });
      });
    });

    // Convert to array and sort by combined score (recency + frequency)
    const candidates = Array.from(contactMap.values())
      .map(c => ({
        email: c.email,
        name: c.name,
        lastContacted: c.lastSeen,
        frequency: c.count,
      }))
      .sort((a, b) => {
        // Score: higher frequency = better, more recent = better
        const now = Date.now();
        const recencyScoreA = 1 / (1 + (now - a.lastContacted) / (1000 * 60 * 60 * 24)); // decay over days
        const recencyScoreB = 1 / (1 + (now - b.lastContacted) / (1000 * 60 * 60 * 24));
        const scoreA = a.frequency * 0.4 + recencyScoreA * 100 * 0.6;
        const scoreB = b.frequency * 0.4 + recencyScoreB * 100 * 0.6;
        return scoreB - scoreA;
      });

    return candidates.slice(0, 8); // Top 8 candidates
  }

  // Gmail search autocomplete suggestions
  function getQuerySuggestions(query: string): { text: string; desc: string; replace: { start: number; end: number } }[] {
    if (!query) return [];

    // Find the current "word" being typed (last token after space)
    const lastSpaceIndex = query.lastIndexOf(' ');
    const currentToken = query.slice(lastSpaceIndex + 1).toLowerCase();
    const tokenStart = lastSpaceIndex + 1;

    if (!currentToken) return [];

    const suggestions: { text: string; desc: string; replace: { start: number; end: number } }[] = [];

    // Check if we're typing after an operator that takes email values
    const emailOperators = ['from:', 'to:', 'cc:', 'bcc:', 'deliveredto:'];
    for (const op of emailOperators) {
      if (currentToken.startsWith(op)) {
        const searchPart = currentToken.slice(op.length).toLowerCase();
        if (searchPart) {
          // Suggest contacts matching the email or name
          const contacts = getContactCandidates();
          for (const contact of contacts) {
            const matchesEmail = contact.email.toLowerCase().includes(searchPart);
            const matchesName = contact.name?.toLowerCase().includes(searchPart);
            if (matchesEmail || matchesName) {
              suggestions.push({
                text: op + contact.email,
                desc: contact.name ? `${contact.name} (${contact.frequency} emails)` : `${contact.frequency} emails`,
                replace: { start: tokenStart, end: query.length },
              });
              if (suggestions.length >= 6) break;
            }
          }
        }
        return suggestions;
      }
    }

    // Fuzzy match operators
    for (const { op, desc } of GMAIL_OPERATORS) {
      // Match if the operator starts with the current token or contains it
      if (op.toLowerCase().startsWith(currentToken) ||
        (currentToken.length >= 2 && op.toLowerCase().includes(currentToken))) {
        suggestions.push({
          text: op,
          desc,
          replace: { start: tokenStart, end: query.length },
        });
        if (suggestions.length >= 8) break;
      }
    }

    return suggestions;
  }

  function applyQuerySuggestion(suggestion: { text: string; replace: { start: number; end: number } }) {
    const query = getCurrentQuery();
    const setQuery = activeQuerySetter();
    if (!setQuery) return;

    const before = query.slice(0, suggestion.replace.start);
    const newQuery = before + suggestion.text + (suggestion.text.endsWith(':') ? '' : ' ');
    setQuery(newQuery);
    setQueryAutocompleteOpen(false);
    debounceQueryPreview(newQuery);
    // Focus back on input
    queryInputRef()?.focus();
  }

  async function openThread(threadId: string, cardId: string) {
    const account = selectedAccount();
    if (!account) {
      console.error("No account selected");
      return;
    }

    setActiveThreadId(threadId);
    setActiveThreadCardId(cardId);
    setThreadLoading(true);
    setThreadError(null);
    setActiveThread(null);
    setFocusedMessageIndex(0);

    try {
      const details = await getThreadDetails(account.id, threadId);
      setActiveThread(details);
    } catch (e) {
      console.error("Failed to load thread details", e);
      setThreadError("Failed to load email. Please try again.");
    } finally {
      setThreadLoading(false);
    }
  }

  function showToast() {
    clearTimeout(toastTimeoutId);
    setToastClosing(false);
    setToastVisible(true);
    toastTimeoutId = window.setTimeout(() => {
      hideToast();
    }, 5000);
  }

  function hideToast() {
    setToastClosing(true);
    setTimeout(() => {
      setToastVisible(false);
      setToastClosing(false);
      setLastAction(null); // Expire undo when toast closes
    }, 200);
  }

  async function undoLastAction() {
    const action = lastAction();
    const account = selectedAccount();
    if (!action || !account) return;

    hideToast();

    // Reverse the labels: add what was removed, remove what was added
    try {
      await modifyThreads(account.id, action.threadIds, action.removedLabels, action.addedLabels);
      // Reload the card to get fresh data
      loadCardThreads(action.cardId);
    } catch (e) {
      console.error("Failed to undo action", e);
      setError(String(e));
    }
    setLastAction(null);
  }

  function getActionLabel(action: string, count: number): string {
    const plural = count > 1 ? 's' : '';
    switch (action) {
      case 'archive': return `Archived ${count} thread${plural}`;
      case 'star': return `Starred ${count} thread${plural}`;
      case 'unstar': return `Removed star from ${count} thread${plural}`;
      case 'trash': return `Deleted ${count} thread${plural}`;
      case 'read': return `Marked ${count} thread${plural} as read`;
      case 'unread': return `Marked ${count} thread${plural} as unread`;
      case 'important': return `Marked ${count} thread${plural} as important`;
      case 'notImportant': return `Marked ${count} thread${plural} as not important`;
      case 'spam': return `Moved ${count} thread${plural} to spam`;
      default: return `Modified ${count} thread${plural}`;
    }
  }

  async function handleThreadAction(action: string, threadIds: string[], cardId: string) {
    const account = selectedAccount();
    if (!account) return;

    // Confirm destructive bulk actions
    if (threadIds.length > 1 && (action === 'archive' || action === 'trash' || action === 'spam')) {
      const actionText = action === 'trash' ? 'delete' : action === 'spam' ? 'move to spam' : 'archive';
      if (!confirm(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} ${threadIds.length} threads?`)) {
        return;
      }
    }

    let addLabels: string[] = [];
    let removeLabels: string[] = [];

    switch (action) {
      case 'archive':
        removeLabels.push("INBOX");
        break;
      case 'star':
        addLabels.push("STARRED");
        break;
      case 'unstar':
        removeLabels.push("STARRED");
        break;
      case 'trash':
        addLabels.push("TRASH");
        break;
      case 'read':
        removeLabels.push("UNREAD");
        break;
      case 'unread':
        addLabels.push("UNREAD");
        break;
      case 'important':
        addLabels.push("IMPORTANT");
        break;
      case 'notImportant':
        removeLabels.push("IMPORTANT");
        break;
      case 'spam':
        addLabels.push("SPAM");
        removeLabels.push("INBOX");
        break;
    }

    // Optimistic Update - update ALL cards that contain these threads
    const allCardThreads = cardThreads();
    const updatedCardThreads: Record<string, ThreadGroup[]> = {};

    for (const [cId, groups] of Object.entries(allCardThreads)) {
      if (!groups) continue;
      updatedCardThreads[cId] = groups.map(group => ({
        ...group,
        threads: group.threads.map(t => {
          if (threadIds.includes(t.gmail_thread_id)) {
            let newLabels = [...t.labels];
            addLabels.forEach(l => { if (!newLabels.includes(l)) newLabels.push(l); });
            removeLabels.forEach(l => { newLabels = newLabels.filter(lbl => lbl !== l); });
            // Update unread count for read/unread actions
            let newUnreadCount = t.unread_count;
            if (action === 'read') newUnreadCount = 0;
            if (action === 'unread' && newUnreadCount === 0) newUnreadCount = 1;
            return { ...t, labels: newLabels, unread_count: newUnreadCount };
          }
          return t;
        }).filter(t => {
          // Optimistic removal for Archive/Trash/Spam
          if ((action === 'archive' || action === 'trash' || action === 'spam') && threadIds.includes(t.gmail_thread_id)) {
            return false;
          }
          return true;
        })
      }));
    }

    setCardThreads(updatedCardThreads);
    setActionsWheelOpen(false);

    // Clear selection after bulk action
    if (threadIds.length > 1) {
      setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
    }

    try {
      await modifyThreads(account.id, threadIds, addLabels, removeLabels);
      // Store undo state and show toast
      setLastAction({
        action,
        threadIds,
        cardId,
        addedLabels: addLabels,
        removedLabels: removeLabels,
        timestamp: Date.now()
      });
      showToast();
    } catch (e) {
      console.error("Failed to modify threads", e);
      setError(String(e));
    }
  }

  // Half Pie Menu Component
  const ActionsWheel = (props: {
    cardId: string;
    threadId: string | null;
    thread?: Thread | null;
    selectedCount: number;
    open: boolean;
    onClose: () => void;
  }) => {
    const settings = actionSettings();
    const actions: { cls: string; title: string, keyHint?: string, icon: () => JSX.Element, onClick: (e: MouseEvent) => void }[] = [];
    const containerRef = (el: HTMLDivElement) => {
      // Simple animation trigger
      setTimeout(() => el.classList.add('open'), 10);
    };

    const selection = props.cardId ? (selectedThreads()[props.cardId] || new Set<string>()) : new Set<string>();

    // Get thread state for icon selection
    const isStarred = props.thread?.labels?.includes("STARRED") ?? false;
    const isImportant = props.thread?.labels?.includes("IMPORTANT") ?? false;
    const isRead = (props.thread?.unread_count ?? 0) === 0;

    const order = actionOrder();

    // Action definitions - use order from settings
    const actionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; bulkTitle?: string; bulkIcon?: () => JSX.Element; bulkOnClick?: (e: MouseEvent) => void }> = {};
    const cId = props.cardId!;
    const tId = props.threadId!;

    actionDefs.quickReply = {
      cls: 'bulk-reply', title: 'Reply', keyHint: 'r', icon: ReplyIcon,
      onClick: (e) => { e.stopPropagation(); setQuickReplyThreadId(props.threadId); setQuickReplyCardId(props.cardId); },
      bulkTitle: 'Batch Reply', bulkOnClick: (e) => { e.stopPropagation(); startBatchReply(cId, Array.from(selection)); props.onClose(); }
    };
    actionDefs.quickForward = {
      cls: 'bulk-forward', title: 'Forward', keyHint: 'f', icon: ForwardIcon,
      onClick: (e) => { e.stopPropagation(); handleForward(tId, cId); }
    };
    actionDefs.archive = {
      cls: 'bulk-archive', title: 'Archive', keyHint: 'a', icon: ArchiveIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction('archive', [tId], cId); },
      bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('archive', Array.from(selection), cId); }
    };
    actionDefs.star = {
      cls: 'bulk-star', title: isStarred ? 'Unstar' : 'Star', keyHint: 's', icon: isStarred ? StarFilledIcon : StarIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction(isStarred ? 'unstar' : 'star', [tId], cId); },
      bulkTitle: 'Star', bulkIcon: StarIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('star', Array.from(selection), cId); }
    };
    actionDefs.markRead = {
      cls: 'bulk-read', title: isRead ? 'Mark Unread' : 'Mark Read', keyHint: 'u', icon: isRead ? EyeClosedIcon : EyeOpenIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction(isRead ? 'unread' : 'read', [tId], cId); },
      bulkTitle: 'Mark Read', bulkIcon: EyeOpenIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('read', Array.from(selection), cId); }
    };
    actionDefs.markImportant = {
      cls: 'bulk-important', title: isImportant ? 'Not Important' : 'Important', keyHint: 'i', icon: isImportant ? ThumbsUpFilledIcon : ThumbsUpIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction(isImportant ? 'notImportant' : 'important', [tId], cId); },
      bulkTitle: 'Important', bulkIcon: ThumbsUpIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('important', Array.from(selection), cId); }
    };
    actionDefs.spam = {
      cls: 'bulk-spam', title: 'Spam', keyHint: 'x', icon: SpamIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction('spam', [tId], cId); },
      bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('spam', Array.from(selection), cId); }
    };
    actionDefs.trash = {
      cls: 'bulk-danger', title: 'Delete', keyHint: 'd', icon: TrashIcon,
      onClick: (e) => { e.stopPropagation(); handleThreadAction('trash', [tId], cId); },
      bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('trash', Array.from(selection), cId); }
    };

    if (props.selectedCount > 0) {
      // Bulk Actions - follow same order as single thread actions
      for (const key of order) {
        if (key === 'quickForward') continue; // No forward in bulk
        const def = actionDefs[key];
        if (!def) continue;
        // For quickReply, check if enabled (default true)
        if (key === 'quickReply') {
          if (settings[key] === false) continue;
        } else {
          if (!settings[key]) continue;
        }
        actions.push({
          cls: def.cls,
          title: def.bulkTitle || def.title,
          keyHint: def.keyHint,
          icon: def.bulkIcon || def.icon,
          onClick: def.bulkOnClick || def.onClick
        });
      }
      // Clear at end
      actions.push({ cls: 'bulk-clear', title: 'Clear', keyHint: 'ESC', icon: ClearIcon, onClick: (e) => { e.stopPropagation(); setSelectedThreads({ ...selectedThreads(), [cId]: new Set() }); } });
    } else if (props.threadId && props.cardId) {
      // Single Thread Actions - use order
      for (const key of order) {
        const def = actionDefs[key];
        if (!def) continue;
        // Check settings (quickReply/quickForward default to true if not set)
        if (key === 'quickReply' || key === 'quickForward') {
          if (settings[key] === false) continue;
        } else {
          if (!settings[key]) continue;
        }
        actions.push({ cls: def.cls, title: def.title, keyHint: def.keyHint, icon: def.icon, onClick: def.onClick });
      }
    }

    if (actions.length === 0) return null;

    // Positioning Logic
    const innerRadius = 38;
    const numActions = actions.length;

    return (
      <div class={`bulk-actions-wheel ${props.open ? 'open' : ''}`} ref={containerRef}>
        {props.selectedCount > 0 && <span class="bulk-count">{props.selectedCount}</span>}
        <For each={actions}>
          {(action, i) => {
            let x = -innerRadius;
            let y = 0;
            if (numActions > 1) {
              // 120 degree arc from 4pi/3 down to 2pi/3.
              // In DOM coords (y increases downward):
              // i=0 -> 4pi/3 (240 deg) -> top-left
              // i=max -> 2pi/3 (120 deg) -> bottom-left
              // This matches context menu order: first item at top
              const angle = (4 * Math.PI / 3) - (i() / (numActions - 1)) * (2 * Math.PI / 3);
              x = innerRadius * Math.cos(angle);
              y = innerRadius * Math.sin(angle);
            }

            return (
              <button
                class={`bulk-btn ${action.cls}`}
                style={{
                  left: `calc(50% + ${x.toFixed(1)}px - 14px)`,
                  top: `calc(50% + ${y.toFixed(1)}px - 14px)`
                }}
                onClick={action.onClick}
                title={action.title}
              >
                <div style={{ width: '14px', height: '14px' }}>
                  <action.icon />
                </div>
                {action.keyHint && <span class="action-key-hint">{action.keyHint}</span>}
              </button>
            );
          }}
        </For>
      </div>
    );
  };


  function toggleThreadSelection(cardId: string, threadId: string, e?: MouseEvent) {
    const currentMap = new Set(selectedThreads()[cardId] || []);
    const isSelected = currentMap.has(threadId);

    // Shift+Click Logic for range selection
    if (e?.shiftKey && lastSelectedThread()[cardId]) {
      const lastId = lastSelectedThread()[cardId]!;
      const displayGroups = getDisplayGroups(cardId);
      const allThreads = displayGroups.flatMap(g => g.threads);

      const currentIndex = allThreads.findIndex(t => t.gmail_thread_id === threadId);
      const lastIndex = allThreads.findIndex(t => t.gmail_thread_id === lastId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);

        // Add all threads in range to selection
        const threadsInRange = allThreads.slice(start, end + 1);
        threadsInRange.forEach(t => currentMap.add(t.gmail_thread_id));

        setSelectedThreads({ ...selectedThreads(), [cardId]: currentMap });
        // Don't update lastSelectedThread during shift-click to rely on pivot
        return;
      }
    }

    // Normal Toggle Logic
    if (isSelected) {
      currentMap.delete(threadId);
    } else {
      currentMap.add(threadId);
      setLastSelectedThread({ ...lastSelectedThread(), [cardId]: threadId });
    }
    setSelectedThreads({ ...selectedThreads(), [cardId]: currentMap });
  }


  const contactCandidates = createMemo(() => getContactCandidates());

  function getFilteredCandidates(): RecentContact[] {
    const query = composeTo().toLowerCase().trim();
    const candidates = contactCandidates() || [];

    if (!query) {
      return candidates;
    }

    return candidates.filter(c =>
      c.email.toLowerCase().includes(query) ||
      (c.name && c.name.toLowerCase().includes(query))
    );
  }

  function selectContact(email: string) {
    setComposeTo(email);
    setShowAutocomplete(false);
  }

  // Shared card form component for new and edit modes
  const CardForm = (props: {
    mode: 'new' | 'edit';
    name: string;
    setName: (v: string) => void;
    query: string;
    setQuery: (v: string) => void;
    color: CardColor;
    setColor: (v: CardColor) => void;
    groupBy: GroupBy;
    setGroupBy: (v: GroupBy) => void;
    colorPickerOpen: boolean;
    setColorPickerOpen: (v: boolean) => void;
    onSave: () => void;
    onCancel: () => void;
    onDelete?: () => void;
    saveDisabled: boolean;
  }) => {
    return (
      <div class="card-form">
        <div class="card-form-group">
          <label>Name</label>
          <input
            type="text"
            value={props.name}
            onInput={(e) => props.setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onCancel();
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saveDisabled) {
                e.preventDefault();
                props.onSave();
              }
            }}
            placeholder="Card name"
            autofocus={props.mode === 'edit'}
            ref={props.mode === 'new' ? (el) => setTimeout(() => el?.focus(), 50) : undefined}
          />
        </div>
        <div class="card-form-group">
          <label>Gmail Search</label>
          <input
            type="text"
            ref={setQueryInputRef}
            value={props.query}
            onInput={(e) => {
              const value = e.currentTarget.value;
              props.setQuery(value);
              const suggestions = getQuerySuggestions(value);
              setQueryAutocompleteOpen(suggestions.length > 0);
              setQueryAutocompleteIndex(0);
              updateDropdownPosition();
              debounceQueryPreview(value);
            }}
            onFocus={() => {
              setActiveQueryGetter(() => () => props.query);
              setActiveQuerySetter(() => props.setQuery);
              const suggestions = getQuerySuggestions(props.query);
              setQueryAutocompleteOpen(suggestions.length > 0);
              updateDropdownPosition();
            }}
            onBlur={() => setTimeout(() => setQueryAutocompleteOpen(false), 150)}
            onKeyDown={(e) => {
              const suggestions = getQuerySuggestions(props.query);
              if (e.key === 'Escape') {
                if (queryAutocompleteOpen()) {
                  setQueryAutocompleteOpen(false);
                } else {
                  props.onCancel();
                }
                return;
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !props.saveDisabled) {
                e.preventDefault();
                props.onSave();
                return;
              }
              if (!queryAutocompleteOpen() || suggestions.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setQueryAutocompleteIndex((queryAutocompleteIndex() + 1) % suggestions.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setQueryAutocompleteIndex((queryAutocompleteIndex() - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (suggestions[queryAutocompleteIndex()]) {
                  e.preventDefault();
                  applyQuerySuggestion(suggestions[queryAutocompleteIndex()]);
                }
              }
            }}
            placeholder="Gmail search query"
          />
        </div>
        <div class="color-picker-row">
          <label>Color</label>
          <div class={`color-picker ${props.colorPickerOpen ? 'open' : ''}`}>
            <div
              class={`color-picker-selected ${props.color === null ? 'no-color' : ''}`}
              style={props.color ? { background: COLOR_HEX[props.color] } : {}}
              onClick={(e) => { e.stopPropagation(); props.setColorPickerOpen(!props.colorPickerOpen); }}
            ></div>
            <div
              class="color-option no-color-option"
              onClick={() => { props.setColor(null); props.setColorPickerOpen(false); }}
            ></div>
            <For each={CARD_COLORS}>
              {(color) => (
                <div
                  class={`color-option ${color}`}
                  onClick={() => { props.setColor(color); props.setColorPickerOpen(false); }}
                ></div>
              )}
            </For>
          </div>
        </div>
        <div class="card-form-group">
          <label>Group by</label>
          <div class="group-by-buttons">
            <For each={GROUP_BY_OPTIONS}>
              {(option) => (
                <button
                  class={`group-by-btn ${props.groupBy === option.value ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.setGroupBy(option.value);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="card-form-actions">
          <Show when={props.onDelete}>
            <button class="btn btn-danger" onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDelete?.();
            }}>
              <TrashIcon /> Delete
            </button>
            <div style="flex: 1"></div>
          </Show>
          <button class="btn" onClick={props.onCancel} title="Cancel (Esc)">
            Cancel <span class="shortcut-hint">ESC</span>
          </button>
          <button
            class="btn btn-primary"
            onClick={props.onSave}
            disabled={props.saveDisabled}
            title={`${props.mode === 'new' ? 'Add' : 'Save'} (⌘Enter)`}
          >
            {props.mode === 'new' ? 'Add' : 'Save'} <span class="shortcut-hint">⌘↵</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div class="app" onClick={handleAppClick}>
      {/* Drag region for frameless window */}
      <div class="drag-region"></div>

      {/* Global filter bar - keyboard activated */}
      <div class={`global-filter-bar ${showGlobalFilter() ? 'visible' : ''}`}>
        <div class="global-filter-container">
          <svg class="filter-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={filterInputRef}
            type="text"
            class="global-filter-input"
            placeholder="Filter threads by subject, sender, or content..."
            value={globalFilter()}
            onInput={(e) => setGlobalFilter(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowGlobalFilter(false);
                setGlobalFilter("");
              }
            }}
          />
          <Show when={globalFilter()}>
            <button class="global-filter-clear" onClick={() => setGlobalFilter("")} title="Clear filter">
              <ClearIcon />
            </button>
          </Show>
          <button class="global-filter-close" onClick={() => { setShowGlobalFilter(false); setGlobalFilter(""); }} title="Close filter">
            <CloseIcon />
            <span class="shortcut-hint">ESC</span>
          </button>
        </div>
      </div>

      {/* Compose button with contact suggestions - top left */}
      <Show when={selectedAccount()}>
        <aside class={`sidebar ${bgColorPickerOpen() ? 'expanded' : ''}`}>
          {/* Progressive Blur Layers */}
          <div class="blur-layer layer-1"></div>
          <div class="blur-layer layer-2"></div>
          <div class="blur-layer layer-3"></div>
          <div class="blur-layer layer-4"></div>

          <Show when={!composing()}>
            <div
              class="compose-toolbar"
              onMouseEnter={() => {
                clearTimeout(fabHoverTimeout);
                setComposeFabHovered(true);
              }}
              onMouseLeave={() => {
                fabHoverTimeout = window.setTimeout(() => setComposeFabHovered(false), 250);
              }}
            >
              <button
                class="compose-btn"
                onClick={() => setComposing(true)}
                title="Compose"
                aria-label="Compose new email"
              >
                <ComposeIcon />
              </button>
              <Show when={getContactCandidates().length > 0}>
                <div class={`compose-suggestions ${composeFabHovered() ? 'visible' : ''}`}>
                  <For each={getContactCandidates().slice(0, 5)}>
                    {(contact) => (
                      <div
                        class="compose-suggestion-avatar"
                        style={{ background: getAvatarColor(contact.name || contact.email) }}
                        title={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
                        onClick={() => {
                          setComposeTo(contact.email);
                          setComposing(true);
                          setComposeFabHovered(false);
                          // Focus body after compose panel opens
                          setTimeout(() => {
                            const bodyTextarea = document.querySelector('.compose-content textarea') as HTMLTextAreaElement;
                            bodyTextarea?.focus();
                          }, 100);
                        }}
                      >
                        {(contact.name || contact.email).charAt(0).toUpperCase()}
                        <span class="suggestion-label">{contact.name || contact.email}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <div class="toolbar-wrapper">
            <div class={`color-picker ${bgColorPickerOpen() ? 'open' : ''}`}>
              <div
                class={`color-picker-selected ${selectedBgColorIndex() === null ? 'no-color' : ''}`}
                style={selectedBgColorIndex() !== null ? { background: BG_COLORS[selectedBgColorIndex()!].hex } : {}}
                onClick={(e) => { e.stopPropagation(); setBgColorPickerOpen(!bgColorPickerOpen()); }}
                title="Background color"
                role="button"
                aria-label="Choose background color"
                tabindex="0"
              ></div>
              <div
                class="color-option no-color-option"
                onClick={() => selectBgColor(null)}
              ></div>
              <For each={BG_COLORS}>
                {(color, index) => (
                  <div
                    class="color-option"
                    style={{ background: color.hex }}
                    onClick={() => selectBgColor(index())}
                  ></div>
                )}
              </For>
            </div>
            <Show when={selectedAccount()}>
              <div class="account-chooser-container">
                <button
                  class="toolbar-avatar"
                  onClick={(e) => { e.stopPropagation(); setAccountChooserOpen(!accountChooserOpen()); }}
                  title={selectedAccount()?.email || "Account"}
                >
                  {selectedAccount()?.picture ? (
                    <img src={selectedAccount()!.picture!} alt="" class="toolbar-avatar-img" />
                  ) : (
                    <span class="toolbar-avatar-placeholder">
                      {getInitial(selectedAccount()?.email || "")}
                    </span>
                  )}
                </button>
                <Show when={accountChooserOpen()}>
                  <div class="account-chooser-dropdown" onClick={(e) => e.stopPropagation()}>
                    <div class="account-chooser-header">Accounts</div>
                    <div class="account-chooser-list">
                      <For each={accounts()}>
                        {(account) => (
                          <button
                            class={`account-chooser-item ${account.id === selectedAccount()?.id ? 'active' : ''}`}
                            onClick={async () => {
                              setSelectedAccount(account);
                              setCards(await getCards(account.id));
                              setCardThreads({});
                              setAccountChooserOpen(false);
                            }}
                          >
                            {account.picture ? (
                              <img src={account.picture} alt="" class="account-chooser-avatar" />
                            ) : (
                              <span class="account-chooser-avatar-placeholder">
                                {getInitial(account.email)}
                              </span>
                            )}
                            <span class="account-chooser-email">{account.email}</span>
                            {account.id === selectedAccount()?.id && (
                              <span class="account-chooser-check">✓</span>
                            )}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="account-chooser-divider"></div>
                    <button
                      class="account-chooser-action"
                      onClick={() => { setAccountChooserOpen(false); handleSignIn(); }}
                    >
                      <PlusIcon />
                      <span>Add account</span>
                    </button>
                    <button
                      class="account-chooser-action"
                      onClick={() => { setAccountChooserOpen(false); setSettingsOpen(true); }}
                    >
                      <SettingsIcon />
                      <span>Settings</span>
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </aside>
      </Show>

      {/* Error banner */}
      <Show when={error()}>
        <div class="auth-error" style="position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 100;">
          {error()}
          <button class="btn" style="margin-left: 8px;" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      </Show>

      {/* Loading state */}
      <Show when={loading()}>
        <div class="auth-screen">
          <div class="auth-spinner"></div>
        </div>
      </Show>

      {/* Auth screen - no account */}
      <Show when={!loading() && accounts().length === 0 && !authLoading()}>
        <div class="auth-screen">
          <h1>Posta</h1>
          <p>Your inbox, organized</p>
          <button class="auth-btn" onClick={handleSignIn}>
            <GoogleLogo />
            Sign in with Google
          </button>
          <Show when={error()}>
            <p class="auth-error">{error()}</p>
          </Show>
        </div>
      </Show>

      {/* Auth loading */}
      <Show when={authLoading()}>
        <div class="auth-screen">
          <div class="auth-spinner"></div>
          <p style="margin-top: 16px;">Complete sign-in in your browser...</p>
        </div>
      </Show>

      {/* Main card view */}
      <Show when={!loading() && selectedAccount()}>
        <DragDropProvider onDragStart={onDragStart} onDragEnd={onDragEnd} collisionDetector={closestCenter}>
          <DragDropSensors sensors={[createPointerSensor({ activationConstraint: { distance: 5 } })]} />
          <div class={`card-row ${resizing() ? 'resizing' : ''}`}>
            <SortableProvider ids={cardIds()}>
              <For each={cards()}>
                {(card) => {
                  const sortable = createSortable(card.id);
                  return (
                    <div
                      ref={sortable.ref}
                      class="card-wrapper"
                      style={{
                        transform: sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined,
                      }}
                    >
                      <div
                        class={`card ${collapsedCards()[card.id] ? 'collapsed' : ''} ${editingCardId() === card.id ? 'editing' : ''}`}
                        classList={{ 'dragging': sortable.isActiveDraggable }}
                        data-id={card.id}
                        data-color={editingCardId() === card.id ? (editCardColor() || undefined) : (cardColors()[card.id] || undefined)}
                        role="region"
                        aria-label={`${card.name} email card`}
                      >
                        <Show when={editingCardId() === card.id}>
                          <CardForm
                            mode="edit"
                            name={editCardName()}
                            setName={setEditCardName}
                            query={editCardQuery()}
                            setQuery={setEditCardQuery}
                            color={editCardColor()}
                            setColor={(c) => { setEditCardColor(c); }}
                            groupBy={getGroupByForCard(card.id)}
                            setGroupBy={(v) => setGroupByForCard(card.id, v)}
                            colorPickerOpen={editColorPickerOpen()}
                            setColorPickerOpen={setEditColorPickerOpen}
                            onSave={saveEditCard}
                            onCancel={cancelEditCard}
                            onDelete={() => handleDeleteCard(card.id)}
                            saveDisabled={!editCardName() || !editCardQuery()}
                          />
                        </Show>
                        <Show when={editingCardId() !== card.id}>
                          <div
                            class="card-header"
                            onClick={() => { if (!wasDragging) toggleCardCollapse(card.id); }}
                            {...sortable.dragActivators}
                          >
                            <button class="collapse-btn">
                              <ChevronIcon />
                            </button>
                            <span class="card-title">{card.name}</span>
                            <Show when={lastSyncTimes()[card.id] && !loadingThreads()[card.id] && (Date.now() - (lastSyncTimes()[card.id] || 0)) > 10000}>
                              <span
                                class={`sync-status ${syncErrors()[card.id] ? 'sync-error' : ''} ${(Date.now() - (lastSyncTimes()[card.id] || 0)) > 15 * 60 * 1000 ? 'sync-stale' : ''}`}
                                title={syncErrors()[card.id] ? `Sync failed: ${syncErrors()[card.id]}` : `Last synced: ${formatSyncTime(lastSyncTimes()[card.id])}`}
                              >
                                {syncErrors()[card.id] ? '!' : formatSyncTime(lastSyncTimes()[card.id])}
                              </span>
                            </Show>
                            <Show when={getCardUnreadCount(card.id) > 0}>
                              <span class="card-unread-badge">{getCardUnreadCount(card.id)}</span>
                            </Show>
                            <div class="card-actions">
                              <button
                                class={`icon-btn ${loadingThreads()[card.id] || loadingMore()[card.id] ? 'spinning' : ''} `}
                                onClick={(e) => refreshCard(card.id, e)}
                                disabled={loadingThreads()[card.id]}
                                title="Refresh"
                              >
                                <RefreshIcon />
                              </button>
                              <button
                                class="icon-btn"
                                onClick={(e) => startEditCard(card, e)}
                                title="Edit"
                              >
                                <EditIcon />
                              </button>
                            </div>
                          </div>
                        </Show>
                        <div
                          class="card-body"
                          onScroll={(e) => {
                            if (editingCardId() === card.id) return; // No scroll loading during edit
                            const target = e.currentTarget;
                            const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 50;
                            if (nearBottom && cardHasMore()[card.id] && !loadingMore()[card.id] && !loadingThreads()[card.id]) {
                              loadCardThreads(card.id, true);
                            }
                          }}
                        >
                          {/* Query preview when editing */}
                          <Show when={editingCardId() === card.id}>
                            <Show when={queryPreviewLoading()}>
                              <div class="loading">Searching...</div>
                            </Show>
                            <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && editCardQuery().trim()}>
                              <div class="empty">No matches</div>
                            </Show>
                            <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                              <For each={queryPreviewThreads()}>
                                {(group) => (
                                  <>
                                    <div class="date-header">{group.label}</div>
                                    <For each={group.threads}>
                                      {(thread) => (
                                        <div class="thread">
                                          <div class="thread-row">
                                            <Show when={thread.unread_count > 0}>
                                              <div class="unread-dot"></div>
                                            </Show>
                                            <span class="thread-subject">{thread.subject}</span>
                                            <Show when={thread.has_attachment}>
                                              <span class="attachment-icon" title="Has attachment">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                                </svg>
                                              </span>
                                            </Show>
                                            <span class="thread-time">{formatTime(thread.last_message_date)}</span>
                                          </div>
                                          <div class="thread-snippet">{thread.snippet}</div>
                                          {/* Attachment previews */}
                                          <Show when={thread.attachments?.length > 0}>
                                            <div class="thread-attachments">
                                              <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 3)}>
                                                {(attachment) => (
                                                  <img
                                                    class="thread-image-thumb clickable"
                                                    src={`data:${attachment.mime_type};base64,${attachment.inline_data?.replace(/-/g, '+').replace(/_/g, '/')}`}
                                                    alt={attachment.filename}
                                                    title={`${attachment.filename} - Click to open`}
                                                    onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                  />
                                                )}
                                              </For>
                                              <For each={thread.attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")).slice(0, 2)}>
                                                {(attachment) => (
                                                  <div
                                                    class="thread-file-item clickable"
                                                    title={`${attachment.filename} (${formatFileSize(attachment.size)}) - Click to open`}
                                                    onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                  >
                                                    <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
                                                  </div>
                                                )}
                                              </For>
                                            </div>
                                          </Show>
                                        </div>
                                      )}
                                    </For>
                                  </>
                                )}
                              </For>
                            </Show>
                          </Show>
                          {/* Normal view when not editing */}
                          <Show when={editingCardId() !== card.id}>
                            {/* Only show loading if no cached data */}
                            <Show when={loadingThreads()[card.id] && !cardThreads()[card.id]}>
                              <div class="loading">Loading...</div>
                            </Show>
                            <Show when={!loadingThreads()[card.id] && cardErrors()[card.id] && !cardThreads()[card.id]}>
                              <div class="card-error">
                                <span class="error-icon">⚠</span>
                                <span class="error-text">{cardErrors()[card.id]}</span>
                                <button class="retry-btn" onClick={(e) => refreshCard(card.id, e)}>Try again</button>
                              </div>
                            </Show>
                            {/* Show cached threads even while refreshing */}
                            <Show when={cardThreads()[card.id]}>
                              <Show when={getDisplayGroups(card.id).length === 0}>
                                <div class="empty">All clear</div>
                              </Show>
                              <For each={getDisplayGroups(card.id)}>
                                {(group) => (
                                  <>
                                    <div class="date-header">{group.label}</div>
                                    <For each={group.threads}>
                                      {(thread) => (
                                        <>
                                          <div
                                            class={`thread ${thread.unread_count > 0 ? 'unread' : ''} ${selectedThreads()[card.id]?.has(thread.gmail_thread_id) ? 'selected' : ''} ${isThreadFocused(card.id, thread.gmail_thread_id) ? 'focused' : ''} ${quickReplyThreadId() === thread.gmail_thread_id ? 'replying' : ''}`}
                                            onMouseEnter={() => showThreadHoverActions(card.id, thread.gmail_thread_id)}
                                            onMouseLeave={() => hideThreadHoverActions()}
                                            onClick={() => openThread(thread.gmail_thread_id, card.id)}
                                            role="article"
                                            aria-label={`${thread.unread_count > 0 ? 'Unread: ' : ''}${thread.subject} from ${thread.participants.slice(0, 2).join(', ')}`}
                                            tabindex="0"
                                          >
                                            <div class="thread-row">
                                              <Show when={thread.unread_count > 0}>
                                                <div class="unread-dot"></div>
                                              </Show>
                                              <span class="thread-subject">{thread.subject}</span>
                                              <Show when={thread.has_attachment}>
                                                <span class="attachment-icon" title="Has attachment">
                                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                                  </svg>
                                                </span>
                                              </Show>
                                              <span class="thread-time">{formatTime(thread.last_message_date)}</span>
                                            </div>
                                            <div class="thread-snippet">{thread.snippet}</div>
                                            <div class="thread-participants">
                                              {thread.participants.slice(0, 3).join(", ")}
                                              {thread.participants.length > 3 && ` + ${thread.participants.length - 3} `}
                                            </div>
                                            {/* Attachment previews */}
                                            <Show when={thread.attachments?.length > 0}>
                                              <div class="thread-attachments" onClick={(e) => e.stopPropagation()}>
                                                {/* Image thumbnails */}
                                                <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 4)}>
                                                  {(attachment) => (
                                                    <img
                                                      class="thread-image-thumb clickable"
                                                      src={`data:${attachment.mime_type};base64,${attachment.inline_data?.replace(/-/g, '+').replace(/_/g, '/')}`}
                                                      alt={attachment.filename}
                                                      title={`${attachment.filename} - Click to open`}
                                                      onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                    />
                                                  )}
                                                </For>
                                                {/* Other files (non-image or images without inline data) */}
                                                <For each={thread.attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")).slice(0, 3)}>
                                                  {(attachment) => (
                                                    <div
                                                      class="thread-file-item clickable"
                                                      title={`${attachment.filename} (${formatFileSize(attachment.size)}) - Click to open`}
                                                      onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                    >
                                                      <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
                                                    </div>
                                                  )}
                                                </For>
                                                {/* More indicator */}
                                                <Show when={(thread.attachments?.length || 0) > 7}>
                                                  <span class="thread-attachment-more">+{(thread.attachments?.length || 0) - 7}</span>
                                                </Show>
                                              </div>
                                            </Show>
                                            {/* Thread Checkbox on hover */}
                                            <div
                                              class="thread-checkbox-wrap"
                                              onContextMenu={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setActionConfigMenu({ x: e.clientX, y: e.clientY });
                                              }}
                                            >
                                              <input
                                                type="checkbox"
                                                class="thread-checkbox"
                                                checked={selectedThreads()[card.id]?.has(thread.gmail_thread_id) || false}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  toggleThreadSelection(card.id, thread.gmail_thread_id, e);
                                                }}
                                              />
                                              <Show when={(hoveredThread() === thread.gmail_thread_id && actionsWheelOpen()) || isThreadFocused(card.id, thread.gmail_thread_id)}>
                                                <ActionsWheel
                                                  cardId={card.id}
                                                  threadId={thread.gmail_thread_id}
                                                  thread={thread}
                                                  selectedCount={selectedThreads()[card.id]?.size || 0}
                                                  open={true}
                                                  onClose={() => setActionsWheelOpen(false)}
                                                />
                                              </Show>
                                            </div>
                                            <div class="thread-actions-wheel-placeholder"></div>
                                          </div>
                                          <Show when={quickReplyThreadId() === thread.gmail_thread_id}>
                                            <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                              <ComposeTextarea
                                                class="quick-reply-input"
                                                placeholder="Write a reply..."
                                                value={quickReplyText()}
                                                onChange={setQuickReplyText}
                                                onSend={handleQuickReply}
                                                onCancel={() => { setQuickReplyThreadId(null); setQuickReplyText(""); }}
                                                disabled={quickReplySending()}
                                                autofocus
                                              />
                                              <div class="quick-reply-actions">
                                                <button class="btn" onClick={() => { setQuickReplyThreadId(null); setQuickReplyText(""); }} disabled={quickReplySending()}>Cancel <span class="shortcut-hint">ESC</span></button>
                                                <ComposeSendButton
                                                  onClick={handleQuickReply}
                                                  disabled={!quickReplyText().trim()}
                                                  sending={quickReplySending()}
                                                />
                                              </div>
                                            </div>
                                          </Show>
                                        </>
                                      )}
                                    </For>
                                  </>
                                )}
                              </For>
                              {/* Loading more indicator for infinite scroll */}
                              <Show when={loadingMore()[card.id]}>
                                <div class="loading">Loading more...</div>
                              </Show>
                            </Show>
                          </Show>
                        </div>
                      </div>
                      {/* Resize handle - outside card, inside wrapper */}
                      <div
                        class="card-resize-handle"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return; // left-click only
                          e.preventDefault();
                          e.stopPropagation();
                          setResizing(true);
                          const startX = e.clientX;
                          const startWidth = cardWidth();
                          const onMove = (moveE: MouseEvent) => {
                            const delta = moveE.clientX - startX;
                            const newWidth = Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, startWidth + delta));
                            updateCardWidth(newWidth);
                          };
                          const onUp = () => {
                            setResizing(false);
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                          };
                          document.addEventListener('mousemove', onMove);
                          document.addEventListener('mouseup', onUp);
                        }}
                      />
                    </div>
                  );
                }}
              </For>
            </SortableProvider>

            {/* Add card form (inline) */}
            <Show when={addingCard()}>
              <div class={`card form-mode ${closingAddCard() ? 'closing' : ''}`} data-color={newCardColor() || undefined}>
                <CardForm
                  mode="new"
                  name={newCardName()}
                  setName={setNewCardName}
                  query={newCardQuery()}
                  setQuery={setNewCardQuery}
                  color={newCardColor()}
                  setColor={setNewCardColor}
                  groupBy={newCardGroupBy()}
                  setGroupBy={setNewCardGroupBy}
                  colorPickerOpen={colorPickerOpen()}
                  setColorPickerOpen={setColorPickerOpen}
                  onSave={handleAddCard}
                  onCancel={cancelAddCard}
                  saveDisabled={!newCardName() || !newCardQuery()}
                />
                {/* Query preview for new card */}
                <div class="card-body">
                  <Show when={queryPreviewLoading()}>
                    <div class="loading">Searching...</div>
                  </Show>
                  <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && newCardQuery().trim()}>
                    <div class="empty">No matches</div>
                  </Show>
                  <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                    <For each={queryPreviewThreads()}>
                      {(group) => (
                        <>
                          <div class="date-header">{group.label}</div>
                          <For each={group.threads}>
                            {(thread) => (
                              <div class="thread">
                                <div class="thread-row">
                                  <Show when={thread.unread_count > 0}>
                                    <div class="unread-dot"></div>
                                  </Show>
                                  <span class="thread-subject">{thread.subject}</span>
                                  <Show when={thread.has_attachment}>
                                    <span class="attachment-icon" title="Has attachment">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                      </svg>
                                    </span>
                                  </Show>
                                  <span class="thread-time">{formatTime(thread.last_message_date)}</span>
                                </div>
                                <div class="thread-snippet">{thread.snippet}</div>
                                <Show when={thread.attachments?.length > 0}>
                                  <div class="thread-attachments">
                                    <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 3)}>
                                      {(attachment) => (
                                        <img
                                          class="thread-image-thumb"
                                          src={`data:${attachment.mime_type};base64,${attachment.inline_data?.replace(/-/g, '+').replace(/_/g, '/')}`}
                                          alt={attachment.filename}
                                          title={attachment.filename}
                                        />
                                      )}
                                    </For>
                                    <For each={thread.attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")).slice(0, 2)}>
                                      {(attachment) => (
                                        <div class="thread-file-item" title={`${attachment.filename} (${formatFileSize(attachment.size)})`}>
                                          <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Add card button */}
            <Show when={!addingCard()}>
              <button class="add-card-btn" onClick={() => { setNewCardColor(null); setAddingCard(true); }} aria-label="New card" title="New card">
                <PlusIcon />
              </button>
            </Show>
          </div>
        </DragDropProvider>

      </Show>

      {/* Compose Panel */}
      <Show when={composing()}>
        <div class={`compose-panel ${closingCompose() ? 'closing' : ''}`}>
          <div class="compose-header">
            <h3>New message</h3>
            <CloseButton onClick={closeCompose} />
          </div>
          <div class="compose-body">
            <div class="compose-field" style="position: relative;">
              <label>To</label>
              <div class="compose-to-row">
                <input
                  ref={(el) => setTimeout(() => { if (!focusComposeBody()) el?.focus(); }, 50)}
                  type="email"
                  value={composeTo()}
                  onInput={(e) => { setComposeTo(e.currentTarget.value); setComposeEmailError(null); setAutocompleteIndex(0); debouncedSaveDraft(); }}
                  onFocus={() => { setShowAutocomplete(true); setAutocompleteIndex(0); }}
                  onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
                  onKeyDown={(e) => {
                    const candidates = getFilteredCandidates();
                    if (e.key === 'Escape') {
                      if (showAutocomplete()) {
                        setShowAutocomplete(false);
                      } else {
                        closeCompose();
                      }
                    } else if (e.key === 'ArrowDown' && showAutocomplete() && candidates.length > 0) {
                      e.preventDefault();
                      setAutocompleteIndex((autocompleteIndex() + 1) % candidates.length);
                    } else if (e.key === 'ArrowUp' && showAutocomplete() && candidates.length > 0) {
                      e.preventDefault();
                      setAutocompleteIndex((autocompleteIndex() - 1 + candidates.length) % candidates.length);
                    } else if (e.key === 'Enter' && showAutocomplete() && candidates.length > 0 && !(e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      selectContact(candidates[autocompleteIndex()].email);
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && composeTo().trim()) {
                      e.preventDefault();
                      handleSendEmail();
                    }
                  }}
                  placeholder=""
                />
                <Show when={!showCcBcc()}>
                  <button
                    type="button"
                    class="cc-bcc-toggle"
                    onClick={() => setShowCcBcc(true)}
                  >
                    Cc/Bcc
                  </button>
                </Show>
              </div>
              <Show when={showAutocomplete() && getFilteredCandidates().length > 0}>
                <div class="compose-autocomplete">
                  <For each={getFilteredCandidates()}>
                    {(contact, i) => (
                      <div
                        class={`compose-autocomplete-item ${i() === autocompleteIndex() ? 'selected' : ''}`}
                        onMouseDown={() => selectContact(contact.email)}
                        onMouseEnter={() => setAutocompleteIndex(i())}
                      >
                        <div
                          class="compose-autocomplete-avatar"
                          style={{ background: getAvatarColor(contact.name || contact.email) }}
                        >
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
            <Show when={showCcBcc()}>
              <div class="compose-field">
                <label>Cc</label>
                <input
                  type="text"
                  value={composeCc()}
                  onInput={(e) => { setComposeCc(e.currentTarget.value); setComposeEmailError(null); debouncedSaveDraft(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeCompose();
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && composeTo().trim()) {
                      e.preventDefault();
                      handleSendEmail();
                    }
                  }}
                  placeholder="Cc recipients"
                />
              </div>
              <div class="compose-field">
                <label>Bcc</label>
                <input
                  type="text"
                  value={composeBcc()}
                  onInput={(e) => { setComposeBcc(e.currentTarget.value); setComposeEmailError(null); debouncedSaveDraft(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeCompose();
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && composeTo().trim()) {
                      e.preventDefault();
                      handleSendEmail();
                    }
                  }}
                  placeholder="Bcc recipients"
                />
              </div>
            </Show>
            <div class="compose-field">
              <label>Subject</label>
              <input
                type="text"
                value={composeSubject()}
                onInput={(e) => { setComposeSubject(e.currentTarget.value); debouncedSaveDraft(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeCompose();
                  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && composeTo().trim()) {
                    e.preventDefault();
                    handleSendEmail();
                  }
                }}
                placeholder="Subject"
              />
            </div>
            <div class="compose-content">
              <textarea
                ref={(el) => setTimeout(() => { if (focusComposeBody()) el?.focus(); }, 50)}
                value={composeBody()}
                onInput={(e) => { setComposeBody(e.currentTarget.value); debouncedSaveDraft(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeCompose();
                  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && composeTo().trim()) {
                    e.preventDefault();
                    handleSendEmail();
                  }
                }}
                placeholder="Write something..."
              ></textarea>
            </div>
          </div>
          <Show when={composeAttachments().length > 0}>
            <div class="compose-attachments">
              <For each={composeAttachments()}>
                {(attachment, i) => (
                  <div class="compose-attachment">
                    <span class="attachment-name" title={attachment.filename}>
                      {truncateMiddle(attachment.filename, 20)}
                    </span>
                    <button
                      class="attachment-remove"
                      onClick={() => removeAttachment(i())}
                      title="Remove"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="compose-footer">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              style={{ display: 'none' }}
            />
            <button
              class="compose-attach-btn"
              onClick={() => fileInputRef?.click()}
              title="Attach files"
            >
              <AttachmentIcon />
            </button>
            <Show when={composeEmailError()}>
              <div class="compose-error">{composeEmailError()}</div>
            </Show>
            <Show when={draftSaved() && !composeEmailError()}>
              <div class="draft-saved">Draft saved</div>
            </Show>
            <button
              class={`btn btn-primary ${sending() ? 'sending' : ''}`}
              disabled={!composeTo().trim() || sending()}
              onClick={handleSendEmail}
            >
              {sending() ? 'Sending...' : <>Send <span class="shortcut-hint">⌘↵</span></>}
            </button>
          </div>
        </div>
      </Show >

      {/* Preset selection modal */}
      <Show when={showPresetSelection()}>
        <div class="preset-overlay">
          <div class="preset-modal">
            <h2>How do you email?</h2>
            <p>Pick a starting point. You can customize later.</p>
            <div class="preset-options">
              <div class="preset-option recommended" onClick={() => applyPreset("posta")}>
                <div class="preset-preview">
                  <div class="preset-card blue"></div>
                  <div class="preset-card red"></div>
                  <div class="preset-card purple"></div>
                </div>
                <div class="preset-label">Posta <span class="preset-badge">Recommended</span></div>
                <div class="preset-desc">Focus on what matters</div>
              </div>
              <div class="preset-option" onClick={() => applyPreset("traditional")}>
                <div class="preset-preview">
                  <div class="preset-card blue"></div>
                  <div class="preset-card yellow"></div>
                  <div class="preset-card orange"></div>
                  <div class="preset-card green"></div>
                </div>
                <div class="preset-label">Traditional</div>
                <div class="preset-desc">The familiar setup</div>
              </div>
              <div class="preset-option" onClick={() => applyPreset("power")}>
                <div class="preset-preview">
                  <div class="preset-card blue"></div>
                  <div class="preset-card yellow"></div>
                  <div class="preset-card orange"></div>
                  <div class="preset-card red"></div>
                </div>
                <div class="preset-label">Power User</div>
                <div class="preset-desc">Track everything</div>
              </div>
              <div class="preset-option" onClick={() => applyPreset("empty")}>
                <div class="preset-preview empty">
                  <PlusIcon />
                </div>
                <div class="preset-label">Blank</div>
                <div class="preset-desc">Build from scratch</div>
              </div>
            </div>
          </div>
        </div>
      </Show>


      {/* Thread View Overlay */}
      <Show when={activeThreadId()}>
        <ThreadView
          thread={activeThread()}
          loading={threadLoading()}
          error={threadError()}
          color={activeThreadCardId() ? cardColors()[activeThreadCardId()!] : null}
          onClose={() => { setActiveThreadId(null); setActiveThreadCardId(null); setFocusedMessageIndex(0); setLabelDrawerOpen(false); }}
          focusedMessageIndex={focusedMessageIndex()}
          onFocusChange={setFocusedMessageIndex}
          onOpenAttachment={(messageId, attachmentId, filename, mimeType) => openAttachment(messageId, attachmentId, filename, mimeType)}
          onReply={handleReplyFromThread}
          onForward={handleForwardFromThread}
          onAction={handleThreadViewAction}
          onOpenLabels={() => { fetchAccountLabels(); setLabelDrawerOpen(true); }}
          isStarred={isThreadStarred()}
          isRead={isThreadRead()}
          isImportant={isThreadImportant()}
        />

        {/* Label Drawer */}
        <Show when={labelDrawerOpen()}>
          <div class="label-drawer-overlay" onClick={() => { setLabelDrawerOpen(false); setLabelSearchQuery(""); }}></div>
          <div class="label-drawer">
            <div class="label-drawer-header">
              <h3>Labels</h3>
              <CloseButton onClick={() => { setLabelDrawerOpen(false); setLabelSearchQuery(""); }} />
            </div>

            <div class="label-drawer-search">
              <input
                type="text"
                placeholder="Search labels..."
                value={labelSearchQuery()}
                onInput={(e) => setLabelSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setLabelDrawerOpen(false); setLabelSearchQuery(""); } }}
                autofocus
              />
            </div>

            <div class="label-drawer-body">
              <Show when={labelsLoading()}>
                <div class="label-drawer-loading">Loading labels...</div>
              </Show>

              <Show when={!labelsLoading()}>
                <For each={accountLabels().filter(l =>
                  !labelSearchQuery() || l.name.toLowerCase().includes(labelSearchQuery().toLowerCase())
                )}>
                  {(label) => {
                    const isApplied = () => getCurrentThreadLabels().includes(label.id);
                    const isSystem = () => label.label_type !== 'user';

                    return (
                      <label class={`label-item ${isSystem() ? 'system-label' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isApplied()}
                          onChange={() => handleToggleLabel(label.id, label.name, !isApplied())}
                        />
                        <span class="label-name">{label.name}</span>
                        <Show when={isSystem()}>
                          <span class="label-badge">System</span>
                        </Show>
                      </label>
                    );
                  }}
                </For>

                <Show when={!labelsLoading() && accountLabels().filter(l =>
                  !labelSearchQuery() || l.name.toLowerCase().includes(labelSearchQuery().toLowerCase())
                ).length === 0}>
                  <div class="label-drawer-empty">No labels found</div>
                </Show>
              </Show>
            </div>

            <div class="label-drawer-footer">
              <span class="shortcut-hint">Press L to toggle labels</span>
            </div>
          </div>
        </Show>
      </Show>

      {/* Batch Reply Panel */}
      <Show when={batchReplyOpen()}>
        <div class="thread-overlay">
          <div class="thread-view-header">
            <CloseButton onClick={closeBatchReply} />
            <div class="thread-subject-header">
              <h2>Batch Reply</h2>
            </div>
            <div class="batch-reply-header-actions">
              <span class="batch-reply-count">{batchReplyThreads().length} remaining</span>
              <button
                class="btn btn-primary btn-sm"
                disabled={!Object.values(batchReplyMessages()).some(m => m?.trim())}
                onClick={sendAllBatchReplies}
              >
                Send All ({Object.values(batchReplyMessages()).filter(m => m?.trim()).length})
              </button>
            </div>
          </div>
          <div class="batch-reply-body">
            <Show when={batchReplyLoading()}>
              <div class="batch-reply-loading">
                <div class="loading-spinner"></div>
                Loading threads...
              </div>
            </Show>
            <Show when={!batchReplyLoading() && batchReplyThreads().length === 0}>
              <div class="batch-reply-empty">No threads to reply to</div>
            </Show>
            <For each={batchReplyThreads()}>
              {(thread) => {
                let fileInputRef: HTMLInputElement | undefined;
                return (
                  <div class="batch-reply-item">
                    <div class="batch-reply-message">
                      <div class="batch-reply-message-header">
                        <div class="batch-reply-from">{thread.from}</div>
                        <div class="batch-reply-header-right">
                          <div class="batch-reply-date">{thread.date}</div>
                          <button
                            class="batch-reply-discard"
                            onClick={() => discardBatchReplyThread(thread.threadId)}
                            title="Discard this reply"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      </div>
                      <div class="batch-reply-subject">{thread.subject}</div>
                      <div class="batch-reply-content" innerHTML={DOMPurify.sanitize(thread.body, DOMPURIFY_CONFIG)}></div>
                    </div>
                    <div class="batch-reply-compose">
                      <div class="batch-reply-compose-inner">
                        <ComposeTextarea
                          placeholder={`Reply to ${extractEmail(thread.from)}...`}
                          value={batchReplyMessages()[thread.threadId] || ''}
                          onChange={(v) => updateBatchReplyMessage(thread.threadId, v)}
                          onSend={() => sendBatchReply(thread.threadId)}
                          onCancel={closeBatchReply}
                          disabled={batchReplySending()[thread.threadId]}
                        />
                        <div class="batch-reply-actions">
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={(e) => handleBatchReplyFileSelect(thread.threadId, e)}
                            multiple
                            style={{ display: 'none' }}
                          />
                          <button
                            class="batch-reply-attach"
                            onClick={() => fileInputRef?.click()}
                            title="Attach files"
                          >
                            <AttachmentIcon />
                          </button>
                          <button
                            class="btn batch-reply-skip"
                            onClick={() => discardBatchReplyThread(thread.threadId)}
                            title="Skip this thread"
                          >
                            Skip
                          </button>
                          <ComposeSendButton
                            onClick={() => sendBatchReply(thread.threadId)}
                            disabled={!batchReplyMessages()[thread.threadId]?.trim()}
                            sending={batchReplySending()[thread.threadId]}
                            showShortcut={false}
                            class="batch-reply-send"
                          />
                        </div>
                      </div>
                      <Show when={(batchReplyAttachments()[thread.threadId] || []).length > 0}>
                        <div class="batch-reply-attachments">
                          <For each={batchReplyAttachments()[thread.threadId]}>
                            {(attachment, i) => (
                              <div class="compose-attachment">
                                <span class="attachment-name" title={attachment.filename}>
                                  {truncateMiddle(attachment.filename, 20)}
                                </span>
                                <button
                                  class="attachment-remove"
                                  onClick={() => removeBatchReplyAttachment(thread.threadId, i())}
                                  title="Remove"
                                >
                                  <CloseIcon />
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Settings sidebar */}
      <div class={`settings-overlay ${settingsOpen() ? 'open' : ''}`} onClick={() => setSettingsOpen(false)} aria-hidden="true"></div>
      <div class={`settings-sidebar ${settingsOpen() ? 'open' : ''}`} role="dialog" aria-label="Settings" aria-modal="true">
        <div class="settings-header">
          <h3>Settings</h3>
          <CloseButton onClick={() => setSettingsOpen(false)} />
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <div class="settings-section-title">Google API</div>
            <div class="settings-form-group">
              <label>Client ID</label>
              <input
                type="text"
                value={clientId()}
                onInput={(e) => setClientId(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSettingsOpen(false);
                  else if (e.key === 'Enter' && clientId() && clientSecret()) handleSaveSettings();
                }}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </div>
            <div class="settings-form-group">
              <label>Client Secret</label>
              <input
                type="password"
                value={clientSecret()}
                onInput={(e) => setClientSecret(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSettingsOpen(false);
                  else if (e.key === 'Enter' && clientId() && clientSecret()) handleSaveSettings();
                }}
                placeholder="GOCSPX-..."
              />
            </div>
            <p class="settings-hint">
              Redirect URI: <code>http://localhost:8420/callback</code>
            </p>
            <button
              class="btn btn-primary"
              onClick={handleSaveSettings}
              disabled={!clientId() || !clientSecret()}
              style="margin-top: 12px; width: 100%;"
            >
              Connect <span class="shortcut-hint">↵</span>
            </button>
          </div>
        </div>
        <div class="settings-footer">
          <Show when={selectedAccount()}>
            <button class="signout-btn" onClick={handleSignOut}>Sign out</button>
          </Show>
          <div class="copyright">© sryo</div>
        </div>
      </div>

      {/* Keyboard shortcuts help modal */}
      <Show when={shortcutsHelpOpen()}>
        <div class="shortcuts-overlay" onClick={() => setShortcutsHelpOpen(false)}></div>
        <div class="shortcuts-modal">
          <div class="shortcuts-header">
            <h2>Keyboard Shortcuts</h2>
            <CloseButton onClick={() => setShortcutsHelpOpen(false)} />
          </div>
          <div class="shortcuts-body">
            <div class="shortcuts-section">
              <h3>Navigation</h3>
              <div class="shortcut-row"><kbd>j</kbd> <span>Next thread</span></div>
              <div class="shortcut-row"><kbd>k</kbd> <span>Previous thread</span></div>
              <div class="shortcut-row"><kbd>Enter</kbd> <span>Open thread</span></div>
              <div class="shortcut-row"><kbd>Escape</kbd> <span>Close / Go back</span></div>
              <div class="shortcut-row"><kbd>/</kbd> <span>Open filter</span></div>
              <div class="shortcut-row"><kbd>⌘F</kbd> <span>Open filter</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Actions</h3>
              <div class="shortcut-row"><kbd>a</kbd> <span>Archive thread</span></div>
              <div class="shortcut-row"><kbd>s</kbd> <span>Star thread</span></div>
              <div class="shortcut-row"><kbd>d</kbd> <span>Delete thread</span></div>
              <div class="shortcut-row"><kbd>r</kbd> <span>Reply to thread</span></div>
              <div class="shortcut-row"><kbd>f</kbd> <span>Forward thread</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Compose</h3>
              <div class="shortcut-row"><kbd>c</kbd> <span>New email</span></div>
              <div class="shortcut-row"><kbd>⌘Enter</kbd> <span>Send email</span></div>
              <div class="shortcut-row"><kbd>Escape</kbd> <span>Close compose</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Selection</h3>
              <div class="shortcut-row"><kbd>x</kbd> <span>Select thread</span></div>
              <div class="shortcut-row"><kbd>⌘A</kbd> <span>Select all</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Help</h3>
              <div class="shortcut-row"><kbd>?</kbd> <span>Show this help</span></div>
            </div>
          </div>
        </div>
      </Show>

      {/* Query autocomplete dropdown - rendered at app level to avoid clipping */}
      <Show when={queryAutocompleteOpen() && queryDropdownPos()}>
        <div
          class="query-autocomplete"
          style={{
            top: `${queryDropdownPos()!.top}px`,
            left: `${queryDropdownPos()!.left}px`,
            width: `${queryDropdownPos()!.width}px`,
          }}
        >
          <For each={getQuerySuggestions(getCurrentQuery())}>
            {(suggestion, i) => (
              <div
                class={`query-autocomplete-item ${i() === queryAutocompleteIndex() ? 'selected' : ''}`}
                onMouseDown={() => applyQuerySuggestion(suggestion)}
              >
                <span class="query-autocomplete-op">{suggestion.text}</span>
                <span class="query-autocomplete-desc">{suggestion.desc}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Action config context menu */}
      <Show when={actionConfigMenu()}>
        <div
          class="action-config-menu"
          style={{
            top: `${actionConfigMenu()!.y}px`,
            left: `${actionConfigMenu()!.x}px`,
          }}
        >
          <For each={actionOrder()}>
            {(key, i) => {
              const labels: Record<string, string> = {
                quickReply: 'Reply',
                quickForward: 'Forward',
                archive: 'Archive',
                star: 'Star',
                trash: 'Delete',
                markRead: 'Read',
                markImportant: 'Important',
                spam: 'Spam'
              };
              const isEnabled = key === 'quickReply' || key === 'quickForward'
                ? actionSettings()[key] !== false
                : !!actionSettings()[key];
              return (
                <label
                  class={`action-config-item ${draggingAction() === key ? 'dragging' : ''}`}
                  draggable={true}
                  onDragStart={(e) => {
                    setDraggingAction(key);
                    e.dataTransfer!.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDraggingAction(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer!.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = actionOrder().indexOf(draggingAction()!);
                    const to = i();
                    if (from !== to) moveActionInOrder(from, to);
                    setDraggingAction(null);
                  }}
                >
                  <span class="drag-handle">⋮⋮</span>
                  <input type="checkbox" checked={isEnabled} onChange={() => toggleActionSetting(key)} />
                  {labels[key]}
                </label>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Undo Toast */}
      <Show when={toastVisible()}>
        <div class={`undo-toast ${toastClosing() ? 'closing' : ''}`}>
          <div class="toast-progress"></div>
          <div class="toast-content">
            <span class="toast-message">{lastAction() ? getActionLabel(lastAction()!.action, lastAction()!.threadIds.length) : ''}</span>
            <button class="toast-undo-btn" onClick={undoLastAction}>Undo <span class="shortcut-hint">z</span></button>
            <button class="toast-close-btn" onClick={hideToast} title="Dismiss">
              <CloseIcon />
            </button>
          </div>
        </div>
      </Show>
    </div >
  );
}

export default App;
