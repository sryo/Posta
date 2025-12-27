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
import { listen } from '@tauri-apps/api/event';
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from '@tauri-apps/plugin-opener';

import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  createSortable,
  mostIntersecting,
  type Id,
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
  reorderCards,
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
  clearCardCache,
  openAttachment as openAttachmentApi,
  type SendAttachment,
  listLabels,
  type GmailLabel,
  rsvpCalendarEvent,
  getCalendarRsvpStatus,
  syncThreadsIncremental,
  fetchContacts,
  type Contact,
  fetchCalendarEvents,
  type GoogleCalendarEvent,
  listCalendars,
  moveCalendarEvent,
  deleteCalendarEvent,
  pullFromICloud,
  getCachedCardEvents,
  saveCachedCardEvents,
  createCalendarEvent,
  type Attachment,
} from "./api/tauri";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import {
  decodeBase64Utf8,
  formatFileSize,
  formatTime,
  formatSyncTime,
  getSyncState,
  truncateMiddle,
  getInitial,
  extractEmail,
  parseContact,
  getAvatarColor,
  validateEmailList,
  formatEmailDate,
  formatCalendarEventDate,
} from "./utils";
import "./App.css";
import {
  ChevronIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshIcon,
  PlusIcon,
  GoogleLogo,
  SettingsIcon,
  ComposeIcon,
  CloseIcon,
  ClearIcon,
  AttachmentIcon,
  ReplyIcon,
  ReplyAllIcon,
  ForwardIcon,
  ArchiveIcon,
  InboxIcon,
  StarIcon,
  StarFilledIcon,
  TrashIcon,
  EditIcon,
  SpamIcon,
  ThumbsUpIcon,
  ThumbsUpFilledIcon,
  ThumbsDownIcon,
  EyeOpenIcon,
  EyeClosedIcon,
  LabelIcon,
  PaletteIcon,
  CalendarIcon,
  LocationIcon,
  ClockIcon,
  VideoIcon,
  CheckIcon,
} from "./components/Icons";
import { SmartReplies } from "./components/SmartReplies";

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

const ComposeForm = (props: ComposeFormProps) => {
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

const CreateEventForm = (props: {
  show: boolean;
  closing?: boolean;
  onClose: () => void;
  summary: string;
  setSummary: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  endTime: string;
  setEndTime: (v: string) => void;
  allDay: boolean;
  setAllDay: (v: boolean) => void;
  attendees: string;
  setAttendees: (v: string) => void;
  recurrence: string | null;
  setRecurrence: (v: string | null) => void;
  saving: boolean;
  onSave: () => void;
  error: string | null;
}) => {
  if (!props.show) return null;

  // Helpers for custom scheduler UI
  const [viewDate, setViewDate] = createSignal(new Date(props.startDate)); // For navigating months

  const getDaysInWindow = () => {
    const days = [];
    const start = new Date(viewDate());
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const shiftViewDate = (days: number) => {
    const newDate = new Date(viewDate());
    newDate.setDate(newDate.getDate() + days);
    setViewDate(newDate);
  }

  // Recurrence options
  const recurrenceOptions = [
    { label: "No repeat", value: null },
    { label: "Daily", value: "FREQ=DAILY" },
    { label: "Weekly", value: "FREQ=WEEKLY" },
    { label: "Monthly", value: "FREQ=MONTHLY" },
    { label: "Yearly", value: "FREQ=YEARLY" },
    { label: "Weekdays", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }
  ];


  // Auto-scroll to selected times when form opens
  createEffect(() => {
    if (props.show) {
      // Wait for DOM to be ready
      setTimeout(() => {
        const startContainer = document.querySelector('.time-picker-start') as HTMLDivElement;
        const endContainer = document.querySelector('.time-picker-end') as HTMLDivElement;

        if (startContainer) {
          const selectedEl = startContainer.querySelector('[data-selected="true"]') as HTMLElement;
          if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'center' });
          }
        }

        if (endContainer) {
          const selectedEl = endContainer.querySelector('[data-selected="true"]') as HTMLElement;
          if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'center' });
          }
        }
      }, 150);
    }
  });

  // Validate end time isn't before start time
  const handleStartTimeChange = (time: string) => {
    props.setStartTime(time);
    // If end time is now before start time, adjust it
    const startIdx = timeSlots.indexOf(time);
    const endIdx = timeSlots.indexOf(props.endTime);
    if (endIdx <= startIdx) {
      // Set end time to 30 mins after start
      const newEndIdx = Math.min(startIdx + 1, timeSlots.length - 1);
      props.setEndTime(timeSlots[newEndIdx]);
    }
  };

  const handleEndTimeChange = (time: string) => {
    const startIdx = timeSlots.indexOf(props.startTime);
    const endIdx = timeSlots.indexOf(time);
    // Only allow if end is after start
    if (endIdx > startIdx) {
      props.setEndTime(time);
    }
  };

  const handleMonthSelect = (month: number) => {
    const newDate = new Date(viewDate());
    newDate.setMonth(month);
    newDate.setDate(1);
    setViewDate(newDate);
  };

  const handleYearSelect = (year: number) => {
    const newDate = new Date(viewDate());
    newDate.setFullYear(year);
    newDate.setDate(1);
    setViewDate(newDate);
  };

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);

  // Time Helpers
  const timeSlots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      timeSlots.push(`${hh}:${mm}`);
    }
  }

  const formatDateStr = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isSelectedDate = (d: Date) => formatDateStr(d) === props.startDate;

  const handleDateSelect = (d: Date) => {
    const dateStr = formatDateStr(d);
    props.setStartDate(dateStr);
    props.setEndDate(dateStr); // Default to single day event
  };

  const formatDateDisplay = (d: Date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      day: days[d.getDay()],
      date: d.getDate()
    };
  };

  return (
    <div class={`compose-panel event-compose ${props.closing ? 'closing' : ''}`} style={{ height: "auto", "max-height": "90vh", display: "flex", "flex-direction": "column" }}>
      <div class="compose-header">
        <h3>New event</h3>
        <CloseButton onClick={props.onClose} />
      </div>
      <div class="compose-body" style={{ flex: 1, "overflow-y": "auto" }}>
        <div class="compose-field">
          <input
            type="text"
            value={props.summary}
            onInput={(e) => props.setSummary(e.currentTarget.value)}
            placeholder="Event title"
            autofocus
          />
        </div>

        {/* Custom Scheduler UI */}
        <div class="scheduler-ui" style={{ padding: "10px 0", "border-bottom": "1px solid var(--border)" }}>

          {/* Month Header */}
          <div class="scheduler-header" style={{ display: "flex", "justify-content": "space-between", "align-items": "center", padding: "0 15px 10px" }}>
            <div style={{ display: "flex", gap: "5px", "align-items": "center" }}>
              <select
                value={viewDate().getMonth()}
                onChange={(e) => handleMonthSelect(parseInt(e.currentTarget.value))}
                style={{ "font-weight": "600", "font-size": "14px", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer" }}
              >
                <For each={months}>
                  {(m, i) => <option value={i()}>{m}</option>}
                </For>
              </select>
              <select
                value={viewDate().getFullYear()}
                onChange={(e) => handleYearSelect(parseInt(e.currentTarget.value))}
                style={{ "font-weight": "600", "font-size": "14px", background: "transparent", border: "none", color: "var(--text)", cursor: "pointer" }}
              >
                <For each={years}>
                  {(y) => <option value={y}>{y}</option>}
                </For>
              </select>
            </div>
            <div style={{ display: "flex", gap: "5px" }}>
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(-7)} title="Previous Week"><ChevronLeftIcon /></button>
              <button class="btn btn-sm btn-ghost" onClick={() => shiftViewDate(7)} title="Next Week"><ChevronRightIcon /></button>
            </div>
          </div>

          {/* Horizontal Days */}
          <div class="scheduler-days" style={{ display: "flex", gap: "10px", "overflow-x": "auto", padding: "0 15px 15px", "scrollbar-width": "none" }}>
            <For each={getDaysInWindow()}>
              {(day) => {
                const info = formatDateDisplay(day);
                const selected = () => isSelectedDate(day);
                return (
                  <div
                    class={`scheduler-day-card ${selected() ? 'selected' : ''}`}
                    onClick={() => handleDateSelect(day)}
                    style={{
                      display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center",
                      width: "60px", height: "70px",
                      border: selected() ? "2px solid var(--accent)" : "1px solid var(--border)",
                      "border-radius": "8px",
                      "background-color": selected() ? "var(--accent)" : "var(--card-bg)",
                      cursor: "pointer",
                      "flex-shrink": 0
                    }}
                  >
                    <span style={{ "font-size": "12px", color: selected() ? "#fff" : "var(--text-secondary)" }}>{info.day}</span>
                    <span style={{ "font-size": "20px", "font-weight": "600", color: selected() ? "#fff" : "var(--text)" }}>{info.date}</span>
                  </div>
                );
              }}
            </For>
          </div>


          {/* All day toggle */}
          <div style={{ display: "flex", "justify-content": "flex-end", padding: "0 15px", "margin-bottom": "8px" }}>
            <label style={{ display: "flex", "align-items": "center", gap: "5px", cursor: "pointer", "font-size": "12px", color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={props.allDay} onChange={(e) => props.setAllDay(e.currentTarget.checked)} />
              All day
            </label>
          </div>

          {/* Vertical Time Lists + Repeat */}
          <Show when={!props.allDay}>
            <div class="scheduler-times" style={{ display: "flex", gap: "15px", padding: "0 15px", height: "200px" }}>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>Start</label>
                </div>
                <div class="time-picker-start" style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={timeSlots}>
                    {(t) => (
                      <div
                        onClick={() => handleStartTimeChange(t)}
                        data-selected={props.startTime === t}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.startTime === t ? "var(--accent)" : "transparent",
                          "color": props.startTime === t ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {t}
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>End</label>
                </div>
                <div class="time-picker-end" style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={timeSlots}>
                    {(t) => (
                      <div
                        onClick={() => handleEndTimeChange(t)}
                        data-selected={props.endTime === t}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.endTime === t ? "var(--accent)" : "transparent",
                          "color": props.endTime === t ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {t}
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
                <div style={{ display: "flex", "align-items": "center", height: "17px", "margin-bottom": "5px" }}>
                  <label style={{ "font-size": "12px", color: "var(--text-secondary)" }}>Repeat</label>
                </div>
                <div style={{ flex: 1, "overflow-y": "auto", border: "1px solid var(--border)", "border-radius": "6px" }}>
                  <For each={recurrenceOptions}>
                    {(opt) => (
                      <div
                        onClick={() => props.setRecurrence(opt.value)}
                        style={{
                          "padding": "6px 10px",
                          "cursor": "pointer",
                          "background-color": props.recurrence === opt.value ? "var(--accent)" : "transparent",
                          "color": props.recurrence === opt.value ? "#fff" : "var(--text)",
                          "border-radius": "6px",
                          "font-size": "13px",
                          "text-align": "center"
                        }}
                      >
                        {opt.label}
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Show>
        </div>

        <div class="compose-field">
          <input
            type="text"
            value={props.location}
            onInput={(e) => props.setLocation(e.currentTarget.value)}
            placeholder="Location"
          />
        </div>
        <div class="compose-field">
          <input
            type="text"
            value={props.attendees}
            onInput={(e) => props.setAttendees(e.currentTarget.value)}
            placeholder="Guests (comma separated emails)"
          />
        </div>
        <div class="compose-content">
          <textarea
            value={props.description}
            onInput={(e) => props.setDescription(e.currentTarget.value)}
            placeholder="Description"
            style={{ "min-height": "100px" }}
          />
        </div>
      </div>
      <div class="compose-footer">
        <Show when={props.error}><div class="compose-error">{props.error}</div></Show>
        <div class="compose-spacer" />
        <button class="btn btn-primary" disabled={props.saving || !props.summary} onClick={props.onSave} title="Save event (⌘Enter)">
          {props.saving ? "Saving..." : <>Save event <span class="shortcut-hint">⌘↵</span></>}
        </button>
      </div>
    </div>
  );
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

// Message Actions Wheel Component - shared between ThreadView and EventView
const MessageActionsWheel = (props: {
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  open: boolean;
  showHints?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) => {
  const actions = [
    { title: 'Reply', keyHint: 'R', icon: ReplyIcon, onClick: props.onReply },
    { title: 'Reply All', keyHint: 'A', icon: ReplyAllIcon, onClick: props.onReplyAll },
    { title: 'Forward', keyHint: 'F', icon: ForwardIcon, onClick: props.onForward },
  ];

  const innerRadius = 38;
  const numActions = actions.length;

  return (
    <div
      class={`message-actions-wheel ${props.open ? 'open' : ''}`}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <For each={actions}>
        {(action, i) => {
          // Arc on RIGHT side: from -60deg (top-right) to +60deg (bottom-right)
          const angle = (-Math.PI / 3) + (i() / (numActions - 1)) * (2 * Math.PI / 3);
          const x = innerRadius * Math.cos(angle);
          const y = innerRadius * Math.sin(angle);

          return (
            <button
              class="message-action-btn"
              style={{
                left: `calc(50% + ${x.toFixed(1)}px - 13px)`,
                top: `calc(50% + ${y.toFixed(1)}px - 13px)`
              }}
              onClick={(e) => { e.stopPropagation(); action.onClick(); }}
              title={action.title}
            >
              <div style={{ width: '14px', height: '14px' }}>
                <action.icon />
              </div>
              <Show when={props.showHints}>
                <span class="action-key-hint">{action.keyHint}</span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
};

interface InlineComposeProps {
  replyToMessageId: string | null;
  isForward: boolean;
  to: string;
  setTo: (v: string) => void;
  cc: string;
  setCc: (v: string) => void;
  bcc: string;
  setBcc: (v: string) => void;
  showCcBcc: boolean;
  setShowCcBcc: (v: boolean) => void;
  subject: string;
  setSubject: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  attachments: SendAttachment[];
  onRemoveAttachment: (i: number) => void;
  onFileSelect: (e: Event) => void;
  error: string | null;
  draftSaving: boolean;
  draftSaved: boolean;
  sending?: boolean;
  onSend: () => void;
  onClose: () => void;
  onInput: () => void;
  focusBody: boolean;
  // Resize props
  messageWidth: number;
  resizing: boolean;
  onResizeStart: (e: MouseEvent) => void;
}

const ThreadView = (props: {
  thread: FullThread | null,
  loading: boolean,
  error: string | null,
  card: { name: string; color: string | null } | null,
  focusColor: string | null,
  onClose: () => void,
  focusedMessageIndex: number,
  onFocusChange: (index: number) => void,
  onOpenAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onDownloadAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onShowAttachmentMenu: (att: { messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null }) => void,
  onReply: (to: string, cc: string, subject: string, quotedBody: string, messageId: string) => void,
  onForward: (subject: string, body: string) => void,
  // Toolbar action props
  onAction: (action: string) => void,
  onOpenLabels: () => void,
  accountId: string,
  isStarred: boolean,
  isRead: boolean,
  isImportant: boolean,
  isInInbox: boolean,
  labelCount: number,
  // Inline compose
  inlineCompose: InlineComposeProps | null,
  // Attachments from thread listing (with inline_data for thumbnails)
  threadAttachments?: Attachment[],
}) => {
  let messageRefs: (HTMLDivElement | undefined)[] = [];
  let contentRef: HTMLDivElement | undefined;
  const [hoveredMessageId, setHoveredMessageId] = createSignal<string | null>(null);
  const [wheelOpen, setWheelOpen] = createSignal(false);
  const [hoveredLinkUrl, setHoveredLinkUrl] = createSignal<string | null>(null);
  const [closing, setClosing] = createSignal(false);
  let hoverTimeout: number | undefined;

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => props.onClose(), 200); // Match animation duration
  };

  // Scroll to newest message when thread loads
  createEffect(() => {
    if (props.thread && contentRef) {
      requestAnimationFrame(() => {
        const lastIndex = props.thread!.messages.length - 1;
        const lastMessage = messageRefs[lastIndex];
        if (lastMessage) {
          lastMessage.scrollIntoView({ block: 'start' });
        } else {
          contentRef!.scrollTop = contentRef!.scrollHeight;
        }
      });
    }
  });

  // Link hover detection via event delegation
  const handleLinkHover = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link && link.href) {
      setHoveredLinkUrl(link.href);
    } else {
      setHoveredLinkUrl(null);
    }
  };

  const showMessageWheel = (msgId: string) => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    setHoveredMessageId(msgId);
    setWheelOpen(true);
  };

  const hideMessageWheel = () => {
    hoverTimeout = window.setTimeout(() => {
      setWheelOpen(false);
      setHoveredMessageId(null);
    }, 150);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
      return;
    }

    // Toolbar action shortcuts (only when not in input)
    const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (!isTyping && props.thread) {
      if (e.key === 'a') { e.preventDefault(); props.onAction(props.isInInbox ? 'archive' : 'inbox'); return; }
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
    <div class={`thread-overlay ${closing() ? 'closing' : ''}`} style={props.focusColor ? { '--message-focused-color': props.focusColor } as any : undefined}>
      <div class="thread-floating-bar">
        {/* Row 1: Close + Subject + Card indicator */}
        <div class="thread-floating-bar-row">
          <CloseButton onClick={handleClose} />
          <div class="thread-bar-subject">
            <Show when={props.thread} fallback={<span>Loading...</span>}>
              <h2>{props.thread?.messages[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '(No Subject)'}</h2>
            </Show>
          </div>
          <Show when={props.card}>
            <div
              class="thread-bar-card"
              style={props.card?.color ? {
                background: COLOR_HEX[props.card.color] + '20',
                color: COLOR_HEX[props.card.color]
              } : {
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)'
              }}
            >
              {props.card?.name}
            </div>
          </Show>
        </div>

        {/* Row 2: Actions */}
        <Show when={props.thread}>
          <div class="thread-floating-bar-row thread-bar-actions">
            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isInInbox ? 'archive' : 'inbox')} title={props.isInInbox ? 'Archive' : 'Move to Inbox'}>
              {props.isInInbox ? <ArchiveIcon /> : <InboxIcon />}
              <span class="thread-toolbar-label">{props.isInInbox ? 'Archive' : 'Inbox'}</span>
              <span class="shortcut-hint">A</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isStarred ? 'unstar' : 'star')} title={props.isStarred ? "Unstar" : "Star"}>
              {props.isStarred ? <StarFilledIcon /> : <StarIcon />}
              <span class="thread-toolbar-label">{props.isStarred ? 'Unstar' : 'Star'}</span>
              <span class="shortcut-hint">S</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isRead ? 'unread' : 'read')} title={props.isRead ? "Mark unread" : "Mark read"}>
              {props.isRead ? <EyeClosedIcon /> : <EyeOpenIcon />}
              <span class="thread-toolbar-label">{props.isRead ? 'Unread' : 'Read'}</span>
              <span class="shortcut-hint">U</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isImportant ? 'notImportant' : 'important')} title={props.isImportant ? "Unmark important" : "Mark important"}>
              {props.isImportant ? <ThumbsUpFilledIcon /> : <ThumbsUpIcon />}
              <span class="thread-toolbar-label">{props.isImportant ? 'Unmark' : 'Important'}</span>
              <span class="shortcut-hint">I</span>
            </button>

            <div class="thread-toolbar-divider" />

            <button class="thread-toolbar-btn" onClick={props.onOpenLabels} title="Manage labels">
              <LabelIcon />
              <span class="thread-toolbar-label">Labels{props.labelCount > 0 ? ` (${props.labelCount})` : ''}</span>
              <span class="shortcut-hint">L</span>
            </button>

            <div class="thread-toolbar-divider" />

            <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('spam')} title="Report spam">
              <SpamIcon />
              <span class="thread-toolbar-label">Spam</span>
              <span class="shortcut-hint">!</span>
            </button>

            <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('trash')} title="Delete">
              <TrashIcon />
              <span class="thread-toolbar-label">Delete</span>
              <span class="shortcut-hint">#</span>
            </button>
          </div>
        </Show>
      </div>

      <div class="thread-content" ref={contentRef} onMouseOver={handleLinkHover} onMouseOut={() => setHoveredLinkUrl(null)}>
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

                // Extract attachments from message parts, enriched with inline_data from threadAttachments
                const getAttachments = () => {
                  const attachments: { filename: string; mimeType: string; size: number; attachmentId?: string; inlineData?: string }[] = [];
                  const findAttachments = (parts: any[]) => {
                    parts?.forEach(part => {
                      if (part.filename && part.filename.length > 0) {
                        const attachmentId = part.body?.attachmentId;
                        // Look up inline_data from threadAttachments if available
                        const threadAtt = props.threadAttachments?.find(
                          a => a.message_id === msg.id && (a.attachment_id === attachmentId || a.filename === part.filename)
                        );
                        attachments.push({
                          filename: part.filename,
                          mimeType: part.mimeType || 'application/octet-stream',
                          size: part.body?.size || 0,
                          attachmentId,
                          inlineData: threadAtt?.inline_data || part.body?.data,
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

                const isReplyingToThis = () => props.inlineCompose?.replyToMessageId === msg.id;
                const isForwardingFromThis = () => props.inlineCompose?.isForward && index() === props.thread!.messages.length - 1;
                const showInlineCompose = () => isReplyingToThis() || isForwardingFromThis();

                return (
                  <div
                    class={`message-row ${showInlineCompose() ? 'with-compose' : ''} ${props.inlineCompose?.resizing ? 'resizing' : ''}`}
                    onMouseEnter={() => showMessageWheel(msg.id)}
                    onMouseLeave={hideMessageWheel}
                  >
                    <div
                      class={`message-card ${props.focusedMessageIndex === index() ? 'message-focused' : ''}`}
                      ref={(el) => { messageRefs[index()] = el; }}
                    >
                      <div class="message-header">
                        <div class="message-sender">{from}</div>
                        <div class="message-header-actions">
                          <div class="message-date">{formatEmailDate(date)}</div>
                        </div>
                      </div>
                      {/* Message Actions Wheel - show for focused or hovered message */}
                      <Show when={((hoveredMessageId() === msg.id && wheelOpen()) || props.focusedMessageIndex === index()) && !showInlineCompose()}>
                        <MessageActionsWheel
                          onReply={handleReply}
                          onReplyAll={handleReplyAll}
                          onForward={handleForward}
                          open={true}
                          showHints={props.focusedMessageIndex === index()}
                          onMouseEnter={() => showMessageWheel(msg.id)}
                          onMouseLeave={hideMessageWheel}
                        />
                      </Show>
                      <div class="message-body" innerHTML={DOMPurify.sanitize(getBody(), DOMPURIFY_CONFIG)}></div>
                      <Show when={attachments.length > 0}>
                        <div class="message-attachments">
                          <For each={attachments}>
                            {(att) => {
                              const handleContextMenu = (e: MouseEvent) => {
                                e.preventDefault();
                                props.onShowAttachmentMenu({
                                  messageId: msg.id,
                                  attachmentId: att.attachmentId || "",
                                  filename: att.filename,
                                  mimeType: att.mimeType,
                                  inlineData: att.inlineData || null
                                });
                              };
                              const hasThumb = att.inlineData && isImage(att.mimeType);
                              return (
                                <div
                                  class="attachment-thumb clickable"
                                  title={`${att.filename} (${formatFileSize(att.size)})`}
                                  onClick={() => props.onOpenAttachment(msg.id, att.attachmentId, att.filename, att.mimeType, att.inlineData)}
                                  onContextMenu={handleContextMenu}
                                >
                                  {hasThumb ? (
                                    <img
                                      class="attachment-preview"
                                      src={`data:${att.mimeType};base64,${att.inlineData!.replace(/-/g, '+').replace(/_/g, '/')}`}
                                      alt={att.filename}
                                    />
                                  ) : (
                                    <div class={`attachment-icon ${isImage(att.mimeType) ? 'image' : isPdf(att.mimeType) ? 'pdf' : 'file'}`}>
                                      {isImage(att.mimeType) ? '🖼️' : isPdf(att.mimeType) ? '📄' : '📎'}
                                    </div>
                                  )}
                                  <div class="attachment-info">
                                    <div class="attachment-name">{truncateMiddle(att.filename, 20)}</div>
                                    <div class="attachment-size">{formatFileSize(att.size)}</div>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                    {/* Resize handle and inline compose form */}
                    <Show when={showInlineCompose() && props.inlineCompose}>
                      <div
                        class="inline-resize-handle"
                        onMouseDown={props.inlineCompose!.onResizeStart}
                      />
                      <div class="inline-compose">
                        <ComposeForm
                          mode={props.inlineCompose!.isForward ? 'forward' : 'reply'}
                          to={props.inlineCompose!.to}
                          setTo={props.inlineCompose!.setTo}
                          cc={props.inlineCompose!.cc}
                          setCc={props.inlineCompose!.setCc}
                          bcc={props.inlineCompose!.bcc}
                          setBcc={props.inlineCompose!.setBcc}
                          showCcBcc={props.inlineCompose!.showCcBcc}
                          setShowCcBcc={props.inlineCompose!.setShowCcBcc}
                          body={props.inlineCompose!.body}
                          setBody={props.inlineCompose!.setBody}
                          attachments={props.inlineCompose!.attachments}
                          onRemoveAttachment={props.inlineCompose!.onRemoveAttachment}
                          onFileSelect={props.inlineCompose!.onFileSelect}
                          fileInputId={`inline-file-input-${msg.id}`}
                          error={props.inlineCompose!.error}
                          draftSaving={props.inlineCompose!.draftSaving}
                          draftSaved={props.inlineCompose!.draftSaved}
                          sending={props.inlineCompose!.sending}
                          onSend={props.inlineCompose!.onSend}
                          onClose={props.inlineCompose!.onClose}
                          onInput={props.inlineCompose!.onInput}
                          focusBody={props.inlineCompose!.focusBody}
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <SmartReplies
            accountId={props.accountId}
            threadId={props.thread!.id}
            onSelect={(suggestion) => {
              const lastMsg = props.thread!.messages[props.thread!.messages.length - 1];
              if (!lastMsg) return;

              const headers = lastMsg.payload?.headers || [];
              const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
              const date = headers.find(h => h.name === 'Date')?.value || '';
              const replyTo = extractEmail(from);

              const getSubject = () => {
                const subj = headers.find(h => h.name === 'Subject')?.value || '';
                return subj.startsWith('Re:') ? subj : `Re: ${subj}`;
              };

              const getBody = () => {
                const payload = lastMsg.payload;
                if (payload?.body?.data) return decodeBase64Utf8(payload.body.data);

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

                const htmlContent = findContent(payload?.parts, 'text/html');
                if (htmlContent) return htmlContent;
                const textContent = findContent(payload?.parts, 'text/plain');
                if (textContent) return textContent;
                if (lastMsg.snippet) return lastMsg.snippet;
                return "";
              };

              const body = getBody();
              const temp = document.createElement('div');
              temp.innerHTML = DOMPurify.sanitize(body, DOMPURIFY_CONFIG);
              const plainBody = temp.textContent || temp.innerText || '';

              const quotedBody = `\n\nOn ${date}, ${from} wrote:\n> ${plainBody.split('\n').join('\n> ')}`;
              const fullBody = `${suggestion}${quotedBody}`;

              props.onReply(replyTo, "", getSubject(), fullBody, lastMsg.id);
            }}
          />
        </Show>
      </div>


      {/* Link hover status bar */}
      <Show when={hoveredLinkUrl()}>
        <div class="link-status-bar">{hoveredLinkUrl()}</div>
      </Show>
    </div>
  );
};

// Event View Component
const EventView = (props: {
  event: GoogleCalendarEvent | null;
  card: { name: string; color: string | null } | null;
  focusColor: string | null;
  onClose: () => void;
  onRsvp: (status: "accepted" | "declined" | "tentative") => void;
  onReplyOrganizer: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onOpenCalendars: () => void;
  calendarDrawerOpen: boolean;
  onCloseCalendarDrawer: () => void;
  calendars: { id: string; name: string; is_primary: boolean }[];
  calendarsLoading: boolean;
  onMoveToCalendar: (calendarId: string) => void;
  rsvpLoading: boolean;
  inlineCompose: InlineComposeProps | null;
}) => {
  const [closing, setClosing] = createSignal(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => props.onClose(), 200);
  };

  const formatEventDateTime = (startTime: number, endTime: number | null, allDay: boolean) => {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : null;
    const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

    if (allDay) {
      if (end && end.getTime() - start.getTime() > 86400000) {
        return `${start.toLocaleDateString(undefined, dateOpts)} - ${end.toLocaleDateString(undefined, dateOpts)} (All day)`;
      }
      return `${start.toLocaleDateString(undefined, dateOpts)} (All day)`;
    }

    const startDate = start.toLocaleDateString(undefined, dateOpts);
    const startTimeStr = start.toLocaleTimeString(undefined, timeOpts);
    const endTimeStr = end ? end.toLocaleTimeString(undefined, timeOpts) : '';

    if (end && start.toDateString() !== end.toDateString()) {
      return `${startDate} ${startTimeStr} - ${end.toLocaleDateString(undefined, dateOpts)} ${endTimeStr}`;
    }
    return `${startDate}, ${startTimeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}`;
  };

  const getResponseLabel = (status: string | null) => {
    switch (status) {
      case "accepted": return "Going";
      case "tentative": return "Maybe";
      case "declined": return "Declined";
      case "needsAction": return "Pending";
      default: return status || "No response";
    }
  };

  return (
    <div class={`thread-overlay ${closing() ? 'closing' : ''}`} style={props.focusColor ? { '--message-focused-color': props.focusColor } as any : undefined}>
      <div class="thread-floating-bar">
        {/* Row 1: Close + Title + Card indicator */}
        <div class="thread-floating-bar-row">
          <CloseButton onClick={handleClose} />
          <div class="thread-bar-subject">
            <Show when={props.event} fallback={<span>Loading...</span>}>
              <h2>{props.event?.title || '(No title)'}</h2>
            </Show>
          </div>
          <Show when={props.card}>
            <div
              class="thread-bar-card"
              style={props.card?.color ? {
                background: COLOR_HEX[props.card.color] + '20',
                color: COLOR_HEX[props.card.color]
              } : {
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)'
              }}
            >
              {props.card?.name}
            </div>
          </Show>
        </div>

        {/* Row 2: Actions */}
        <Show when={props.event}>
          <div class="thread-floating-bar-row thread-bar-actions">
            {/* Reply to organizer */}
            <Show when={props.event!.organizer}>
              <button
                class="thread-toolbar-btn"
                onClick={props.onReplyOrganizer}
                title="Reply to organizer"
              >
                <ReplyIcon />
                <span class="thread-toolbar-label">Reply</span>
                <span class="shortcut-hint">R</span>
              </button>
            </Show>

            <Show when={props.event!.hangout_link}>
              <div class="thread-toolbar-divider" />
              <button
                class="thread-toolbar-btn"
                onClick={() => props.event!.hangout_link && openUrl(props.event!.hangout_link)}
                title="Join video call"
              >
                <VideoIcon />
                <span class="thread-toolbar-label">Join</span>
                <span class="shortcut-hint">J</span>
              </button>
            </Show>

            <Show when={props.event!.html_link}>
              <button
                class="thread-toolbar-btn"
                onClick={() => props.event!.html_link && openUrl(props.event!.html_link)}
                title="Open in Google Calendar"
              >
                <CalendarIcon />
                <span class="thread-toolbar-label">Open</span>
                <span class="shortcut-hint">O</span>
              </button>
            </Show>

            <button class="thread-toolbar-btn" onClick={props.onOpenCalendars} title="Move to calendar">
              <CalendarIcon />
              <span class="thread-toolbar-label">Move</span>
              <span class="shortcut-hint">C</span>
            </button>

            <div class="thread-toolbar-divider" />

            <button
              class="thread-toolbar-btn thread-toolbar-btn-danger"
              onClick={props.onDelete}
              title="Delete event"
            >
              <TrashIcon />
              <span class="thread-toolbar-label">Delete</span>
              <span class="shortcut-hint">#</span>
            </button>
          </div>
        </Show>
      </div>

      <div class="thread-content">
        <Show when={props.event}>
          <div class="messages-list">
            <div class={`message-row ${props.inlineCompose ? 'with-compose' : ''} ${props.inlineCompose?.resizing ? 'resizing' : ''}`}>
              <div class="message-card message-focused">
                {/* Event Header */}
                <div class="message-header">
                  <div class="message-sender">{props.event!.organizer || 'Unknown organizer'}</div>
                  <div class="message-date">{formatEventDateTime(props.event!.start_time, props.event!.end_time, props.event!.all_day)}</div>
                </div>

                {/* Message Actions Wheel - hide when composing */}
                <Show when={!props.inlineCompose}>
                  <MessageActionsWheel
                    onReply={props.onReplyOrganizer}
                    onReplyAll={props.onReplyAll}
                    onForward={props.onForward}
                    open={true}
                    showHints={true}
                  />
                </Show>

                {/* Calendar Name */}
                <div class="event-info-row">
                  <CalendarIcon />
                  <span>{props.event!.calendar_name}</span>
                </div>

                {/* Location */}
                <Show when={props.event!.location}>
                  <div class="event-info-row">
                    <LocationIcon />
                    <span>{props.event!.location}</span>
                  </div>
                </Show>

                {/* Video call */}
                <Show when={props.event!.hangout_link}>
                  <div class="event-info-row">
                    <VideoIcon />
                    <a href="#" onClick={(e) => { e.preventDefault(); props.event!.hangout_link && openUrl(props.event!.hangout_link); }}>
                      Join video call
                    </a>
                  </div>
                </Show>

                {/* Description */}
                <Show when={props.event!.description}>
                  <div class="message-body">
                    <div innerHTML={props.event!.description!.replace(/\n/g, '<br>')} />
                  </div>
                </Show>

                {/* RSVP Section */}
                <Show when={props.event!.response_status}>
                  <div class="event-rsvp-section">
                    <div class="event-rsvp-current">
                      Your response: <span class={`event-rsvp-status ${props.event!.response_status}`}>
                        {getResponseLabel(props.event!.response_status)}
                      </span>
                    </div>
                    <div class="event-rsvp-buttons">
                      <button
                        class={`event-rsvp-btn ${props.event!.response_status === 'accepted' ? 'active' : ''}`}
                        onClick={() => props.onRsvp('accepted')}
                        disabled={props.rsvpLoading}
                      >
                        Yes
                      </button>
                      <button
                        class={`event-rsvp-btn ${props.event!.response_status === 'tentative' ? 'active' : ''}`}
                        onClick={() => props.onRsvp('tentative')}
                        disabled={props.rsvpLoading}
                      >
                        Maybe
                      </button>
                      <button
                        class={`event-rsvp-btn ${props.event!.response_status === 'declined' ? 'active' : ''}`}
                        onClick={() => props.onRsvp('declined')}
                        disabled={props.rsvpLoading}
                      >
                        No
                      </button>
                    </div>
                  </div>
                </Show>

                {/* Attendees */}
                <Show when={props.event!.attendees.length > 0}>
                  <div class="event-attendees-section">
                    <div class="event-attendees-label">{props.event!.attendees.length} guests</div>
                    <div class="event-attendees-list">
                      <For each={props.event!.attendees}>
                        {(attendee) => (
                          <div class={`event-attendee ${attendee.response_status || ''}`}>
                            <span class="event-attendee-name">
                              {attendee.display_name || attendee.email}
                              {attendee.is_organizer && <span class="event-attendee-badge">Organizer</span>}
                            </span>
                            <span class={`event-attendee-status ${attendee.response_status || ''}`}>
                              {getResponseLabel(attendee.response_status)}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Resize handle and inline compose form */}
              <Show when={props.inlineCompose}>
                <div
                  class="inline-resize-handle"
                  onMouseDown={props.inlineCompose!.onResizeStart}
                />
                <div class="inline-compose">
                  <ComposeForm
                    mode={props.inlineCompose!.isForward ? 'forward' : 'reply'}
                    to={props.inlineCompose!.to}
                    setTo={props.inlineCompose!.setTo}
                    cc={props.inlineCompose!.cc}
                    setCc={props.inlineCompose!.setCc}
                    bcc={props.inlineCompose!.bcc}
                    setBcc={props.inlineCompose!.setBcc}
                    showCcBcc={props.inlineCompose!.showCcBcc}
                    setShowCcBcc={props.inlineCompose!.setShowCcBcc}
                    body={props.inlineCompose!.body}
                    setBody={props.inlineCompose!.setBody}
                    attachments={props.inlineCompose!.attachments}
                    onRemoveAttachment={props.inlineCompose!.onRemoveAttachment}
                    onFileSelect={props.inlineCompose!.onFileSelect}
                    fileInputId={`inline-file-input-event-${props.event!.id}`}
                    error={props.inlineCompose!.error}
                    draftSaving={props.inlineCompose!.draftSaving}
                    draftSaved={props.inlineCompose!.draftSaved}
                    sending={props.inlineCompose!.sending}
                    onSend={props.inlineCompose!.onSend}
                    onClose={props.inlineCompose!.onClose}
                    onInput={props.inlineCompose!.onInput}
                    focusBody={props.inlineCompose!.focusBody}
                  />
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Calendar Drawer */}
      <Show when={props.calendarDrawerOpen}>
        <div class="label-drawer-overlay" onClick={props.onCloseCalendarDrawer}></div>
        <div class="label-drawer">
          <div class="label-drawer-header">
            <h3>Move to Calendar</h3>
            <CloseButton onClick={props.onCloseCalendarDrawer} />
          </div>

          <div class="label-drawer-body">
            <Show when={props.calendarsLoading}>
              <div class="label-drawer-loading">Loading calendars...</div>
            </Show>

            <Show when={!props.calendarsLoading}>
              <For each={props.calendars}>
                {(cal) => {
                  const isCurrent = () => props.event?.calendar_id === cal.id;

                  return (
                    <label class={`label-item ${isCurrent() ? 'label-item-selected' : ''}`}>
                      <input
                        type="radio"
                        name="event-calendar"
                        checked={isCurrent()}
                        onChange={() => props.onMoveToCalendar(cal.id)}
                      />
                      <span class="label-name">{cal.name}</span>
                      <Show when={cal.is_primary}>
                        <span class="label-badge">Primary</span>
                      </Show>
                    </label>
                  );
                }}
              </For>

              <Show when={!props.calendarsLoading && props.calendars.length === 0}>
                <div class="label-drawer-empty">No calendars found</div>
              </Show>
            </Show>
          </div>

          <div class="label-drawer-footer">
            <span class="shortcut-hint">Press C to toggle calendars</span>
          </div>
        </div>
      </Show>
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
type GroupBy = "date" | "sender" | "label" | "organizer" | "calendar";
const EMAIL_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "sender", label: "Sender" },
  { value: "label", label: "Label" },
];
const CALENDAR_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "organizer", label: "Organizer" },
  { value: "calendar", label: "Calendar" },
];

type ActionSettings = Record<string, boolean>;

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

  // Event View State
  const [activeEvent, setActiveEvent] = createSignal<GoogleCalendarEvent | null>(null);
  const [activeEventCardId, setActiveEventCardId] = createSignal<string | null>(null);

  // Calendar drawer state (for events)
  const [calendarDrawerOpen, setCalendarDrawerOpen] = createSignal(false);
  const [availableCalendars, setAvailableCalendars] = createSignal<{ id: string; name: string; is_primary: boolean }[]>([]);
  const [calendarsLoading, setCalendarsLoading] = createSignal(false);
  // Track last account to detect changes
  let lastAccountId: string | null = null;

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
  const [cardCalendarEvents, setCardCalendarEvents] = createSignal<Record<string, GoogleCalendarEvent[]>>({});
  const [loadingThreads, setLoadingThreads] = createSignal<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = createSignal<Record<string, string | null>>({});
  const [collapsedCards, setCollapsedCards] = createSignal<Record<string, boolean>>({});
  const [cardPageTokens, setCardPageTokens] = createSignal<Record<string, string | null>>({});
  const [cardHasMore, setCardHasMore] = createSignal<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = createSignal<Record<string, boolean>>({});

  // Sync status tracking
  const [lastSyncTimes, setLastSyncTimes] = createSignal<Record<string, number>>({});
  const [syncErrors, setSyncErrors] = createSignal<Record<string, string | null>>({});
  // Current time signal for reactive relative time displays (updates every 30s)
  const [currentTime, setCurrentTime] = createSignal(Date.now());

  // Google Contacts from People API
  const [googleContacts, setGoogleContacts] = createSignal<Contact[]>([]);

  // RSVP status tracking (thread ID -> "accepted" | "tentative" | "declined" | "needsAction")
  const [rsvpStatus, setRsvpStatus] = createSignal<Record<string, string>>({});
  const [rsvpLoading, setRsvpLoading] = createSignal<Record<string, boolean>>({});

  // Fetch RSVP status for a calendar event
  const fetchRsvpStatus = async (threadId: string, eventUid: string) => {
    if (!selectedAccount() || !eventUid) return;
    try {
      const status = await getCalendarRsvpStatus(selectedAccount()!.id, eventUid);
      if (status) {
        setRsvpStatus(prev => ({ ...prev, [threadId]: status }));
      }
    } catch (e) {
      console.error("Failed to fetch RSVP status:", e);
    }
  };

  const handleRsvp = async (threadId: string, eventUid: string | null, status: string) => {
    if (!eventUid || !selectedAccount()) return;

    // Map UI status to API status
    const apiStatus = status === "yes" ? "accepted" : status === "maybe" ? "tentative" : "declined";

    // Set loading
    setRsvpLoading(prev => ({ ...prev, [threadId]: true }));

    try {
      await rsvpCalendarEvent(selectedAccount()!.id, eventUid, apiStatus);

      // Update local state on success
      setRsvpStatus(prev => ({ ...prev, [threadId]: apiStatus }));
    } catch (e) {
      console.error("Failed to update RSVP:", e);
      showToast(`Failed to update RSVP: ${e}`);
    } finally {
      setRsvpLoading(prev => ({ ...prev, [threadId]: false }));
    }
  };

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
  const [simpleToastMessage, setSimpleToastMessage] = createSignal<string | null>(null);
  let toastTimeoutId: number | undefined;

  // Undo send state
  interface PendingSend {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    attachments: SendAttachment[];
    reply?: { threadId: string; messageId: string };
    timeoutId: number;
  }
  const [pendingSend, setPendingSend] = createSignal<PendingSend | null>(null);
  const [sendToastVisible, setSendToastVisible] = createSignal(false);
  const [sendToastClosing, setSendToastClosing] = createSignal(false);
  const [sendProgress, setSendProgress] = createSignal(0);
  const SEND_DELAY_MS = 5000;

  // Settings
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);
  const [accountChooserOpen, setAccountChooserOpen] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const MIN_CARD_WIDTH = 250;
  const MAX_CARD_WIDTH = 600;
  const [cardWidth, setCardWidth] = createSignal<number>(
    Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, parseInt(safeGetItem("cardWidth") || "320", 10)))
  );
  const snippetLines = 5; // Fixed at 5 lines

  // Inline compose resize
  const [inlineResizing, setInlineResizing] = createSignal(false);
  const MIN_MESSAGE_WIDTH = 200;
  const MAX_MESSAGE_WIDTH = 1200;
  const getMaxMessageWidth = () => Math.min(MAX_MESSAGE_WIDTH, window.innerWidth - 96 - 220);
  const [inlineMessageWidth, setInlineMessageWidth] = createSignal<number>(
    Math.max(MIN_MESSAGE_WIDTH, Math.min(getMaxMessageWidth(), parseInt(safeGetItem("inlineMessageWidth") || "400", 10)))
  );

  function updateInlineMessageWidth(width: number) {
    setInlineMessageWidth(width);
    safeSetItem("inlineMessageWidth", String(width));
    document.documentElement.style.setProperty("--inline-message-width", `${width}px`);
  }

  function handleInlineResizeStart(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    setInlineResizing(true);
    const startX = e.clientX;
    const startWidth = inlineMessageWidth();
    const onMove = (moveE: MouseEvent) => {
      const delta = moveE.clientX - startX;
      const newWidth = Math.max(MIN_MESSAGE_WIDTH, Math.min(getMaxMessageWidth(), startWidth + delta));
      updateInlineMessageWidth(newWidth);
    };
    const onUp = () => {
      setInlineResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Thread action visibility settings
  const [actionSettings, setActionSettings] = createSignal<Record<string, boolean>>(
    safeGetJSON<ActionSettings>("actionSettings", { "archive": false, "star": true, "trash": false, "markRead": true, "markUnread": false, "markImportant": true, "spam": false, "quickReply": true, "quickForward": false })
  );
  const DEFAULT_ACTION_ORDER = ["markImportant", "markRead", "star", "quickReply", "quickForward", "archive", "spam", "trash"];
  const [actionOrder, setActionOrder] = createSignal<string[]>(
    safeGetJSON<string[]>("actionOrder", DEFAULT_ACTION_ORDER)
  );
  const [draggingAction, setDraggingAction] = createSignal<string | null>(null);

  // Event action visibility settings
  const [eventActionSettings, setEventActionSettings] = createSignal<Record<string, boolean>>(
    safeGetJSON<Record<string, boolean>>("eventActionSettings", { "openCalendar": true, "rsvpYes": true, "rsvpNo": true, "joinMeeting": true, "quickReply": true, "delete": false })
  );
  const DEFAULT_EVENT_ACTION_ORDER = ["openCalendar", "rsvpYes", "rsvpNo", "joinMeeting", "quickReply", "delete"];
  const [eventActionOrder, setEventActionOrder] = createSignal<string[]>(
    safeGetJSON<string[]>("eventActionOrder", DEFAULT_EVENT_ACTION_ORDER)
  );

  // Background color picker (stores index, not color value)
  const [bgColorPickerOpen, setBgColorPickerOpen] = createSignal(false);
  const [selectedBgColorIndex, setSelectedBgColorIndex] = createSignal<number | null>(
    safeGetItem("bgColorIndex") ? parseInt(safeGetItem("bgColorIndex")!) : null
  );

  // Add card form
  const [addingCard, setAddingCard] = createSignal(false);
  const [closingAddCard, setClosingAddCard] = createSignal(false);
  const [newCardName, setNewCardName] = createSignal("");
  const [newCardQuery, setNewCardQuery] = createSignal("");
  const [newCardColor, setNewCardColor] = createSignal<CardColor>(null);
  const [newCardGroupBy, setNewCardGroupBy] = createSignal<GroupBy>("date");
  const [colorPickerOpen, setColorPickerOpen] = createSignal(false);
  let addCardFormRef: HTMLDivElement | undefined;

  // Scroll add card form into view when it appears
  createEffect(() => {
    if (addingCard() && addCardFormRef) {
      requestAnimationFrame(() => {
        addCardFormRef?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      });
    }
  });

  // Edit card state
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editCardName, setEditCardName] = createSignal("");
  const [editCardQuery, setEditCardQuery] = createSignal("");
  const [editCardColor, setEditCardColor] = createSignal<CardColor>(null);
  const [editColorPickerOpen, setEditColorPickerOpen] = createSignal(false);

  // Keyboard navigation focus state
  const [focusedCardId, setFocusedCardId] = createSignal<string | null>(null);
  const [focusedThreadIndex, setFocusedThreadIndex] = createSignal<number>(-1);

  // Native context menu for attachments
  async function showAttachmentContextMenu(
    att: { messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null }
  ) {
    const openItem = await MenuItem.new({
      text: "Open",
      action: () => openAttachment(att.messageId, att.attachmentId, att.filename, att.mimeType, att.inlineData),
    });
    const downloadItem = await MenuItem.new({
      text: "Download",
      action: () => downloadAttachment(att.messageId, att.attachmentId, att.filename, att.mimeType, att.inlineData),
    });
    const separator = await PredefinedMenuItem.new({ item: "Separator" });
    const forwardItem = await MenuItem.new({
      text: "Forward",
      enabled: !!att.inlineData,
      action: () => showToast(`Forward ${att.filename} - coming soon`),
    });

    const menu = await Menu.new({
      items: [openItem, downloadItem, separator, forwardItem],
    });
    await menu.popup();
  }

  // Gmail search autocomplete
  const [queryAutocompleteOpen, setQueryAutocompleteOpen] = createSignal(false);
  const [queryAutocompleteIndex, setQueryAutocompleteIndex] = createSignal(0);
  const [queryInputRef, setQueryInputRef] = createSignal<HTMLInputElement | null>(null);
  const [queryDropdownPos, setQueryDropdownPos] = createSignal<{ top: number; left: number; width: number } | null>(null);
  const [queryPreviewThreads, setQueryPreviewThreads] = createSignal<ThreadGroup[]>([]);
  const [queryPreviewCalendarEvents, setQueryPreviewCalendarEvents] = createSignal<GoogleCalendarEvent[]>([]);
  const [queryPreviewLoading, setQueryPreviewLoading] = createSignal(false);
  const [queryHelpOpen, setQueryHelpOpen] = createSignal(false);
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
      setQueryPreviewCalendarEvents([]);
      return;
    }

    const account = selectedAccount();
    if (!account) return;

    setQueryPreviewLoading(true);

    // Fetch calendar events for calendar queries
    if (query.toLowerCase().includes("calendar:")) {
      setQueryPreviewThreads([]);
      try {
        const events = await fetchCalendarEvents(account.id, query);
        setQueryPreviewCalendarEvents(events);
      } catch {
        setQueryPreviewCalendarEvents([]);
      } finally {
        setQueryPreviewLoading(false);
      }
      return;
    }

    // Fetch threads for email queries
    setQueryPreviewCalendarEvents([]);
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

  // Event quick reply
  const [quickReplyEventId, setQuickReplyEventId] = createSignal<string | null>(null);

  // Thread actions wheel
  const [hoveredThread, setHoveredThread] = createSignal<string | null>(null);
  const [actionsWheelOpen, setActionsWheelOpen] = createSignal(false);
  const [actionConfigMenu, setActionConfigMenu] = createSignal<{ x: number; y: number; isEvent?: boolean } | null>(null);
  let hoverActionsTimeout: number | undefined;

  // Event actions wheel
  const [hoveredEvent, setHoveredEvent] = createSignal<string | null>(null);
  const [eventActionsWheelOpen, setEventActionsWheelOpen] = createSignal(false);
  let hoverEventActionsTimeout: number | undefined;

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

  function showEventHoverActions(eventId: string) {
    if (hoverEventActionsTimeout) {
      clearTimeout(hoverEventActionsTimeout);
      hoverEventActionsTimeout = undefined;
    }
    setHoveredEvent(eventId);
    setEventActionsWheelOpen(true);
  }

  function hideEventHoverActions() {
    hoverEventActionsTimeout = window.setTimeout(() => {
      setEventActionsWheelOpen(false);
      setHoveredEvent(null);
    }, 100);
  }

  const [selectedThreads, setSelectedThreads] = createSignal<Record<string, Set<string>>>({});
  const [lastSelectedThread, setLastSelectedThread] = createSignal<Record<string, string | null>>({});

  // Event selection (like thread selection)
  const [selectedEvents, setSelectedEvents] = createSignal<Record<string, Set<string>>>({});
  const [lastSelectedEvent, setLastSelectedEvent] = createSignal<Record<string, string | null>>({});

  // Compose
  const [composing, setComposing] = createSignal(false);
  // Event creation state
  const [creatingEvent, setCreatingEvent] = createSignal(false);
  const [newEventSummary, setNewEventSummary] = createSignal("");
  const [newEventDescription, setNewEventDescription] = createSignal("");
  const [newEventLocation, setNewEventLocation] = createSignal("");
  // Smart defaults: round up to next 30-min interval, end 30 mins later
  const getSmartEventDefaults = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = minutes <= 30 ? 30 : 60;
    const startTime = new Date(now);
    startTime.setMinutes(roundedMinutes, 0, 0);
    if (roundedMinutes === 60) {
      startTime.setHours(startTime.getHours() + 1);
      startTime.setMinutes(0, 0, 0);
    }
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    return {
      date: now.toISOString().split('T')[0],
      startTime: `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`,
      endTime: `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`
    };
  };
  const eventDefaults = getSmartEventDefaults();
  const [newEventStartDate, setNewEventStartDate] = createSignal(eventDefaults.date);
  const [newEventStartTime, setNewEventStartTime] = createSignal(eventDefaults.startTime);
  const [newEventEndDate, setNewEventEndDate] = createSignal(eventDefaults.date);
  const [newEventEndTime, setNewEventEndTime] = createSignal(eventDefaults.endTime);
  const [newEventAllDay, setNewEventAllDay] = createSignal(false);
  const [newEventAttendees, setNewEventAttendees] = createSignal("");
  const [newEventRecurrence, setNewEventRecurrence] = createSignal<string | null>(null);
  const [newEventSaving, setNewEventSaving] = createSignal(false);
  const [newEventError, setNewEventError] = createSignal<string | null>(null);
  const resetEventFormToNow = () => {
    const defaults = getSmartEventDefaults();
    setNewEventStartDate(defaults.date);
    setNewEventStartTime(defaults.startTime);
    setNewEventEndDate(defaults.date);
    setNewEventEndTime(defaults.endTime);
  };
  const [closingEvent, setClosingEvent] = createSignal(false);
  const closeEventForm = () => {
    setClosingEvent(true);
    setTimeout(() => {
      setCreatingEvent(false);
      setClosingEvent(false);
      setNewEventSummary("");
      setNewEventDescription("");
      setNewEventLocation("");
      setNewEventAttendees("");
      setNewEventRecurrence(null);
      setNewEventError(null);
    }, 200);
  };
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
  const [replyingToEvent, setReplyingToEvent] = createSignal<{ eventId: string } | null>(null);
  const [forwardingEvent, setForwardingEvent] = createSignal<{ eventId: string } | null>(null);
  const [focusComposeBody, setFocusComposeBody] = createSignal(false);
  const [composeEmailError, setComposeEmailError] = createSignal<string | null>(null);
  const [draftSaved, setDraftSaved] = createSignal(false);
  const [draftSaving, setDraftSaving] = createSignal(false);
  const [composeAttachments, setComposeAttachments] = createSignal<SendAttachment[]>([]);
  const [gmailDraftId, setGmailDraftId] = createSignal<string | null>(null);
  let fabHoverTimeout: number | undefined;
  let draftSaveTimeout: number | undefined;

  // Draft management
  interface Draft {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    threadId?: string;
    gmailDraftId?: string;
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

  async function saveDraft() {
    if (!composing()) return;
    const account = selectedAccount();
    if (!account) return;

    const key = getDraftKey();
    const draft: Draft = {
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      threadId: replyingToThread()?.threadId,
      gmailDraftId: gmailDraftId() || undefined,
      savedAt: Date.now(),
    };

    // Only save if there's content
    if (!draft.to && !draft.subject && !draft.body) return;

    // Save locally first (for offline support)
    safeSetJSON(key, draft);

    // Try to sync to Gmail
    setDraftSaving(true);
    try {
      const result = await invoke<{ id: string }>("save_draft", {
        accountId: account.id,
        draftId: gmailDraftId(),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        threadId: draft.threadId || null,
      });
      setGmailDraftId(result.id);
      // Update local storage with Gmail draft ID
      draft.gmailDraftId = result.id;
      safeSetJSON(key, draft);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch (e) {
      console.warn("Failed to sync draft to Gmail (offline?):", e);
      // Still show saved for local save
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } finally {
      setDraftSaving(false);
    }
  }

  function loadDraft(): Draft | null {
    const key = getDraftKey();
    const saved = safeGetItem(key);
    if (saved) {
      try {
        const draft = JSON.parse(saved) as Draft;
        if (draft.gmailDraftId) {
          setGmailDraftId(draft.gmailDraftId);
        }
        return draft;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function clearDraft() {
    const key = getDraftKey();
    const account = selectedAccount();
    const draftId = gmailDraftId();

    // Clear local storage
    safeRemoveItem(key);
    setGmailDraftId(null);

    // Try to delete from Gmail
    if (account && draftId) {
      try {
        await invoke("delete_draft", {
          accountId: account.id,
          draftId: draftId,
        });
      } catch (e) {
        console.warn("Failed to delete draft from Gmail:", e);
      }
    }
  }

  function debouncedSaveDraft() {
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
    draftSaveTimeout = setTimeout(saveDraft, 3000) as unknown as number;
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

  // Settings form
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  const [vertexProjectId, setVertexProjectId] = createSignal(localStorage.getItem("google_cloud_project_id") || "");
  const [smartRepliesOpen, setSmartRepliesOpen] = createSignal(false);

  // Preset selection for new accounts
  const [showPresetSelection, setShowPresetSelection] = createSignal(false);
  const [showRestorePrompt, setShowRestorePrompt] = createSignal(false);

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
        { name: "Files", query: "has:attachment", color: "purple" },
        { name: "Today", query: "calendar:today" },
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

  // Enhanced polling with adaptive interval
  const BASE_POLL_INTERVAL = 30000; // 30 seconds
  const MAX_POLL_INTERVAL = 300000; // 5 minutes
  const [pollInterval, setPollInterval] = createSignal(BASE_POLL_INTERVAL);
  let pollTimeoutId: number | undefined;
  let isPolling = false;

  // Perform incremental sync and update UI
  async function performIncrementalSync() {
    const account = selectedAccount();
    if (!account || isPolling) return;

    isPolling = true;
    try {
      const result = await syncThreadsIncremental(account.id);

      // Update sync times for all non-collapsed cards (sync was successful)
      const now = Date.now();
      const nonCollapsedCardIds = cards()
        .filter(c => !c.collapsed && c.account_id === account.id)
        .map(c => c.id);
      if (nonCollapsedCardIds.length > 0) {
        const updatedTimes = { ...lastSyncTimes() };
        for (const cardId of nonCollapsedCardIds) {
          updatedTimes[cardId] = now;
        }
        setLastSyncTimes(updatedTimes);
      }

      // Check if there were any changes
      const hasChanges = result.modified_threads.length > 0 || result.deleted_thread_ids.length > 0;

      if (hasChanges) {
        // Reset to fast polling when changes detected
        setPollInterval(BASE_POLL_INTERVAL);

        // Apply changes to card threads
        applyIncrementalChanges(result.modified_threads, result.deleted_thread_ids);
      } else {
        // Backoff when idle (multiply by 1.5, max 5 minutes)
        setPollInterval(prev => Math.min(Math.floor(prev * 1.5), MAX_POLL_INTERVAL));
      }
    } catch (e) {
      console.error("Incremental sync failed:", e);
      // On error, backoff but don't stop polling
      setPollInterval(prev => Math.min(prev * 2, MAX_POLL_INTERVAL));
    } finally {
      isPolling = false;
    }
  }

  // Apply incremental changes to all cards
  function applyIncrementalChanges(modifiedThreads: Thread[], deletedThreadIds: string[]) {
    if (modifiedThreads.length === 0 && deletedThreadIds.length === 0) return;

    const currentCardThreads = cardThreads();
    const updatedCardThreads: Record<string, ThreadGroup[]> = {};
    const matchedThreadIds = new Set<string>();

    for (const cardId of Object.keys(currentCardThreads)) {
      const groups = currentCardThreads[cardId];
      if (!groups) continue;

      const updatedGroups = groups.map(group => {
        let threads = [...group.threads];

        // Remove deleted threads
        threads = threads.filter(t => !deletedThreadIds.includes(t.gmail_thread_id));

        // Update modified threads
        for (const modifiedThread of modifiedThreads) {
          const existingIndex = threads.findIndex(t => t.gmail_thread_id === modifiedThread.gmail_thread_id);
          if (existingIndex >= 0) {
            threads[existingIndex] = modifiedThread;
            matchedThreadIds.add(modifiedThread.gmail_thread_id);
          }
        }

        return { ...group, threads };
      });

      // Filter out empty groups
      updatedCardThreads[cardId] = updatedGroups.filter(g => g.threads.length > 0);
    }

    setCardThreads(prev => ({ ...prev, ...updatedCardThreads }));

    // Check for new threads that weren't in any card
    const unmatchedThreads = modifiedThreads.filter(t => !matchedThreadIds.has(t.gmail_thread_id));
    if (unmatchedThreads.length > 0) {
      // New threads detected - refresh non-collapsed cards in background
      const account = selectedAccount();
      if (account) {
        const nonCollapsedCards = cards().filter(c => !c.collapsed && c.card_type !== "calendar");
        for (const card of nonCollapsedCards) {
          fetchAndCacheThreads(account.id, card.id);
        }
      }
    }
  }

  // Schedule next poll
  function schedulePoll() {
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId);
    }
    pollTimeoutId = window.setTimeout(async () => {
      await performIncrementalSync();
      schedulePoll(); // Schedule next poll after this one completes
    }, pollInterval());
  }

  // Handle window focus - reset to fast polling and sync immediately
  function handleWindowFocus() {
    setPollInterval(BASE_POLL_INTERVAL);
    setCurrentTime(Date.now());
    performIncrementalSync();
  }

  // Drag and drop
  const cardIds = () => cards().map(c => c.id);
  let wasDragging = false;

  const onDragStart = () => {
    wasDragging = true;
  };

  const onDragEnd = async (event: { draggable: { id: Id } | null; droppable: { id: Id } | null }) => {
    const { draggable, droppable } = event;
    // Reset drag flag after a short delay to prevent click from firing
    setTimeout(() => { wasDragging = false; }, 100);
    if (draggable && droppable) {
      const currentIds = cardIds();
      const fromIndex = currentIds.indexOf(String(draggable.id));
      const toIndex = currentIds.indexOf(String(droppable.id));
      if (fromIndex !== toIndex) {
        const previousCards = cards();
        const currentCards = [...previousCards];
        const [movedCard] = currentCards.splice(fromIndex, 1);
        currentCards.splice(toIndex, 0, movedCard);

        const reorderedCards = currentCards.map((card, index) => ({
          ...card,
          position: index
        }));

        setCards(reorderedCards);

        try {
          const orders: [string, number][] = reorderedCards.map(c => [c.id, c.position]);
          await reorderCards(orders);
        } catch (err) {
          console.error("Failed to persist card order:", err);
          setCards(previousCards);
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

    // Apply saved inline message width
    document.documentElement.style.setProperty("--inline-message-width", `${inlineMessageWidth()}px`);

    // Constrain inline message width on window resize
    const handleResize = () => {
      const maxWidth = getMaxMessageWidth();
      if (inlineMessageWidth() > maxWidth) {
        updateInlineMessageWidth(Math.max(MIN_MESSAGE_WIDTH, maxWidth));
      }
    };
    window.addEventListener("resize", handleResize);

    // Listen for color scheme changes
    const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handleColorSchemeChange = (e: MediaQueryListEvent) => {
      const deck = document.querySelector(".deck") as HTMLElement;
      if (deck?.dataset.bgLight || deck?.dataset.bgDark) {
        const bgColor = e.matches ? deck.dataset.bgDark! : deck.dataset.bgLight!;
        deck.style.background = bgColor;
        document.documentElement.style.setProperty("--app-bg", bgColor);
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

      // Pull cards/accounts from iCloud if available (restores layout after re-login)
      try {
        await pullFromICloud();
      } catch (e) {
        console.warn("iCloud sync not available:", e);
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

        // Set up enhanced polling with adaptive interval
        schedulePoll();

        // Add window focus listener for immediate sync
        window.addEventListener("focus", handleWindowFocus);

        // Fetch Google contacts in background for autocomplete
        fetchContacts(accts[0].id)
          .then(contacts => setGoogleContacts(contacts))
          .catch(e => console.warn("Failed to fetch contacts (user may need to re-auth):", e));
      }

      // Listen for mailto: deep-link events
      const unlistenMailto = await listen<{
        to: string;
        cc: string;
        bcc: string;
        subject: string;
        body: string;
      }>("mailto-received", (event) => {
        const data = event.payload;
        // Populate compose form with mailto data
        setComposeTo(data.to);
        setComposeCc(data.cc);
        setComposeBcc(data.bcc);
        setComposeSubject(data.subject);
        setComposeBody(data.body);
        // Show CC/BCC if they have values
        if (data.cc || data.bcc) {
          setShowCcBcc(true);
        }
        // Open compose panel
        setReplyingToThread(null);
        setForwardingThread(null);
        setComposing(true);
      });

      // Store unlisten function for cleanup
      onCleanup(() => {
        unlistenMailto();
      });
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

  // Update currentTime every second to keep relative timestamps fresh
  const timeUpdateInterval = setInterval(() => setCurrentTime(Date.now()), 1000);

  onCleanup(() => {
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId);
    }
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
    clearInterval(timeUpdateInterval);
    window.removeEventListener("focus", handleWindowFocus);
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

    // Cmd/Ctrl+Enter to save event (works even when typing)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && creatingEvent() && newEventSummary() && !newEventSaving()) {
      e.preventDefault();
      handleCreateEvent();
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

    // e to create event
    if (e.key === 'e') {
      e.preventDefault();
      resetEventFormToNow();
      setCreatingEvent(true);
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
      } else if (activeEvent()) {
        closeEvent();
      } else if (creatingEvent()) {
        closeEventForm();
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

    // Card navigation - h/l for left/right between cards
    if (e.key === 'h' || e.key === 'l') {
      e.preventDefault();
      const cardsList = cards().filter(c => !collapsedCards()[c.id]);
      if (cardsList.length === 0) return;

      let cardId = focusedCardId();

      // If no focus, start at first or last card
      if (!cardId) {
        const targetCard = e.key === 'l' ? cardsList[0] : cardsList[cardsList.length - 1];
        setFocusedCardId(targetCard.id);
        setFocusedThreadIndex(0);
        return;
      }

      const cardIndex = cardsList.findIndex(c => c.id === cardId);
      const newCardIndex = e.key === 'l' ? cardIndex + 1 : cardIndex - 1;

      if (newCardIndex >= 0 && newCardIndex < cardsList.length) {
        setFocusedCardId(cardsList[newCardIndex].id);
        setFocusedThreadIndex(0);
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
        const isInInbox = thread.labels?.includes('INBOX') ?? true;
        handleThreadAction(isInInbox ? 'archive' : 'inbox', [thread.gmail_thread_id], cardId);
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

      const result = await runOAuthFlow();

      if (typeof result === 'string') {
        // iOS flow: result is the auth URL
        await openUrl(result);
        return;
      }

      const account = result;
      setAccounts([...accounts(), account]);
      setSelectedAccount(account);

      // Try to restore cards from iCloud (remaps orphaned cards to new account)
      try {
        await pullFromICloud();
      } catch (e) {
        console.warn("iCloud pull failed:", e);
      }

      const cardList = await getCards(account.id);
      setCards(cardList);

      // Show restore prompt if cards exist (restored from iCloud)
      // Otherwise show preset selection for new users
      if (cardList.length > 0) {
        setShowRestorePrompt(true);
      } else {
        setShowPresetSelection(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleAddAccount() {
    const storedCreds = await getStoredCredentials();

    if (!storedCreds) {
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

      const exists = accounts().find(a => a.id === account.id);
      if (!exists) {
        setAccounts([...accounts(), account]);
      }
      setSelectedAccount(account);

      try {
        await pullFromICloud();
      } catch (e) {
        console.warn("iCloud pull failed:", e);
      }

      const cardList = await getCards(account.id);
      setCards(cardList);

      setSettingsOpen(false);
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

      for (const cardPreset of preset.cards) {
        const card = await createCard(account.id, cardPreset.name, cardPreset.query, cardPreset.color || null);
        newCards.push(card);
      }

      setCards(newCards);

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

  async function handleStartFresh() {
    try {
      // Delete all existing cards
      const currentCards = cards();
      for (const card of currentCards) {
        await deleteCard(card.id);
      }
      setCards([]);
      setCollapsedCards({});

      // Close restore prompt and show preset selection
      setShowRestorePrompt(false);
      setShowPresetSelection(true);
    } catch (e) {
      setError(`Failed to reset layout: ${e}`);
    }
  }

  async function handleSaveSettings() {
    if (!clientId() || !clientSecret()) return;

    try {
      // configureAuth stores credentials securely on the backend
      await configureAuth({
        client_id: clientId(),
        client_secret: clientSecret(),
      });
      setSettingsOpen(false);

      // Directly run OAuth flow since we just configured auth
      setAuthLoading(true);
      setError(null);
      try {
        const account = await runOAuthFlow();


        setAccounts([...accounts(), account]);
        setSelectedAccount(account);

        // Try to restore cards from iCloud (remaps orphaned cards to new account)
        try {
          await pullFromICloud();
        } catch (e) {
          console.warn("iCloud pull failed:", e);
        }

        const cardList = await getCards(account.id);
        setCards(cardList);

        if (cardList.length > 0) {
          setShowRestorePrompt(true);
        } else {
          setShowPresetSelection(true);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setAuthLoading(false);
      }
    } catch (e) {
      setError(`Failed to save credentials: ${e}`);
    }
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
      // Auto-detect card type from query: if contains "calendar:", it's a calendar card
      const query = newCardQuery();
      const cardType = query.toLowerCase().includes("calendar:") ? "calendar" : "email";

      const card = await createCard(account.id, newCardName(), query, newCardColor() || null, newCardGroupBy(), cardType);
      setCards([...cards(), card]);
      setCollapsedCards({ ...collapsedCards(), [card.id]: false });
      setNewCardName("");
      setNewCardQuery("");
      setNewCardColor(null);
      setNewCardGroupBy("date");
      setAddingCard(false);
      // Fetch threads/events for the new card
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
    clearDraft(); // Clear draft from localStorage and Gmail when compose closes
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
      setGmailDraftId(null);
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

  async function handleCreateEvent() {
    const account = selectedAccount();
    if (!account) return;

    if (!newEventSummary()) {
      setNewEventError("Title is required");
      return;
    }

    setNewEventSaving(true);
    setNewEventError(null);

    try {
      let start: number, end: number;
      if (newEventAllDay()) {
        const sParts = newEventStartDate().split('-');
        start = Date.UTC(parseInt(sParts[0]), parseInt(sParts[1]) - 1, parseInt(sParts[2]), 12, 0, 0);

        const eParts = newEventEndDate().split('-');
        end = Date.UTC(parseInt(eParts[0]), parseInt(eParts[1]) - 1, parseInt(eParts[2]), 12, 0, 0);
      } else {
        const s = new Date(`${newEventStartDate()}T${newEventStartTime()}`);
        start = s.getTime();
        const e = new Date(`${newEventEndDate()}T${newEventEndTime()}`);
        end = e.getTime();
      }

      const attendeesList = newEventAttendees()
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      await createCalendarEvent(
        account.id,
        null,
        newEventSummary(),
        newEventDescription() || null,
        newEventLocation() || null,
        start,
        end,
        newEventAllDay(),
        attendeesList.length > 0 ? attendeesList : null,
        newEventRecurrence() ? [newEventRecurrence()!] : null
      );

      setCreatingEvent(false);
      setNewEventSummary("");
      setNewEventDescription("");
      setNewEventLocation("");
      setNewEventLocation("");
      setNewEventAttendees("");
      setNewEventRecurrence(null);

      // Refresh calendar cards
      cards().forEach(card => {
        if (isCalendarCard(card.id)) {
          fetchAndCacheCalendarEvents(account.id, card.id, card.query);
        }
      });

      showToast("Event created successfully");

    } catch (e) {
      console.error(e);
      setNewEventError("Failed to create event: " + String(e));
    } finally {
      setNewEventSaving(false);
    }
  }

  function handleSendEmail() {
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

    // Queue the send with undo capability
    const pending: PendingSend = {
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      attachments: [...composeAttachments()],
      reply: replyingToThread() ? { ...replyingToThread()! } : undefined,
      timeoutId: 0,
    };

    // Clear draft and close compose immediately
    clearDraft();
    closeCompose();

    // Start the countdown
    setSendProgress(0);
    setSendToastClosing(false);
    setSendToastVisible(true);

    // Progress animation
    const progressInterval = setInterval(() => {
      setSendProgress(p => Math.min(p + 2, 100));
    }, SEND_DELAY_MS / 50);

    // Schedule actual send
    const timeoutId = window.setTimeout(async () => {
      clearInterval(progressInterval);
      await executeActualSend(pending);
    }, SEND_DELAY_MS);

    pending.timeoutId = timeoutId;
    setPendingSend(pending);
  }

  async function executeActualSend(pending: PendingSend) {
    const account = selectedAccount();
    if (!account) {
      hideSendToast();
      return;
    }

    try {
      if (pending.reply) {
        await replyToThread(
          account.id,
          pending.reply.threadId,
          pending.to,
          pending.cc,
          pending.bcc,
          pending.subject,
          pending.body,
          pending.reply.messageId,
          pending.attachments
        );
      } else {
        await sendEmail(account.id, pending.to, pending.cc, pending.bcc, pending.subject, pending.body, pending.attachments);
      }
      hideSendToast();
    } catch (e) {
      console.error("Failed to send email:", e);
      setError(`Failed to send email: ${e}`);
      hideSendToast();
    }
  }

  function undoSend() {
    const pending = pendingSend();
    if (!pending) return;

    // Cancel the scheduled send
    clearTimeout(pending.timeoutId);

    // Restore compose with the pending email data
    setComposeTo(pending.to);
    setComposeCc(pending.cc);
    setComposeBcc(pending.bcc);
    setComposeSubject(pending.subject);
    setComposeBody(pending.body);
    setComposeAttachments(pending.attachments);
    if (pending.reply) {
      setReplyingToThread(pending.reply);
    }
    if (pending.cc || pending.bcc) {
      setShowCcBcc(true);
    }
    setComposing(true);

    // Clear pending state and hide toast
    setPendingSend(null);
    hideSendToast();
  }

  function hideSendToast() {
    setSendToastClosing(true);
    setTimeout(() => {
      setSendToastVisible(false);
      setSendToastClosing(false);
      setPendingSend(null);
      setSendProgress(0);
    }, 200);
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

  async function handleEventQuickReply(event: GoogleCalendarEvent) {
    const account = selectedAccount();
    const text = quickReplyText();
    if (!account || !event.organizer || !text.trim()) return;

    const subject = `Re: ${event.title}`;

    setQuickReplySending(true);
    try {
      await sendEmail(account.id, event.organizer, "", "", subject, text);
      setQuickReplyEventId(null);
      setQuickReplyText("");
      showToast("Reply sent");
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

    // Set up inline reply below the message
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
    const threadId = activeThreadId();
    // Set up inline forward below the message
    setForwardingThread({ threadId: threadId || '', subject, body });
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

  // Calendar drawer functions (for events)
  async function fetchAvailableCalendars() {
    const account = selectedAccount();
    if (!account) return;

    // Clear cache if account changed
    if (lastAccountId !== account.id) {
      setAvailableCalendars([]);
      lastAccountId = account.id;
    }

    if (availableCalendars().length > 0) return; // Already cached

    setCalendarsLoading(true);
    try {
      const calendars = await listCalendars(account.id);
      // Sort: primary first, then alphabetically
      const sorted = calendars.sort((a, b) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return a.name.localeCompare(b.name);
      });
      setAvailableCalendars(sorted);
    } catch (e) {
      console.error("Failed to fetch calendars:", e);
      showToast("Failed to load calendars");
    } finally {
      setCalendarsLoading(false);
    }
  }

  async function handleMoveEventToCalendar(destinationCalendarId: string) {
    const event = activeEvent();
    const account = selectedAccount();
    if (!event || !account || event.calendar_id === destinationCalendarId) return;

    try {
      const movedEvent = await moveCalendarEvent(
        account.id,
        event.calendar_id,
        event.id,
        destinationCalendarId
      );

      // Update the active event with new calendar info
      setActiveEvent(movedEvent);

      // Find the destination calendar name
      const destCal = availableCalendars().find(c => c.id === destinationCalendarId);
      showToast(`Moved to ${destCal?.name || 'calendar'}`);
      setCalendarDrawerOpen(false);
    } catch (e) {
      console.error("Failed to move event:", e);
      showToast(`Failed to move event: ${e}`);
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

  function isThreadInInbox(): boolean {
    return getCurrentThreadLabels().includes('INBOX');
  }

  function getThreadUserLabelCount(): number {
    const labels = getCurrentThreadLabels();
    // System labels are uppercase (INBOX, SENT, STARRED, etc.) or start with CATEGORY_
    const systemLabels = ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD', 'IMPORTANT', 'CHAT', 'FORUMS', 'UPDATES', 'PROMOTIONS', 'SOCIAL', 'PERSONAL'];
    return labels.filter(l => !systemLabels.includes(l) && !l.startsWith('CATEGORY_')).length;
  }

  async function handleThreadViewAction(action: string) {
    const thread = activeThread();
    const account = selectedAccount();
    const cardId = activeThreadCardId();
    if (!thread || !account) return;

    // Close thread view after action (except for read/unread/important)
    const shouldClose = ['archive', 'inbox', 'trash', 'spam'].includes(action);

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

  function saveCollapsedState(collapsed: Record<string, boolean>) {
    setCollapsedCards(collapsed);
    safeSetJSON("collapsedCards", collapsed);
  }

  function startEditCard(card: Card, e: MouseEvent) {
    e.stopPropagation();
    // Close add card form if open
    if (addingCard()) {
      setAddingCard(false);
    }
    // Clear any existing preview
    setQueryPreviewThreads([]);
    setQueryPreviewCalendarEvents([]);
    setQueryPreviewLoading(false);
    setEditingCardId(card.id);
    setEditCardName(card.name);
    setEditCardQuery(card.query);
    setEditCardColor((card.color as CardColor) || null);
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
        color: editCardColor() || null,
      };
      await updateCard(updatedCard);
      setCards(cards().map(c => c.id === cardId ? updatedCard : c));
      setEditingCardId(null);

      // If query changed, clear cache and refresh
      if (queryChanged) {
        await clearCardCache(cardId);
        setCardThreads(prev => {
          const updated = { ...prev };
          delete updated[cardId];
          return updated;
        });
        setCardPageTokens(prev => {
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
      // Clean up collapsed state
      const newCollapsed = { ...collapsedCards() };
      const { [cardId]: _, ...remainingCollapsed } = newCollapsed;
      saveCollapsedState(remainingCollapsed);
    } catch (err) {
      console.error("Failed to delete card:", err);
      alert(`Failed to delete card: ${err}`);
    }
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

  function isCalendarCard(cardId: string): boolean {
    const card = cards().find(c => c.id === cardId);
    return card?.card_type === "calendar";
  }

  async function loadCardThreads(cardId: string, append = false, forceRefresh = false) {
    const account = selectedAccount();
    if (!account) return;

    // Check if this is a calendar card
    const card = cards().find(c => c.id === cardId);
    if (card?.card_type === "calendar") {
      await loadCalendarEvents(cardId, forceRefresh);
      return;
    }

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

  // Load calendar events for calendar cards
  async function loadCalendarEvents(cardId: string, forceRefresh = false) {
    const account = selectedAccount();
    if (!account) return;

    const card = cards().find(c => c.id === cardId);
    if (!card) return;

    // Prevent concurrent loads (unless force refresh)
    if (!forceRefresh && loadingThreads()[cardId]) return;

    setLoadingThreads({ ...loadingThreads(), [cardId]: true });
    setCardErrors({ ...cardErrors(), [cardId]: null });

    try {
      // For initial load (not force refresh), try cache first
      if (!forceRefresh) {
        const cached = await getCachedCardEvents(cardId);
        if (cached && cached.events.length > 0) {
          // Show cached data immediately
          setCardCalendarEvents({ ...cardCalendarEvents(), [cardId]: cached.events });
          // cached_at is in seconds
          setLastSyncTimes({ ...lastSyncTimes(), [cardId]: cached.cached_at * 1000 });
          setLoadingThreads({ ...loadingThreads(), [cardId]: false });

          // Fetch fresh data in background
          fetchAndCacheCalendarEvents(account.id, cardId, card.query);
          return;
        }
      }

      // No cache or forced refresh - fetch and wait
      await fetchAndCacheCalendarEvents(account.id, cardId, card.query);
    } catch (e) {
      const errorMsg = String(e);
      if (errorMsg.includes("Keyring error") || errorMsg.includes("No auth token")) {
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
      if (!cardCalendarEvents()[cardId]) {
        // Only turn off loading if we didn't populate from cache (if we did, it's already off)
        // or if we waited for fetch.
        // Actually, if we populated from cache, we returned early.
        // If we didn't, we are here.
        setLoadingThreads({ ...loadingThreads(), [cardId]: false });
      } else {
        // If we have data (from await fetch), ensure loading is off
        setLoadingThreads({ ...loadingThreads(), [cardId]: false });
      }
    }
  }

  async function fetchAndCacheCalendarEvents(accountId: string, cardId: string, query: string) {
    try {
      const events = await fetchCalendarEvents(accountId, query);
      setCardCalendarEvents({ ...cardCalendarEvents(), [cardId]: events });
      await saveCachedCardEvents(cardId, events);
      setLastSyncTimes({ ...lastSyncTimes(), [cardId]: Date.now() });
      setSyncErrors({ ...syncErrors(), [cardId]: null });
    } catch (e) {
      console.error("Failed to fetch calendar events:", e);
      setSyncErrors({ ...syncErrors(), [cardId]: String(e) });
      // If foreground load failed, rethrow to be caught by loadCalendarEvents
      if (loadingThreads()[cardId]) {
        throw e;
      }
    }
  }

  // Background fetch and cache update (no loading state shown)
  async function fetchAndCacheThreads(accountId: string, cardId: string) {
    // Skip for calendar cards (they don't use thread caching)
    if (isCalendarCard(cardId)) return;

    try {
      const result = await fetchThreadsPaginated(accountId, cardId, null);
      // Skip update if a recent action happened (prevents overwriting optimistic updates)
      const recent = lastAction();
      if (recent && Date.now() - recent.timestamp < 3000) {
        // Just update cache, don't touch UI state
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
        return;
      }
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
    const card = cards().find(c => c.id === cardId);
    return (card?.group_by as GroupBy) || "date";
  }

  async function setGroupByForCard(cardId: string, groupBy: GroupBy) {
    const card = cards().find(c => c.id === cardId);
    if (!card) return;
    const updatedCard = { ...card, group_by: groupBy };
    await updateCard(updatedCard);
    setCards(cards().map(c => c.id === cardId ? updatedCard : c));
  }

  function updateCardWidth(width: number, persist = true) {
    setCardWidth(width);
    document.documentElement.style.setProperty("--card-width", `${width}px`);
    if (persist) {
      safeSetItem("cardWidth", String(width));
    }
  }

  // Generic action settings helpers
  function createActionSettingsHandlers(
    getSettings: () => Record<string, boolean>,
    setSettings: (s: Record<string, boolean>) => void,
    getOrder: () => string[],
    setOrder: (o: string[]) => void,
    storageKeySettings: string,
    storageKeyOrder: string
  ) {
    return {
      toggle: (key: string) => {
        const newSettings = { ...getSettings(), [key]: !getSettings()[key] };
        setSettings(newSettings);
        safeSetJSON(storageKeySettings, newSettings);
      },
      move: (fromIndex: number, toIndex: number) => {
        const order = [...getOrder()];
        const [item] = order.splice(fromIndex, 1);
        order.splice(toIndex, 0, item);
        setOrder(order);
        safeSetJSON(storageKeyOrder, order);
      }
    };
  }

  const threadActionHandlers = createActionSettingsHandlers(
    actionSettings, setActionSettings, actionOrder, setActionOrder,
    "actionSettings", "actionOrder"
  );
  const eventActionHandlers = createActionSettingsHandlers(
    eventActionSettings, setEventActionSettings, eventActionOrder, setEventActionOrder,
    "eventActionSettings", "eventActionOrder"
  );

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
    const deck = document.querySelector(".deck") as HTMLElement;
    if (!deck) return;

    if (colorIndex === null) {
      deck.style.background = "";
      delete deck.dataset.bgLight;
      delete deck.dataset.bgDark;
      document.documentElement.style.setProperty("--accent", "#4285f4");
      document.documentElement.style.removeProperty("--app-bg");
    } else {
      const color = BG_COLORS[colorIndex];
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const bgColor = isDark ? color.dark : color.light;
      deck.style.background = bgColor;
      deck.dataset.bgLight = color.light;
      deck.dataset.bgDark = color.dark;
      document.documentElement.style.setProperty("--accent", color.hex);
      document.documentElement.style.setProperty("--app-bg", bgColor);
    }
  }

  type CalendarEventGroup = { label: string; events: GoogleCalendarEvent[] };

  function getSmartEventTime(event: GoogleCalendarEvent): string {
    const now = Date.now();
    const endTime = event.end_time || (event.start_time + 3600000);

    // Currently happening
    if (now >= event.start_time && now < endTime) {
      return "Now";
    }

    // In the future
    const startsIn = event.start_time - now;
    if (startsIn > 0) {
      const minutes = Math.floor(startsIn / 60000);
      if (minutes < 1) return "Starting";
      if (minutes < 60) return `in ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `in ${hours}h`;
    }

    // Fall back to regular time format
    return formatCalendarEventDate(event.start_time, event.end_time, event.all_day);
  }

  function groupCalendarEvents(events: GoogleCalendarEvent[], groupBy: GroupBy): CalendarEventGroup[] {
    if (groupBy === "date") {
      const groups: Record<string, GoogleCalendarEvent[]> = {};

      // Setup date boundaries
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      for (const event of events) {
        let date: Date;
        if (event.all_day) {
          const d = new Date(event.start_time);
          date = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        } else {
          date = new Date(event.start_time);
        }
        const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        // Check if event is currently happening (Ongoing)
        // If an event spans multiple days and started in the past but is active now, 
        // we might want to show it in "Today" or a special "Ongoing" section.
        // For now, we stick to start date but handle "Yesterday" explicitly.

        let label: string;
        const timeDiff = eventDay.getTime() - today.getTime();

        if (timeDiff === 0) {
          label = "Today";
        } else if (timeDiff === 86400000) { // +1 day
          label = "Tomorrow";
        } else if (timeDiff === -86400000) { // -1 day
          label = "Yesterday";
        } else {
          label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
        }

        if (!groups[label]) groups[label] = [];
        groups[label].push(event);
      }

      // Sort groups logically: Yesterday -> Today -> Tomorrow -> Dates
      // But map returns array.
      // We want chronological order of keys?
      // Object.entries order is not guaranteed chronologically for arbitrary strings.
      // We should sort by date of the first event in the group.

      return Object.entries(groups)
        .map(([label, events]) => ({ label, events }))
        .sort((a, b) => {
          // Special handling for key labels
          const score = (lbl: string) => {
            if (lbl === "Yesterday") return 1;
            if (lbl === "Today") return 2;
            if (lbl === "Tomorrow") return 3;
            return 4; // Dates
          };

          const scoreA = score(a.label);
          const scoreB = score(b.label);

          if (scoreA !== scoreB) {
            return scoreA - scoreB;
          }

          // Sort by start time of first event
          const startA = a.events[0]?.start_time || 0;
          const startB = b.events[0]?.start_time || 0;
          return startA - startB;
        });
    }

    if (groupBy === "organizer") {
      const groups: Record<string, GoogleCalendarEvent[]> = {};
      for (const event of events) {
        const organizer = event.organizer || "Unknown";
        if (!groups[organizer]) groups[organizer] = [];
        groups[organizer].push(event);
      }
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, events]) => ({
          label,
          events: events.sort((a, b) => a.start_time - b.start_time),
        }));
    }

    if (groupBy === "calendar") {
      const groups: Record<string, GoogleCalendarEvent[]> = {};
      for (const event of events) {
        const label = event.calendar_name || event.calendar_id;
        if (!groups[label]) groups[label] = [];
        groups[label].push(event);
      }
      return Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, events]) => ({
          label,
          events: events.sort((a, b) => a.start_time - b.start_time),
        }));
    }

    // Default: single group with all events
    return [{ label: "Events", events }];
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

  function getCalendarEventGroups(cardId: string): CalendarEventGroup[] {
    const events = cardCalendarEvents()[cardId];
    if (!events) return [];
    const groupBy = getGroupByForCard(cardId);
    let groups = groupCalendarEvents(events, groupBy);

    // Apply global filter
    const filter = globalFilter().toLowerCase().trim();
    if (filter) {
      groups = groups.map(group => ({
        ...group,
        events: group.events.filter(event =>
          event.title.toLowerCase().includes(filter) ||
          (event.description?.toLowerCase().includes(filter)) ||
          (event.location?.toLowerCase().includes(filter)) ||
          (event.organizer?.toLowerCase().includes(filter))
        )
      })).filter(group => group.events.length > 0);
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
    attachmentId: string | undefined,
    filename: string,
    mimeType: string,
    inlineData?: string | null
  ) {
    const account = selectedAccount();
    if (!account) return;

    showToast(`Opening ${filename}...`);
    try {
      await openAttachmentApi(
        account.id,
        messageId,
        attachmentId || null,
        filename,
        mimeType,
        inlineData || null
      );
    } catch (e) {
      console.error('Failed to open attachment:', e);
      setError(`Failed to open attachment: ${e}`);
    }
  }

  async function downloadAttachment(
    messageId: string,
    attachmentId: string | undefined,
    filename: string,
    mimeType: string,
    inlineData?: string | null
  ) {
    const account = selectedAccount();
    if (!account) return;

    showToast(`Downloading ${filename}...`);
    try {
      // For download, we save to Downloads folder instead of temp
      await openAttachmentApi(
        account.id,
        messageId,
        attachmentId || null,
        filename,
        mimeType,
        inlineData || null
      );
    } catch (e) {
      console.error('Failed to download attachment:', e);
      setError(`Failed to download attachment: ${e}`);
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

  // Contact candidate for autocomplete
  interface RecentContact {
    email: string;
    name?: string;
    lastContacted: number;
    frequency: number;
    fromGoogle?: boolean;
  }

  // Get all unique participants from loaded threads and Google contacts
  function getContactCandidates(): RecentContact[] {
    const threads = cardThreads();
    const account = selectedAccount();
    const myEmail = account?.email?.toLowerCase();
    const contactMap = new Map<string, { email: string; name?: string; lastSeen: number; count: number; fromGoogle: boolean }>();

    // First, add Google contacts (they have verified names)
    for (const contact of googleContacts()) {
      for (const email of contact.email_addresses) {
        const emailLower = email.toLowerCase();
        if (emailLower === myEmail) continue;

        if (!contactMap.has(emailLower)) {
          contactMap.set(emailLower, {
            email,
            name: contact.display_name || undefined,
            lastSeen: 0, // No recency info from contacts
            count: 0, // No frequency info from contacts
            fromGoogle: true,
          });
        }
      }
    }

    // Then add thread-derived contacts (with recency/frequency)
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
              // Prefer Google contact name, but use thread name if Google doesn't have one
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
                fromGoogle: false,
              });
            }
          });
        });
      });
    });

    // Convert to array and sort by combined score
    const candidates = Array.from(contactMap.values())
      .map(c => ({
        email: c.email,
        name: c.name,
        lastContacted: c.lastSeen,
        frequency: c.count,
        fromGoogle: c.fromGoogle,
      }))
      .sort((a, b) => {
        // Score: higher frequency = better, more recent = better
        // Google contacts without thread history get a small boost
        const now = Date.now();
        const recencyScoreA = a.lastContacted ? 1 / (1 + (now - a.lastContacted) / (1000 * 60 * 60 * 24)) : 0;
        const recencyScoreB = b.lastContacted ? 1 / (1 + (now - b.lastContacted) / (1000 * 60 * 60 * 24)) : 0;
        const googleBoostA = a.fromGoogle && a.frequency === 0 ? 0.1 : 0;
        const googleBoostB = b.fromGoogle && b.frequency === 0 ? 0.1 : 0;
        const scoreA = a.frequency * 0.4 + recencyScoreA * 100 * 0.6 + googleBoostA;
        const scoreB = b.frequency * 0.4 + recencyScoreB * 100 * 0.6 + googleBoostB;
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

    // Check if thread is unread and mark as read
    const groups = cardThreads()[cardId] || [];
    for (const group of groups) {
      const thread = group.threads.find(t => t.gmail_thread_id === threadId);
      if (thread && thread.unread_count > 0) {
        // Mark as read in background (don't await)
        handleThreadAction('read', [threadId], cardId);
        break;
      }
    }

    try {
      const details = await getThreadDetails(account.id, threadId);
      setActiveThread(details);
      // Focus the most recent (last) message
      setFocusedMessageIndex(details.messages.length - 1);
    } catch (e) {
      console.error("Failed to load thread details", e);
      setThreadError("Failed to load email. Please try again.");
    } finally {
      setThreadLoading(false);
    }
  }

  function openEvent(event: GoogleCalendarEvent, cardId: string) {
    setActiveEvent(event);
    setActiveEventCardId(cardId);
  }

  function closeEvent() {
    const wasComposing = replyingToEvent() || forwardingEvent();
    setActiveEvent(null);
    setActiveEventCardId(null);
    setReplyingToEvent(null);
    setForwardingEvent(null);
    setCalendarDrawerOpen(false);
    if (wasComposing) {
      closeCompose();
    }
  }

  function showToast(message?: string) {
    clearTimeout(toastTimeoutId);
    setSimpleToastMessage(message || null);
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
      case 'inbox': return `Moved ${count} thread${plural} to inbox`;
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
      case 'inbox':
        addLabels.push("INBOX");
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

    // Update cache with optimistic changes
    for (const [cId, groups] of Object.entries(updatedCardThreads)) {
      if (groups) {
        saveCachedCardThreads(cId, groups, cardPageTokens()[cId] || null);
      }
    }

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
    threadId?: string | null;
    thread?: Thread | null;
    event?: GoogleCalendarEvent | null;
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

    // Event actions (when event prop is provided)
    if (props.event) {
      const evt = props.event;
      const cId = props.cardId;
      const evtSelectedCount = selectedEvents()[cId]?.size || 0;
      const evtSettings = eventActionSettings();
      const evtOrder = eventActionOrder();

      // Event action definitions
      const eventActionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; available: boolean }> = {
        quickReply: {
          cls: 'bulk-reply',
          title: 'Reply to organizer',
          keyHint: 'r',
          icon: ReplyIcon,
          onClick: (e) => { e.stopPropagation(); setQuickReplyEventId(evt.id); },
          available: !!evt.organizer
        },
        joinMeeting: {
          cls: 'event-join',
          title: 'Join meeting',
          keyHint: 'j',
          icon: VideoIcon,
          onClick: (e) => { e.stopPropagation(); evt.hangout_link && openUrl(evt.hangout_link); },
          available: !!evt.hangout_link
        },
        openCalendar: {
          cls: 'event-open',
          title: 'Open in Calendar',
          keyHint: 'o',
          icon: CalendarIcon,
          onClick: (e) => { e.stopPropagation(); evt.html_link && openUrl(evt.html_link); },
          available: !!evt.html_link
        },
        rsvpYes: {
          cls: evt.response_status === 'accepted' ? 'event-rsvp-active' : 'event-rsvp',
          title: 'RSVP Yes',
          keyHint: 'y',
          icon: CheckIcon,
          onClick: async (e) => {
            e.stopPropagation();
            const account = selectedAccount();
            if (!account) return;
            try {
              await rsvpCalendarEvent(account.id, evt.id, 'accepted');
              showToast('RSVP: Yes');
              props.onClose();
            } catch (err) {
              showToast('Failed to RSVP');
            }
          },
          available: true
        },
        rsvpNo: {
          cls: evt.response_status === 'declined' ? 'event-rsvp-active' : 'event-rsvp',
          title: 'RSVP No',
          keyHint: 'n',
          icon: ThumbsDownIcon,
          onClick: async (e) => {
            e.stopPropagation();
            const account = selectedAccount();
            if (!account) return;
            try {
              await rsvpCalendarEvent(account.id, evt.id, 'declined');
              showToast('RSVP: No');
              props.onClose();
            } catch (err) {
              showToast('Failed to RSVP');
            }
          },
          available: true
        },
        delete: {
          cls: 'bulk-danger',
          title: 'Delete',
          keyHint: 'd',
          icon: TrashIcon,
          onClick: async (e) => {
            e.stopPropagation();
            // Decline and remove from view
            const account = selectedAccount();
            if (!account) return;
            try {
              await rsvpCalendarEvent(account.id, evt.id, 'declined');
              showToast('Event declined');
              props.onClose();
            } catch (err) {
              showToast('Failed to decline event');
            }
          },
          available: true
        }
      };

      // Add actions in order, respecting settings
      for (const key of evtOrder) {
        const def = eventActionDefs[key];
        if (!def || !def.available) continue;
        // Check if enabled (quickReply defaults to true)
        if (key === 'quickReply') {
          if (evtSettings[key] === false) continue;
        } else {
          if (!evtSettings[key]) continue;
        }
        actions.push({ cls: def.cls, title: def.title, keyHint: def.keyHint, icon: def.icon, onClick: def.onClick });
      }

      // Clear selection (if events are selected)
      if (evtSelectedCount > 0) {
        actions.push({
          cls: 'bulk-clear',
          title: 'Clear',
          keyHint: 'ESC',
          icon: ClearIcon,
          onClick: (e) => { e.stopPropagation(); setSelectedEvents({ ...selectedEvents(), [cId]: new Set() }); }
        });
      }
    }

    // Thread actions (when thread prop is provided)
    if (props.thread && props.threadId) {
      // Get thread state for icon selection
      const isStarred = props.thread.labels?.includes("STARRED") ?? false;
      const isImportant = props.thread.labels?.includes("IMPORTANT") ?? false;
      const isRead = (props.thread.unread_count ?? 0) === 0;
      const isInInbox = props.thread.labels?.includes("INBOX") ?? true;

      const order = actionOrder();

      // Action definitions - use order from settings
      const actionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; bulkTitle?: string; bulkIcon?: () => JSX.Element; bulkOnClick?: (e: MouseEvent) => void }> = {};
      const cId = props.cardId;
      const tId = props.threadId;
      const getSelection = () => Array.from(selectedThreads()[cId] || []);

      actionDefs.quickReply = {
        cls: 'bulk-reply', title: 'Reply', keyHint: 'r', icon: ReplyIcon,
        onClick: (e) => { e.stopPropagation(); setQuickReplyThreadId(tId); setQuickReplyCardId(cId); },
        bulkTitle: 'Batch Reply', bulkOnClick: (e) => { e.stopPropagation(); startBatchReply(cId, getSelection()); props.onClose(); }
      };
      actionDefs.quickForward = {
        cls: 'bulk-forward', title: 'Forward', keyHint: 'f', icon: ForwardIcon,
        onClick: (e) => { e.stopPropagation(); handleForward(tId, cId); }
      };
      actionDefs.archive = {
        cls: 'bulk-archive', title: isInInbox ? 'Archive' : 'Move to Inbox', keyHint: 'a', icon: isInInbox ? ArchiveIcon : InboxIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction(isInInbox ? 'archive' : 'inbox', [tId], cId); },
        bulkTitle: 'Archive', bulkIcon: ArchiveIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('archive', getSelection(), cId); }
      };
      actionDefs.star = {
        cls: 'bulk-star', title: isStarred ? 'Unstar' : 'Star', keyHint: 's', icon: isStarred ? StarFilledIcon : StarIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction(isStarred ? 'unstar' : 'star', [tId], cId); },
        bulkTitle: 'Star', bulkIcon: StarIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('star', getSelection(), cId); }
      };
      actionDefs.markRead = {
        cls: 'bulk-read', title: isRead ? 'Mark unread' : 'Mark read', keyHint: 'u', icon: isRead ? EyeClosedIcon : EyeOpenIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction(isRead ? 'unread' : 'read', [tId], cId); },
        bulkTitle: 'Mark read', bulkIcon: EyeOpenIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('read', getSelection(), cId); }
      };
      actionDefs.markImportant = {
        cls: 'bulk-important', title: isImportant ? 'Unmark important' : 'Mark important', keyHint: 'i', icon: isImportant ? ThumbsUpFilledIcon : ThumbsUpIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction(isImportant ? 'notImportant' : 'important', [tId], cId); },
        bulkTitle: 'Mark important', bulkIcon: ThumbsUpIcon, bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('important', getSelection(), cId); }
      };
      actionDefs.spam = {
        cls: 'bulk-spam', title: 'Report spam', keyHint: 'x', icon: SpamIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction('spam', [tId], cId); },
        bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('spam', getSelection(), cId); }
      };
      actionDefs.trash = {
        cls: 'bulk-danger', title: 'Delete', keyHint: 'd', icon: TrashIcon,
        onClick: (e) => { e.stopPropagation(); handleThreadAction('trash', [tId], cId); },
        bulkOnClick: (e) => { e.stopPropagation(); handleThreadAction('trash', getSelection(), cId); }
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
      } else {
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
    // Show actions on the selected thread
    setHoveredThread(threadId);
    setActionsWheelOpen(true);

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

    // Toggle selection
    if (isSelected) {
      currentMap.delete(threadId);
    } else {
      currentMap.add(threadId);
      setLastSelectedThread({ ...lastSelectedThread(), [cardId]: threadId });
    }

    setSelectedThreads({ ...selectedThreads(), [cardId]: currentMap });
  }

  function toggleEventSelection(cardId: string, eventId: string, e?: MouseEvent) {
    // Show actions on the selected event
    setHoveredEvent(eventId);
    setEventActionsWheelOpen(true);

    const currentMap = new Set(selectedEvents()[cardId] || []);
    const isSelected = currentMap.has(eventId);

    // Shift+Click Logic for range selection
    if (e?.shiftKey && lastSelectedEvent()[cardId]) {
      const lastId = lastSelectedEvent()[cardId]!;
      const eventGroups = getCalendarEventGroups(cardId);
      const allEvents = eventGroups.flatMap(g => g.events);

      const currentIndex = allEvents.findIndex(ev => ev.id === eventId);
      const lastIndex = allEvents.findIndex(ev => ev.id === lastId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);

        // Add all events in range to selection
        const eventsInRange = allEvents.slice(start, end + 1);
        eventsInRange.forEach(ev => currentMap.add(ev.id));

        setSelectedEvents({ ...selectedEvents(), [cardId]: currentMap });
        return;
      }
    }

    // Toggle selection
    if (isSelected) {
      currentMap.delete(eventId);
    } else {
      currentMap.add(eventId);
      setLastSelectedEvent({ ...lastSelectedEvent(), [cardId]: eventId });
    }

    setSelectedEvents({ ...selectedEvents(), [cardId]: currentMap });
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
          <div class="name-color-row">
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
              placeholder="Inbox, Starred..."
              autofocus={props.mode === 'edit'}
              ref={props.mode === 'new' ? (el) => setTimeout(() => el?.focus(), 50) : undefined}
            />
            <div class={`color-picker ${props.colorPickerOpen ? 'open' : ''}`}>
              <div
                class={`color-picker-selected ${props.color === null ? 'no-color' : ''}`}
                style={props.color ? { background: COLOR_HEX[props.color] } : {}}
                onClick={(e) => { e.stopPropagation(); props.setColorPickerOpen(!props.colorPickerOpen); }}
                title="Card color"
              >
                <Show when={props.color === null}>
                  <PaletteIcon />
                </Show>
              </div>
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
        </div>
        <div class="card-form-group">
          <label class="query-label">
            Query
            <button
              type="button"
              class="query-help-btn"
              onClick={() => setQueryHelpOpen(true)}
              title="Query operators help"
            >
              ?
            </button>
          </label>
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
            placeholder="is:inbox, from:boss, newer_than:7d"
          />
        </div>
        <div class="card-form-group">
          <label>Group</label>
          <div class="group-by-buttons">
            <For each={props.query.toLowerCase().includes("calendar:") ? CALENDAR_GROUP_BY_OPTIONS : EMAIL_GROUP_BY_OPTIONS}>
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
      <div class="drag-region" onMouseDown={() => getCurrentWindow().startDragging()}></div>

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
          <div class="sidebar-content">
            <Show when={!composing()}>
            <div
              class="compose-toolbar"
              onMouseLeave={() => {
                fabHoverTimeout = window.setTimeout(() => setComposeFabHovered(false), 250);
              }}
            >
              <div
                class="compose-btn-wrapper"
                onMouseEnter={() => {
                  clearTimeout(fabHoverTimeout);
                  setComposeFabHovered(true);
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
              <button
                class="new-event-btn"
                onClick={() => { resetEventFormToNow(); setCreatingEvent(true); }}
                title="New event (E)"
                aria-label="Create new calendar event"
              >
                <CalendarIcon />
              </button>
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
              >
                <Show when={selectedBgColorIndex() === null}>
                  <PaletteIcon />
                </Show>
              </div>
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
                      onClick={() => { setAccountChooserOpen(false); handleAddAccount(); }}
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

      {/* Deck */}
      <Show when={!loading() && selectedAccount()}>
        <DragDropProvider onDragStart={onDragStart} onDragEnd={onDragEnd as any} collisionDetector={mostIntersecting}>
          <DragDropSensors />
          <div class={`deck ${resizing() ? 'resizing' : ''}`}>
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
                        data-color={editingCardId() === card.id ? (editCardColor() || undefined) : (card.color || undefined)}
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
                            <Show when={lastSyncTimes()[card.id] && !loadingThreads()[card.id]}>
                              {(() => {
                                const state = getSyncState(lastSyncTimes()[card.id], currentTime());
                                const hasError = syncErrors()[card.id];
                                return (
                                  <span
                                    class={`sync-status ${hasError ? 'sync-error' : ''} ${state === 'fresh' ? 'sync-fresh' : ''} ${state === 'stale' ? 'sync-stale' : ''}`}
                                    title={hasError ? `Sync failed: ${hasError}` : `Last synced: ${formatSyncTime(lastSyncTimes()[card.id], currentTime())}`}
                                  >
                                    {hasError ? 'sync failed' : formatSyncTime(lastSyncTimes()[card.id], currentTime())}
                                  </span>
                                );
                              })()}
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
                            {/* Calendar events preview */}
                            <Show when={!queryPreviewLoading() && editCardQuery().toLowerCase().includes("calendar:")}>
                              <Show when={queryPreviewCalendarEvents().length === 0}>
                                <div class="empty">No events</div>
                              </Show>
                              <For each={queryPreviewCalendarEvents()}>
                                {(event) => (
                                  <div class={`calendar-event-item ${event.response_status === "declined" ? "declined" : ""}`}>
                                    <div class="calendar-event-row">
                                      <span class="calendar-event-title">{event.title}</span>
                                      <span class="calendar-event-time-compact">
                                        {getSmartEventTime(event)}
                                      </span>
                                    </div>
                                    <Show when={event.description}>
                                      <div class="calendar-event-description">{event.description}</div>
                                    </Show>
                                    <Show when={event.location}>
                                      <div class="calendar-event-location-compact">
                                        <LocationIcon />
                                        <span>{event.location}</span>
                                      </div>
                                    </Show>
                                    <Show when={event.response_status}>
                                      <div class={`calendar-event-response ${event.response_status}`}>
                                        {event.response_status === "accepted" ? "Going" :
                                          event.response_status === "tentative" ? "Maybe" :
                                            event.response_status === "declined" ? "Declined" :
                                              event.response_status === "needsAction" ? "Pending" : event.response_status}
                                      </div>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </Show>
                            {/* Email threads preview */}
                            <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && editCardQuery().trim() && !editCardQuery().toLowerCase().includes("calendar:")}>
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
                                            <Show when={thread.calendar_event}>
                                              <span class="thread-indicator" title="Calendar invite">
                                                <CalendarIcon />
                                              </span>
                                            </Show>
                                            <Show when={thread.has_attachment && !thread.calendar_event}>
                                              <span class="thread-indicator" title="Has attachment">
                                                <AttachmentIcon />
                                              </span>
                                            </Show>
                                            <span class="thread-time">{formatTime(thread.last_message_date)}</span>
                                          </div>
                                          <div class="thread-snippet">{thread.snippet}</div>
                                          {/* Attachment previews */}
                                          <Show when={thread.attachments?.length > 0 && !thread.calendar_event}>
                                            <div class="thread-attachments">
                                              <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 3)}>
                                                {(attachment) => (
                                                  <img
                                                    class="thread-image-thumb clickable"
                                                    src={`data:${attachment.mime_type};base64,${attachment.inline_data?.replace(/-/g, '+').replace(/_/g, '/')}`}
                                                    alt={attachment.filename}
                                                    title={attachment.filename}
                                                    onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                  />
                                                )}
                                              </For>
                                              <For each={thread.attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")).slice(0, 2)}>
                                                {(attachment) => (
                                                  <div
                                                    class="thread-file-item clickable"
                                                    title={`${attachment.filename} (${formatFileSize(attachment.size)})`}
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
                            <Show when={loadingThreads()[card.id] && !cardThreads()[card.id] && !cardCalendarEvents()[card.id]}>
                              <div class="loading">Loading...</div>
                            </Show>
                            <Show when={!loadingThreads()[card.id] && cardErrors()[card.id] && !cardThreads()[card.id] && !cardCalendarEvents()[card.id]}>
                              <div class="card-error">
                                <span class="error-icon">⚠</span>
                                <span class="error-text">{cardErrors()[card.id]}</span>
                                <button class="retry-btn" onClick={(e) => refreshCard(card.id, e)}>Try again</button>
                              </div>
                            </Show>

                            {/* Calendar card: show calendar events */}
                            <Show when={card.card_type === "calendar" && cardCalendarEvents()[card.id]}>
                              <Show when={getCalendarEventGroups(card.id).length === 0}>
                                <div class="empty">No events</div>
                              </Show>
                              <For each={getCalendarEventGroups(card.id)}>
                                {(group) => (
                                  <>
                                    <div class="date-header">{group.label}</div>
                                    <For each={group.events}>
                                      {(event) => (
                                        <>
                                        <div
                                          class={`calendar-event-item ${event.response_status === "declined" ? "declined" : ""} ${selectedEvents()[card.id]?.has(event.id) ? "selected" : ""} ${quickReplyEventId() === event.id ? "replying" : ""}`}
                                          onClick={() => openEvent(event, card.id)}
                                          onMouseEnter={() => showEventHoverActions(event.id)}
                                          onMouseLeave={hideEventHoverActions}
                                        >
                                          <div class="calendar-event-row">
                                            <span class="calendar-event-title">{event.title}</span>
                                            <span class="calendar-event-time-compact">
                                              {getSmartEventTime(event)}
                                            </span>
                                          </div>
                                          <Show when={event.description}>
                                            <div class="calendar-event-description">{event.description}</div>
                                          </Show>
                                          <Show when={event.location}>
                                            <div class="calendar-event-location-compact">
                                              <LocationIcon />
                                              <span>{event.location}</span>
                                            </div>
                                          </Show>
                                          <Show when={event.response_status}>
                                            <div class={`calendar-event-response ${event.response_status}`}>
                                              {event.response_status === "accepted" ? "Going" :
                                                event.response_status === "tentative" ? "Maybe" :
                                                  event.response_status === "declined" ? "Declined" :
                                                    event.response_status === "needsAction" ? "Pending" : event.response_status}
                                            </div>
                                          </Show>
                                          <Show when={event.hangout_link}>
                                            <button
                                              class="calendar-join-btn"
                                              onClick={(e) => { e.stopPropagation(); event.hangout_link && openUrl(event.hangout_link); }}
                                            >
                                              Join meeting
                                            </button>
                                          </Show>
                                          {/* Event Checkbox and Actions Wheel */}
                                          <div
                                            class="thread-checkbox-wrap"
                                            onContextMenu={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setActionConfigMenu({ x: e.clientX, y: e.clientY, isEvent: true });
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              class="thread-checkbox"
                                              checked={selectedEvents()[card.id]?.has(event.id) || false}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleEventSelection(card.id, event.id, e);
                                              }}
                                            />
                                            <Show when={(hoveredEvent() === event.id && eventActionsWheelOpen()) || selectedEvents()[card.id]?.has(event.id)}>
                                              <ActionsWheel
                                                cardId={card.id}
                                                event={event}
                                                selectedCount={selectedEvents()[card.id]?.size || 0}
                                                open={true}
                                                onClose={() => setEventActionsWheelOpen(false)}
                                              />
                                            </Show>
                                          </div>
                                          <div class="thread-actions-wheel-placeholder"></div>
                                        </div>
                                        {/* Event Quick Reply */}
                                        <Show when={quickReplyEventId() === event.id}>
                                          <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                            <ComposeTextarea
                                              class="quick-reply-input"
                                              placeholder={`Reply to ${event.organizer || 'organizer'}...`}
                                              value={quickReplyText()}
                                              onChange={setQuickReplyText}
                                              onSend={() => handleEventQuickReply(event)}
                                              onCancel={() => { setQuickReplyEventId(null); setQuickReplyText(""); }}
                                              disabled={quickReplySending()}
                                              autofocus
                                            />
                                            <div class="quick-reply-actions">
                                              <button class="btn" onClick={() => { setQuickReplyEventId(null); setQuickReplyText(""); }} disabled={quickReplySending()}>Cancel <span class="shortcut-hint">ESC</span></button>
                                              <ComposeSendButton
                                                onClick={() => handleEventQuickReply(event)}
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
                            </Show>

                            {/* Email card: show threads */}
                            <Show when={card.card_type !== "calendar" && cardThreads()[card.id]}>
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
                                              <Show when={thread.calendar_event}>
                                                <span class="thread-indicator" title="Calendar invite">
                                                  <CalendarIcon />
                                                </span>
                                              </Show>
                                              <Show when={thread.has_attachment && !thread.calendar_event}>
                                                <span class="thread-indicator" title="Has attachment">
                                                  <AttachmentIcon />
                                                </span>
                                              </Show>
                                              <span class="thread-time">{formatTime(thread.last_message_date)}</span>
                                            </div>
                                            {/* Calendar event preview */}
                                            <Show when={thread.calendar_event}>
                                              <div class="calendar-event-preview">
                                                <div class="calendar-event-time">
                                                  <ClockIcon />
                                                  <span>{formatCalendarEventDate(thread.calendar_event!.start_time, thread.calendar_event!.end_time, thread.calendar_event!.all_day)}</span>
                                                </div>
                                                <Show when={thread.calendar_event!.location}>
                                                  <div class="calendar-event-location">
                                                    <LocationIcon />
                                                    <span>{thread.calendar_event!.location}</span>
                                                  </div>
                                                </Show>
                                                <Show when={thread.calendar_event!.method === "REQUEST" && thread.calendar_event!.uid}>
                                                  {(() => {
                                                    // Fetch RSVP status if not already loaded
                                                    if (!rsvpStatus()[thread.gmail_thread_id] && thread.calendar_event?.uid) {
                                                      fetchRsvpStatus(thread.gmail_thread_id, thread.calendar_event.uid);
                                                    }
                                                    return null;
                                                  })()}
                                                  <div class="calendar-rsvp" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                      class={rsvpStatus()[thread.gmail_thread_id] === "accepted" ? "selected" : ""}
                                                      disabled={rsvpLoading()[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "yes")}
                                                    >Yes</button>
                                                    <button
                                                      class={rsvpStatus()[thread.gmail_thread_id] === "tentative" ? "selected" : ""}
                                                      disabled={rsvpLoading()[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "maybe")}
                                                    >Maybe</button>
                                                    <button
                                                      class={rsvpStatus()[thread.gmail_thread_id] === "declined" ? "selected" : ""}
                                                      disabled={rsvpLoading()[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "no")}
                                                    >No</button>
                                                  </div>
                                                </Show>
                                              </div>
                                            </Show>
                                            <Show when={!thread.calendar_event}>
                                              <div class="thread-snippet">{thread.snippet}</div>
                                            </Show>
                                            <div class="thread-participants">
                                              {thread.participants.slice(0, 3).join(", ")}
                                              {thread.participants.length > 3 && ` + ${thread.participants.length - 3} `}
                                            </div>
                                            {/* Attachment previews (filter out .ics when calendar event is shown) */}
                                            {(() => {
                                              const isCalendarFile = (a: { mime_type: string; filename: string }) =>
                                                a.mime_type === "text/calendar" || a.mime_type === "application/ics" || a.filename.endsWith(".ics");
                                              const attachments = thread.calendar_event
                                                ? thread.attachments?.filter(a => !isCalendarFile(a))
                                                : thread.attachments;
                                              return (
                                                <Show when={attachments && attachments.length > 0}>
                                                  <div class="thread-attachments" onClick={(e) => e.stopPropagation()}>
                                                    {/* Image thumbnails */}
                                                    <For each={attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 4)}>
                                                      {(attachment) => (
                                                        <img
                                                          class="thread-image-thumb clickable"
                                                          src={`data:${attachment.mime_type};base64,${attachment.inline_data?.replace(/-/g, '+').replace(/_/g, '/')}`}
                                                          alt={attachment.filename}
                                                          title={attachment.filename}
                                                          onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttachmentContextMenu({ messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data }); }}
                                                        />
                                                      )}
                                                    </For>
                                                    {/* Other files (non-image or images without inline data) */}
                                                    <For each={attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")).slice(0, 3)}>
                                                      {(attachment) => (
                                                        <div
                                                          class="thread-file-item clickable"
                                                          title={`${attachment.filename} (${formatFileSize(attachment.size)})`}
                                                          onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttachmentContextMenu({ messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data }); }}
                                                        >
                                                          <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
                                                        </div>
                                                      )}
                                                    </For>
                                                    {/* More indicator */}
                                                    <Show when={attachments.length > 7}>
                                                      <span class="thread-attachment-more">+{attachments.length - 7}</span>
                                                    </Show>
                                                  </div>
                                                </Show>
                                              );
                                            })()}
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
                            updateCardWidth(newWidth, false); // Don't persist during drag
                          };
                          const onUp = () => {
                            setResizing(false);
                            safeSetItem("cardWidth", String(cardWidth())); // Persist on release
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
              <div class="card-wrapper" ref={addCardFormRef}>
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
                    {/* Calendar events preview */}
                    <Show when={!queryPreviewLoading() && newCardQuery().toLowerCase().includes("calendar:")}>
                      <Show when={queryPreviewCalendarEvents().length === 0}>
                        <div class="empty">No events</div>
                      </Show>
                      <For each={queryPreviewCalendarEvents()}>
                        {(event) => (
                          <div class={`calendar-event-item ${event.response_status === "declined" ? "declined" : ""}`}>
                            <div class="calendar-event-row">
                              <span class="calendar-event-title">{event.title}</span>
                              <span class="calendar-event-time-compact">
                                {getSmartEventTime(event)}
                              </span>
                            </div>
                            <Show when={event.description}>
                              <div class="calendar-event-description">{event.description}</div>
                            </Show>
                            <Show when={event.location}>
                              <div class="calendar-event-location-compact">
                                <LocationIcon />
                                <span>{event.location}</span>
                              </div>
                            </Show>
                            <Show when={event.response_status}>
                              <div class={`calendar-event-response ${event.response_status}`}>
                                {event.response_status === "accepted" ? "Going" :
                                  event.response_status === "tentative" ? "Maybe" :
                                    event.response_status === "declined" ? "Declined" :
                                      event.response_status === "needsAction" ? "Pending" : event.response_status}
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
                    {/* Email threads preview */}
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && newCardQuery().trim() && !newCardQuery().toLowerCase().includes("calendar:")}>
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
                                      <span class="thread-indicator" title="Has attachment">
                                        <AttachmentIcon />
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
              </div>
            </Show>

            {/* Add card button */}
            <Show when={!addingCard()}>
              <button class="add-card-btn" onClick={() => { setNewCardColor(null); setQueryPreviewThreads([]); setQueryPreviewCalendarEvents([]); setQueryPreviewLoading(false); setAddingCard(true); }} aria-label="New card" title="New card">
                <PlusIcon />
              </button>
            </Show>
          </div>
        </DragDropProvider>

      </Show>

      {/* Compose Panel (standalone, when not replying from thread) */}
      <Show when={composing() && !activeThreadId()}>
        <div class={`compose-panel ${closingCompose() ? 'closing' : ''}`}>
          <ComposeForm
            mode="new"
            showSubject={true}
            to={composeTo()}
            setTo={(v) => { setComposeTo(v); setComposeEmailError(null); setAutocompleteIndex(0); }}
            cc={composeCc()}
            setCc={(v) => { setComposeCc(v); setComposeEmailError(null); }}
            bcc={composeBcc()}
            setBcc={(v) => { setComposeBcc(v); setComposeEmailError(null); }}
            showCcBcc={showCcBcc()}
            setShowCcBcc={setShowCcBcc}
            subject={composeSubject()}
            setSubject={setComposeSubject}
            body={composeBody()}
            setBody={setComposeBody}
            attachments={composeAttachments()}
            onRemoveAttachment={removeAttachment}
            onFileSelect={handleFileSelect}
            fileInputId="compose-file-input"
            error={composeEmailError()}
            draftSaving={draftSaving()}
            draftSaved={draftSaved()}
            onSend={handleSendEmail}
            onClose={closeCompose}
            onInput={debouncedSaveDraft}
            focusBody={focusComposeBody()}
            autocomplete={{
              show: showAutocomplete(),
              candidates: getFilteredCandidates(),
              selectedIndex: autocompleteIndex(),
              setSelectedIndex: setAutocompleteIndex,
              onSelect: selectContact,
              setShow: setShowAutocomplete,
            }}
          />
        </div>
      </Show>

      {/* Create Event Panel */}
      <Show when={creatingEvent()}>
        <CreateEventForm
          show={true}
          closing={closingEvent()}
          onClose={closeEventForm}
          summary={newEventSummary()}
          setSummary={setNewEventSummary}
          description={newEventDescription()}
          setDescription={setNewEventDescription}
          location={newEventLocation()}
          setLocation={setNewEventLocation}
          startDate={newEventStartDate()}
          setStartDate={setNewEventStartDate}
          startTime={newEventStartTime()}
          setStartTime={setNewEventStartTime}
          endDate={newEventEndDate()}
          setEndDate={setNewEventEndDate}
          endTime={newEventEndTime()}
          setEndTime={setNewEventEndTime}
          allDay={newEventAllDay()}
          setAllDay={setNewEventAllDay}
          attendees={newEventAttendees()}
          setAttendees={setNewEventAttendees}
          recurrence={newEventRecurrence()}
          setRecurrence={setNewEventRecurrence}
          saving={newEventSaving()}
          onSave={handleCreateEvent}
          error={newEventError()}
        />
      </Show>

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

      {/* Restore Found Prompt */}
      <Show when={showRestorePrompt()}>
        <div class="preset-overlay">
          <div class="preset-modal restore-modal">
            <h2>Welcome Back</h2>
            <p>We found a layout from iCloud.</p>
            <div class="restore-actions">
              <button class="btn btn-primary btn-lg" onClick={() => setShowRestorePrompt(false)}>
                Continue
              </button>
              <button class="btn btn-ghost" onClick={handleStartFresh}>
                Start from scratch
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Thread View Overlay */}
      <Show when={activeThreadId()}>
        <ThreadView
          thread={activeThread()}
          accountId={selectedAccount()?.id || ''}
          loading={threadLoading()}
          error={threadError()}
          card={activeThreadCardId() ? (() => {
            const c = cards().find(c => c.id === activeThreadCardId());
            return c ? { name: c.name, color: (c.color as CardColor) || null } : null;
          })() : null}
          focusColor={selectedBgColorIndex() !== null ? BG_COLORS[selectedBgColorIndex()!].hex : null}
          onClose={() => { setActiveThreadId(null); setActiveThreadCardId(null); setFocusedMessageIndex(0); setLabelDrawerOpen(false); closeCompose(); }}
          focusedMessageIndex={focusedMessageIndex()}
          onFocusChange={setFocusedMessageIndex}
          onOpenAttachment={(messageId, attachmentId, filename, mimeType, inlineData) => openAttachment(messageId, attachmentId, filename, mimeType, inlineData)}
          onDownloadAttachment={(messageId, attachmentId, filename, mimeType, inlineData) => downloadAttachment(messageId, attachmentId, filename, mimeType, inlineData)}
          onShowAttachmentMenu={showAttachmentContextMenu}
          onReply={handleReplyFromThread}
          onForward={handleForwardFromThread}
          onAction={handleThreadViewAction}
          onOpenLabels={() => { fetchAccountLabels(); setLabelDrawerOpen(true); }}
          isStarred={isThreadStarred()}
          isRead={isThreadRead()}
          isImportant={isThreadImportant()}
          isInInbox={isThreadInInbox()}
          labelCount={getThreadUserLabelCount()}
          // Inline compose props
          inlineCompose={composing() ? {
            replyToMessageId: replyingToThread()?.messageId || null,
            isForward: !!forwardingThread(),
            to: composeTo(),
            setTo: setComposeTo,
            cc: composeCc(),
            setCc: setComposeCc,
            bcc: composeBcc(),
            setBcc: setComposeBcc,
            showCcBcc: showCcBcc(),
            setShowCcBcc: setShowCcBcc,
            subject: composeSubject(),
            setSubject: setComposeSubject,
            body: composeBody(),
            setBody: setComposeBody,
            attachments: composeAttachments(),
            onRemoveAttachment: removeAttachment,
            onFileSelect: handleFileSelect,
            error: composeEmailError(),
            draftSaving: draftSaving(),
            draftSaved: draftSaved(),
            onSend: handleSendEmail,
            onClose: closeCompose,
            onInput: debouncedSaveDraft,
            focusBody: focusComposeBody(),
            messageWidth: inlineMessageWidth(),
            resizing: inlineResizing(),
            onResizeStart: handleInlineResizeStart,
          } : null}
          threadAttachments={(() => {
            const cardId = activeThreadCardId();
            const threadId = activeThreadId();
            if (!cardId || !threadId) return undefined;
            const groups = cardThreads()[cardId] || [];
            for (const group of groups) {
              const thread = group.threads.find(t => t.gmail_thread_id === threadId);
              if (thread) return thread.attachments;
            }
            return undefined;
          })()}
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

      {/* Event View Overlay */}
      <Show when={activeEvent()}>
        <EventView
          event={activeEvent()}
          card={activeEventCardId() ? (() => {
            const c = cards().find(c => c.id === activeEventCardId());
            return c ? { name: c.name, color: (c.color as CardColor) || null } : null;
          })() : null}
          focusColor={selectedBgColorIndex() !== null ? BG_COLORS[selectedBgColorIndex()!].hex : null}
          onClose={closeEvent}
          onRsvp={async (status) => {
            const event = activeEvent();
            if (!event || !selectedAccount()) return;
            try {
              closeEvent();
              showToast(`Response updated to ${status}`);
            } catch (e) {
              console.error("Failed to update RSVP", e);
            }
          }}
          onReplyOrganizer={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = `Re: ${event.title}`;
            const to = event.organizer || '';
            setComposeTo(to);
            setComposeSubject(subject);
            setComposeBody('');
            setReplyingToEvent({ eventId: event.id });
            setForwardingEvent(null);
            setComposing(true);
            setFocusComposeBody(true);
          }}
          onReplyAll={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = `Re: ${event.title}`;
            const allEmails = event.attendees
              .filter(a => !a.is_self)
              .map(a => a.email)
              .join(', ');
            const to = event.organizer || '';
            const cc = allEmails;
            setComposeTo(to);
            setComposeCc(cc);
            setShowCcBcc(true);
            setComposeSubject(subject);
            setComposeBody('');
            setReplyingToEvent({ eventId: event.id });
            setForwardingEvent(null);
            setComposing(true);
            setFocusComposeBody(true);
          }}
          onForward={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = `Fwd: ${event.title}`;
            const body = `---------- Forwarded event ----------\n` +
              `Title: ${event.title}\n` +
              `When: ${new Date(event.start_time).toLocaleString()}\n` +
              (event.location ? `Where: ${event.location}\n` : '') +
              (event.organizer ? `Organizer: ${event.organizer}\n` : '') +
              (event.description ? `\n${event.description}` : '');
            setComposeTo('');
            setComposeSubject(subject);
            setComposeBody(body);
            setForwardingEvent({ eventId: event.id });
            setReplyingToEvent(null);
            setComposing(true);
            setFocusComposeBody(true);
          }}
          onDelete={async () => {
            const event = activeEvent();
            const account = selectedAccount();
            const cardId = activeEventCardId();
            if (!event || !account) return;
            try {
              await deleteCalendarEvent(account.id, event.calendar_id, event.id);
              // Remove event from card's event list
              if (cardId) {
                const currentEvents = cardCalendarEvents()[cardId] || [];
                setCardCalendarEvents({
                  ...cardCalendarEvents(),
                  [cardId]: currentEvents.filter(e => e.id !== event.id)
                });
              }
              showToast('Event deleted');
              closeEvent();
            } catch (e) {
              console.error('Failed to delete event:', e);
              showToast(String(e));
            }
          }}
          onOpenCalendars={() => { fetchAvailableCalendars(); setCalendarDrawerOpen(true); }}
          calendarDrawerOpen={calendarDrawerOpen()}
          onCloseCalendarDrawer={() => setCalendarDrawerOpen(false)}
          calendars={availableCalendars()}
          calendarsLoading={calendarsLoading()}
          onMoveToCalendar={handleMoveEventToCalendar}
          rsvpLoading={false}
          inlineCompose={composing() && activeEvent() && (replyingToEvent()?.eventId === activeEvent()!.id || forwardingEvent()?.eventId === activeEvent()!.id) ? {
            replyToMessageId: null,
            isForward: !!forwardingEvent(),
            to: composeTo(),
            setTo: setComposeTo,
            cc: composeCc(),
            setCc: setComposeCc,
            bcc: composeBcc(),
            setBcc: setComposeBcc,
            showCcBcc: showCcBcc(),
            setShowCcBcc: setShowCcBcc,
            subject: composeSubject(),
            setSubject: setComposeSubject,
            body: composeBody(),
            setBody: setComposeBody,
            attachments: composeAttachments(),
            onRemoveAttachment: removeAttachment,
            onFileSelect: handleFileSelect,
            error: composeEmailError(),
            draftSaving: draftSaving(),
            draftSaved: draftSaved(),
            onSend: handleSendEmail,
            onClose: () => { closeCompose(); setReplyingToEvent(null); setForwardingEvent(null); },
            onInput: debouncedSaveDraft,
            focusBody: focusComposeBody(),
            messageWidth: inlineMessageWidth(),
            resizing: inlineResizing(),
            onResizeStart: handleInlineResizeStart,
          } : null}
        />
      </Show>

      {/* Batch Reply Panel */}
      <Show when={batchReplyOpen()}>
        <div class="thread-overlay">
          <div class="thread-floating-bar">
            {/* Row 1: Close + Title */}
            <div class="thread-floating-bar-row">
              <CloseButton onClick={closeBatchReply} />
              <div class="thread-bar-subject">
                <h2>Batch Reply</h2>
              </div>
              <span class="batch-reply-count">{batchReplyThreads().length} remaining</span>
            </div>
            {/* Row 2: Send All */}
            <div class="thread-floating-bar-row thread-bar-actions">
              <div class="thread-toolbar-spacer" />
              <button
                class="btn btn-primary btn-sm"
                disabled={!Object.values(batchReplyMessages()).some(m => m?.trim())}
                onClick={sendAllBatchReplies}
              >
                Send All ({Object.values(batchReplyMessages()).filter(m => m?.trim()).length})
              </button>
            </div>
          </div>
          <div class="thread-content">
            <Show when={batchReplyLoading()}>
              <div class="batch-reply-loading">
                <div class="loading-spinner"></div>
                Loading threads...
              </div>
            </Show>
            <Show when={!batchReplyLoading() && batchReplyThreads().length === 0}>
              <div class="batch-reply-empty">No threads to reply to</div>
            </Show>
            <div class="messages-list">
              <For each={batchReplyThreads()}>
                {(thread) => (
                  <div class={`message-row with-compose ${inlineResizing() ? 'resizing' : ''}`}>
                    <div class="message-card">
                      <div class="message-header">
                        <div class="message-sender">{thread.from}</div>
                        <div class="message-header-actions">
                          <div class="message-date">{thread.date}</div>
                        </div>
                      </div>
                      <div class="batch-reply-subject">{thread.subject}</div>
                      <div class="message-body" innerHTML={DOMPurify.sanitize(thread.body, DOMPURIFY_CONFIG)}></div>
                    </div>
                    <div
                      class="inline-resize-handle"
                      onMouseDown={handleInlineResizeStart}
                    />
                    <div class="inline-compose">
                      <ComposeForm
                        mode="batchReply"
                        showFields={false}
                        body={batchReplyMessages()[thread.threadId] || ''}
                        setBody={(v) => updateBatchReplyMessage(thread.threadId, v)}
                        placeholder={`Reply to ${extractEmail(thread.from)}...`}
                        attachments={batchReplyAttachments()[thread.threadId] || []}
                        onRemoveAttachment={(i) => removeBatchReplyAttachment(thread.threadId, i)}
                        onFileSelect={(e) => handleBatchReplyFileSelect(thread.threadId, e)}
                        fileInputId={`batch-reply-file-input-${thread.threadId}`}
                        sending={batchReplySending()[thread.threadId]}
                        onSend={() => sendBatchReply(thread.threadId)}
                        onClose={closeBatchReply}
                        onSkip={() => discardBatchReplyThread(thread.threadId)}
                        canSend={!!batchReplyMessages()[thread.threadId]?.trim()}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Query help sheet */}
      <Show when={queryHelpOpen()}>
        <div class="query-help-overlay" onClick={() => setQueryHelpOpen(false)}></div>
        <div class="query-help-sheet">
          <div class="query-help-header">
            <h3>Query Operators</h3>
            <CloseButton onClick={() => setQueryHelpOpen(false)} />
          </div>
          <div class="query-help-body">
            <div class="query-help-section">
              <h4>Email Operators</h4>
              <div class="query-help-table">
                <div class="query-help-row">
                  <code>from:</code>
                  <span>Sender email or name</span>
                </div>
                <div class="query-help-row">
                  <code>to:</code>
                  <span>Recipient email</span>
                </div>
                <div class="query-help-row">
                  <code>subject:</code>
                  <span>Words in subject</span>
                </div>
                <div class="query-help-row">
                  <code>label:</code>
                  <span>Gmail label (e.g., label:inbox)</span>
                </div>
                <div class="query-help-row">
                  <code>is:unread</code>
                  <span>Unread messages</span>
                </div>
                <div class="query-help-row">
                  <code>is:starred</code>
                  <span>Starred messages</span>
                </div>
                <div class="query-help-row">
                  <code>has:attachment</code>
                  <span>Has attachments</span>
                </div>
                <div class="query-help-row">
                  <code>newer_than:7d</code>
                  <span>Last 7 days (d/m/y)</span>
                </div>
                <div class="query-help-row">
                  <code>older_than:1m</code>
                  <span>Older than 1 month</span>
                </div>
                <div class="query-help-row">
                  <code>-word</code>
                  <span>Exclude word</span>
                </div>
              </div>
            </div>
            <div class="query-help-section">
              <h4>Calendar Operators</h4>
              <p class="query-help-note">Start query with <code>calendar:</code> to create a calendar card</p>
              <div class="query-help-table">
                <div class="query-help-row">
                  <code>calendar:today</code>
                  <span>Today's events</span>
                </div>
                <div class="query-help-row">
                  <code>calendar:tomorrow</code>
                  <span>Tomorrow's events</span>
                </div>
                <div class="query-help-row">
                  <code>calendar:7d</code>
                  <span>Next 7 days</span>
                </div>
                <div class="query-help-row">
                  <code>calendar:2w</code>
                  <span>Next 2 weeks</span>
                </div>
                <div class="query-help-row">
                  <code>calendar:month</code>
                  <span>This month</span>
                </div>
                <div class="query-help-row">
                  <code>with:name</code>
                  <span>Attendee name/email</span>
                </div>
                <div class="query-help-row">
                  <code>organizer:email</code>
                  <span>Event organizer</span>
                </div>
                <div class="query-help-row">
                  <code>location:text</code>
                  <span>Event location</span>
                </div>
                <div class="query-help-row">
                  <code>response:needsAction</code>
                  <span>Needs RSVP</span>
                </div>
                <div class="query-help-row">
                  <code>-keyword</code>
                  <span>Exclude events</span>
                </div>
              </div>
            </div>
            <div class="query-help-section">
              <h4>Examples</h4>
              <div class="query-help-examples">
                <code>from:boss is:unread</code>
                <code>label:inbox newer_than:1d</code>
                <code>has:attachment -newsletter</code>
                <code>calendar:week with:john</code>
                <code>calendar:today response:needsAction</code>
              </div>
            </div>
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
            <p class="settings-hint" style="margin-bottom: 12px;">
              <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://console.cloud.google.com/apis/credentials'); }} class="settings-link">
                Open Google Cloud Console
              </a> to create OAuth credentials.
            </p>
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
          <div class={`settings-section collapsible ${smartRepliesOpen() ? 'open' : ''}`}>
            <div class="settings-section-title" onClick={() => setSmartRepliesOpen(!smartRepliesOpen())}>
              <span>Smart Replies</span>
              <span class="collapse-icon">{smartRepliesOpen() ? '−' : '+'}</span>
            </div>
            <Show when={smartRepliesOpen()}>
              <p class="settings-hint" style="margin-bottom: 12px;">
                AI-powered reply suggestions via Vertex AI.
              </p>
              <div class="settings-form-group">
                <label>Project ID</label>
                <input
                  type="text"
                  value={vertexProjectId()}
                  onInput={(e) => {
                    setVertexProjectId(e.currentTarget.value);
                    localStorage.setItem("google_cloud_project_id", e.currentTarget.value);
                  }}
                  placeholder="my-gcp-project"
                />
              </div>
            </Show>
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
        {(() => {
          const isEvent = actionConfigMenu()?.isEvent;
          const order = isEvent ? eventActionOrder() : actionOrder();
          const settings = isEvent ? eventActionSettings() : actionSettings();
          const handlers = isEvent ? eventActionHandlers : threadActionHandlers;
          const labels: Record<string, string> = isEvent
            ? { quickReply: 'Reply', joinMeeting: 'Join Meeting', openCalendar: 'Open in Calendar', rsvpYes: 'RSVP Yes', rsvpNo: 'RSVP No', delete: 'Delete' }
            : { quickReply: 'Reply', quickForward: 'Forward', archive: 'Archive', star: 'Star', trash: 'Delete', markRead: 'Read', markImportant: 'Important', spam: 'Spam' };
          const defaultEnabled = isEvent ? ['quickReply'] : ['quickReply', 'quickForward'];

          return (
            <div
              class={`action-config-menu ${draggingAction() ? 'dragging' : ''}`}
              style={{ top: `${actionConfigMenu()!.y}px`, left: `${actionConfigMenu()!.x}px` }}
            >
              <For each={order}>
                {(key, i) => {
                  const isEnabled = defaultEnabled.includes(key) ? settings[key] !== false : !!settings[key];
                  return (
                    <div
                      class={`action-config-item ${draggingAction() === key ? 'dragging' : ''}`}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).tagName === 'INPUT') return;
                        e.preventDefault();
                        window.getSelection()?.removeAllRanges();
                        setDraggingAction(key);
                        const onUp = () => { setDraggingAction(null); document.removeEventListener('mouseup', onUp); };
                        document.addEventListener('mouseup', onUp);
                      }}
                      onMouseEnter={() => {
                        if (draggingAction() && draggingAction() !== key) {
                          const from = order.indexOf(draggingAction()!);
                          if (from !== i()) handlers.move(from, i());
                        }
                      }}
                    >
                      <span class="drag-handle">⋮⋮</span>
                      <input type="checkbox" checked={isEnabled} onChange={() => handlers.toggle(key)} />
                      <span>{labels[key]}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          );
        })()}
      </Show>

      {/* Undo Toast */}
      <Show when={toastVisible()}>
        <div class={`undo-toast ${toastClosing() ? 'closing' : ''}`}>
          <Show when={!simpleToastMessage()}>
            <div class="toast-progress"></div>
          </Show>
          <div class="toast-content">
            <span class="toast-message">{simpleToastMessage() || (lastAction() ? getActionLabel(lastAction()!.action, lastAction()!.threadIds.length) : '')}</span>
            <Show when={!simpleToastMessage() && lastAction()}>
              <button class="toast-undo-btn" onClick={undoLastAction}>Undo <span class="shortcut-hint">z</span></button>
            </Show>
            <button class="toast-close-btn" onClick={hideToast} title="Dismiss">
              <CloseIcon />
            </button>
          </div>
        </div>
      </Show>

      {/* Send Toast with Undo */}
      <Show when={sendToastVisible()}>
        <div class={`undo-toast send-toast ${sendToastClosing() ? 'closing' : ''}`}>
          <div class="toast-progress send-progress" style={{ width: `${sendProgress()}%` }}></div>
          <div class="toast-content">
            <span class="toast-message">Sending message...</span>
            <button class="toast-undo-btn" onClick={undoSend}>Undo</button>
          </div>
        </div>
      </Show>
    </div >
  );
}



export default App;
