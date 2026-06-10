import { createSignal, onMount, onCleanup, Show, For, createMemo, createEffect } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import DOMPurify from 'dompurify';
import { DOMPURIFY_CONFIG } from './components/MessageBody';
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
  downloadAttachment as downloadAttachmentApi,
  saveAttachment as saveAttachmentApi,
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
  updateCalendarEvent,
  pullFromICloud,
  getCachedCardEvents,
  saveCachedCardEvents,
  createCalendarEvent,
  type EventInput,
  sendReaction,
} from "./api/tauri";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import {
  decodeBase64Utf8,
  findContent,
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
  formatCalendarEventDate,
  decodeHtmlEntities,
  getResponseStatusLabel,
  normalizeBase64Url,
  addReplyPrefix,
  toDateInputString,
} from "./utils";
import "./App.css";
import {
  ChevronIcon,
  RefreshIcon,
  PlusIcon,
  GoogleLogo,
  SettingsIcon,
  ComposeIcon,
  CloseIcon,
  AttachmentIcon,
  SearchIcon,
  PaletteIcon,
  CalendarIcon,
  LocationIcon,
  ClockIcon,
} from "./components/Icons";
import { ReactionButton } from "./components/ReactionButton";
import { ComposeTextarea, ComposeSendButton, CloseButton } from "./components/ComposeAtoms";
import { ComposeForm } from "./components/ComposeForm";
import { CreateEventForm } from "./components/CreateEventForm";
import { ThreadView } from "./components/ThreadView";
import { EventView } from "./components/EventView";
import { ActionsWheel } from "./components/ActionsWheel";
import { CardForm } from "./components/CardForm";
import { safeGetItem, safeSetItem, safeRemoveItem, safeGetJSON, safeSetJSON } from "./shared/storage";
import { BG_COLORS, GMAIL_OPERATORS, type ActionSettings, type CardColor, type GroupBy } from "./shared/constants";

function App() {
  const [loading, setLoading] = createSignal(true);

  // Thread View State
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [activeThreadCardId, setActiveThreadCardId] = createSignal<string | null>(null);
  const [activeThread, setActiveThread] = createSignal<FullThread | null>(null);
  // CID attachment data fetched on-demand for inline images (cid -> base64 data)
  const [cidAttachmentData, setCidAttachmentData] = createSignal<Record<string, string>>({});
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
  const [cardThreads, setCardThreads] = createStore<Record<string, ThreadGroup[]>>({});
  const [cardCalendarEvents, setCardCalendarEvents] = createStore<Record<string, GoogleCalendarEvent[]>>({});
  const [loadingThreads, setLoadingThreads] = createStore<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = createStore<Record<string, string | null>>({});
  const [collapsedCards, setCollapsedCards] = createStore<Record<string, boolean>>({});
  const [cardPageTokens, setCardPageTokens] = createStore<Record<string, string | null>>({});
  const [cardHasMore, setCardHasMore] = createStore<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = createStore<Record<string, boolean>>({});

  // Sync status tracking
  const [lastSyncTimes, setLastSyncTimes] = createStore<Record<string, number>>({});
  const [syncErrors, setSyncErrors] = createStore<Record<string, string | null>>({});
  // Current time signal for reactive relative time displays (updates every 30s)
  const [currentTime, setCurrentTime] = createSignal(Date.now());

  // Google Contacts from People API
  const [googleContacts, setGoogleContacts] = createSignal<Contact[]>([]);

  // RSVP status tracking (thread ID -> "accepted" | "tentative" | "declined" | "needsAction")
  const [rsvpStatus, setRsvpStatus] = createStore<Record<string, string>>({});
  const [rsvpLoading, setRsvpLoading] = createStore<Record<string, boolean>>({});

  // Fetch RSVP status for a calendar event (at most once per thread, guarded
  // against re-fires from re-renders while the request is in flight or failed)
  const rsvpStatusRequested = new Set<string>();
  const fetchRsvpStatus = async (threadId: string, eventUid: string) => {
    if (!selectedAccount() || !eventUid) return;
    if (rsvpStatusRequested.has(threadId)) return;
    rsvpStatusRequested.add(threadId);
    try {
      const status = await getCalendarRsvpStatus(selectedAccount()!.id, eventUid);
      if (status) {
        setRsvpStatus(threadId, status);
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
    setRsvpLoading(threadId, true);

    try {
      await rsvpCalendarEvent(selectedAccount()!.id, eventUid, apiStatus);

      // Update local state on success
      setRsvpStatus(threadId, apiStatus);
    } catch (e) {
      console.error("Failed to update RSVP:", e);
      showToast(`Failed to update RSVP: ${e}`);
    } finally {
      setRsvpLoading(threadId, false);
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
  const [toast, setToast] = createSignal<{
    message: string | null;
    visible: boolean;
    closing: boolean;
    key: number;
  } | null>(null);
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
    isHtml?: boolean;
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
  const [editCardGroupBy, setEditCardGroupBy] = createSignal<GroupBy>("date");
  const [editColorPickerOpen, setEditColorPickerOpen] = createSignal(false);

  // Keyboard navigation focus state
  const [focusedCardId, setFocusedCardId] = createSignal<string | null>(null);
  const [focusedThreadIndex, setFocusedThreadIndex] = createSignal<number>(-1);
  const [focusedEventIndex, setFocusedEventIndex] = createSignal<number>(-1);

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
  const [quickReply, setQuickReply] = createSignal<{
    threadId: string | null;
    text: string;
    sending: boolean;
  }>({ threadId: null, text: "", sending: false });
  const [quickReplyCardId, setQuickReplyCardId] = createSignal<string | null>(null);

  // Quick Reaction (for thread list)
  const [quickReactionSending, setQuickReactionSending] = createSignal(false);

  // Event quick reply
  const [quickReplyEventId, setQuickReplyEventId] = createSignal<string | null>(null);

  // Open quick reply for a thread/event, closing the other target and clearing
  // draft text whenever the target changes so text never leaks between them
  function openThreadQuickReply(threadId: string, cardId: string) {
    setQuickReplyEventId(null);
    setQuickReply(qr => ({ ...qr, threadId, text: qr.threadId === threadId ? qr.text : "" }));
    setQuickReplyCardId(cardId);
  }

  function openEventQuickReply(eventId: string) {
    const sameTarget = quickReplyEventId() === eventId;
    setQuickReply(qr => ({ ...qr, threadId: null, text: sameTarget ? qr.text : "" }));
    setQuickReplyCardId(null);
    setQuickReplyEventId(eventId);
  }

  // Thread actions wheel
  const [hoveredThread, setHoveredThread] = createSignal<string | null>(null);
  const [actionsWheelOpen, setActionsWheelOpen] = createSignal(false);
  const [actionConfigMenu, setActionConfigMenu] = createSignal<{ x: number; y: number; isEvent?: boolean } | null>(null);
  let hoverActionsTimeout: number | undefined;

  // Event actions wheel
  const [hoveredEvent, setHoveredEvent] = createSignal<string | null>(null);
  const [eventActionsWheelOpen, setEventActionsWheelOpen] = createSignal(false);
  let hoverEventActionsTimeout: number | undefined;

  function showThreadHoverActions(threadId: string) {
    if (hoverActionsTimeout) {
      clearTimeout(hoverActionsTimeout);
      hoverActionsTimeout = undefined;
    }

    // Close event wheel when showing thread wheel
    setEventActionsWheelOpen(false);
    setHoveredEvent(null);

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

    // Close thread wheel when showing event wheel
    setActionsWheelOpen(false);
    setHoveredThread(null);

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

  interface EventFormState {
    summary: string;
    description: string;
    location: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    allDay: boolean;
    attendees: string;
    recurrence: string | null;
    saving: boolean;
    error: string | null;
    editing: { id: string; calendarId: string } | null;
    closing: boolean;
  }

  // Smart defaults: round up to next 30-min interval, end 30 mins later
  const getSmartEventDefaults = () => {
    const now = new Date();
    const startTime = new Date(now);
    if (now.getMinutes() <= 30) {
      startTime.setMinutes(30, 0, 0);
    } else {
      startTime.setHours(startTime.getHours() + 1, 0, 0, 0);
    }
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    // Derive the date from startTime so rounding past midnight advances the day
    return {
      date: toDateInputString(startTime),
      startTime: `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`,
      endTime: `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`
    };
  };

  const defaultEventForm = (): EventFormState => {
    const defaults = getSmartEventDefaults();
    return {
      summary: "", description: "", location: "",
      startDate: defaults.date, startTime: defaults.startTime,
      endDate: defaults.date, endTime: defaults.endTime,
      allDay: false, attendees: "", recurrence: null,
      saving: false, error: null, editing: null, closing: false,
    };
  };

  const [eventForm, setEventForm] = createSignal<EventFormState>(defaultEventForm());

  const resetEventFormToNow = () => {
    const defaults = getSmartEventDefaults();
    setEventForm(f => ({ ...f, startDate: defaults.date, startTime: defaults.startTime, endDate: defaults.date, endTime: defaults.endTime }));
  };
  const closeEventForm = () => {
    setEventForm(f => ({ ...f, closing: true }));
    setTimeout(() => {
      setCreatingEvent(false);
      setEventForm(defaultEventForm());
    }, 200);
  };
  const [closingCompose, setClosingCompose] = createSignal(false);
  const [composeTo, setComposeTo] = createSignal("");
  const [composeCc, setComposeCc] = createSignal("");
  const [composeBcc, setComposeBcc] = createSignal("");
  const [showCcBcc, setShowCcBcc] = createSignal(false);
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [composeIsHtml, setComposeIsHtml] = createSignal(false);
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
  const [geminiApiKey, setGeminiApiKey] = createSignal(localStorage.getItem("gemini_api_key") || "");
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

      // Update sync times for non-collapsed email cards; calendar cards are
      // not touched by Gmail history sync and must not be stamped as synced
      const now = Date.now();
      const nonCollapsedCardIds = cards()
        .filter(c => !c.collapsed && c.account_id === account.id && c.card_type !== "calendar")
        .map(c => c.id);
      if (nonCollapsedCardIds.length > 0) {
        setLastSyncTimes(produce(s => {
          for (const cardId of nonCollapsedCardIds) {
            s[cardId] = now;
          }
        }));
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

    const updatedCardThreads: Record<string, ThreadGroup[]> = {};
    const matchedThreadIds = new Set<string>();

    for (const cardId of Object.keys(cardThreads)) {
      const groups = cardThreads[cardId];
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

    setCardThreads(produce(s => { Object.assign(s, updatedCardThreads); }));

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
    let totalUnread = 0;

    for (const groups of Object.values(cardThreads)) {
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

  let unlistenMailto: (() => void) | undefined;

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
        setCollapsedCards(reconcile(collapsed));

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
      unlistenMailto = await listen<{
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
  const timeUpdateInterval = setInterval(() => setCurrentTime(Date.now()), 15000);

  onCleanup(() => {
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId);
    }
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
    clearInterval(timeUpdateInterval);
    window.removeEventListener("focus", handleWindowFocus);
    unlistenMailto?.();
  });

  // Helper to get all threads from a card as a flat array
  function getCardThreadsFlat(cardId: string): Thread[] {
    return getDisplayGroups(cardId).flatMap(g => g.threads);
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

  // Get flattened list of calendar events for a card
  function getCardEventsFlat(cardId: string): GoogleCalendarEvent[] {
    return getCalendarEventGroups(cardId).flatMap(g => g.events);
  }

  // Check if a specific event in a card is focused
  function isEventFocused(cardId: string, eventId: string): boolean {
    if (focusedCardId() !== cardId) return false;
    const idx = focusedEventIndex();
    if (idx < 0) return false;
    const events = getCardEventsFlat(cardId);
    return events[idx]?.id === eventId;
  }

  // Get the focused event
  function getFocusedEvent(): GoogleCalendarEvent | null {
    const cardId = focusedCardId();
    const idx = focusedEventIndex();
    if (!cardId || idx < 0) return null;
    const events = getCardEventsFlat(cardId);
    return events[idx] || null;
  }

  // Check if a card is a calendar card
  function isCalendarCard(cardId: string): boolean {
    const card = cards().find(c => c.id === cardId);
    return card?.card_type === 'calendar';
  }

  function scrollFocusedIntoView() {
    requestAnimationFrame(() => {
      const focusedCard = document.querySelector('.card-wrapper:has(.card.card-focused)');
      focusedCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      const focused = document.querySelector('.thread.focused, .calendar-event-item.focused');
      focused?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && creatingEvent() && eventForm().summary && !eventForm().saving) {
      e.preventDefault();
      handleCreateEvent();
      return;
    }

    // Skip other shortcuts if typing in an input
    if (isTyping) {
      return;
    }

    // z to undo last action (when toast is visible) — works even with overlays open
    if (e.key === 'z' && toast()?.visible && lastAction()) {
      e.preventDefault();
      undoLastAction();
      return;
    }

    // ThreadView/EventView own the keyboard while open; without this, keys
    // like a/s/d also hit the focused thread *behind* the overlay
    if (activeThreadId() || activeEvent()) {
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
        setFocusedEventIndex(-1);
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

    // Card navigation - h/l/ArrowLeft/ArrowRight for left/right between cards
    if (e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cardsList = cards().filter(c => !collapsedCards[c.id]);
      if (cardsList.length === 0) return;

      const isRight = e.key === 'l' || e.key === 'ArrowRight';
      let cardId = focusedCardId();

      if (!cardId) {
        // From add card form, go back to last card
        if (addingCard() && !isRight) {
          setAddingCard(false);
          if (cardsList.length > 0) {
            const lastCard = cardsList[cardsList.length - 1];
            setFocusedCardId(lastCard.id);
            if (isCalendarCard(lastCard.id)) {
              setFocusedEventIndex(0);
              setFocusedThreadIndex(-1);
            } else {
              setFocusedThreadIndex(0);
              setFocusedEventIndex(-1);
            }
            scrollFocusedIntoView();
          }
          return;
        }
        const targetCard = isRight ? cardsList[0] : cardsList[cardsList.length - 1];
        setFocusedCardId(targetCard.id);
        if (isCalendarCard(targetCard.id)) {
          setFocusedEventIndex(0);
          setFocusedThreadIndex(-1);
        } else {
          setFocusedThreadIndex(0);
          setFocusedEventIndex(-1);
        }
        scrollFocusedIntoView();
        return;
      }

      const cardIndex = cardsList.findIndex(c => c.id === cardId);
      const newCardIndex = isRight ? cardIndex + 1 : cardIndex - 1;

      if (newCardIndex >= 0 && newCardIndex < cardsList.length) {
        const newCardId = cardsList[newCardIndex].id;
        setFocusedCardId(newCardId);
        if (isCalendarCard(newCardId)) {
          setFocusedEventIndex(0);
          setFocusedThreadIndex(-1);
        } else {
          setFocusedThreadIndex(0);
          setFocusedEventIndex(-1);
        }
        scrollFocusedIntoView();
      } else if (isRight && newCardIndex >= cardsList.length && !addingCard()) {
        // Past last card - open add card form
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
        setFocusedEventIndex(-1);
        setNewCardColor(null);
        setQueryPreviewThreads([]);
        setQueryPreviewCalendarEvents([]);
        setQueryPreviewLoading(false);
        setAddingCard(true);
      } else if (!isRight && newCardIndex < 0 && addingCard()) {
        setAddingCard(false);
        if (cardsList.length > 0) {
          const lastCard = cardsList[cardsList.length - 1];
          setFocusedCardId(lastCard.id);
          if (isCalendarCard(lastCard.id)) {
            setFocusedEventIndex(0);
            setFocusedThreadIndex(-1);
          } else {
            setFocusedThreadIndex(0);
            setFocusedEventIndex(-1);
          }
          scrollFocusedIntoView();
        }
      }
      return;
    }

    // Item navigation - j/k/ArrowUp/ArrowDown for up/down within cards (threads or events)
    if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cardsList = cards().filter(c => !collapsedCards[c.id]);
      if (cardsList.length === 0) return;

      const isDown = e.key === 'j' || e.key === 'ArrowDown';
      let cardId = focusedCardId();

      // If no focus, start at first card
      if (!cardId) {
        cardId = cardsList[0].id;
        setFocusedCardId(cardId);
        if (isCalendarCard(cardId)) {
          setFocusedEventIndex(isDown ? 0 : -1);
          setFocusedThreadIndex(-1);
        } else {
          setFocusedThreadIndex(isDown ? 0 : -1);
          setFocusedEventIndex(-1);
        }
        scrollFocusedIntoView();
        return;
      }

      // Get items based on card type
      const isCalendar = isCalendarCard(cardId);
      const items = isCalendar ? getCardEventsFlat(cardId) : getCardThreadsFlat(cardId);
      const idx = isCalendar ? focusedEventIndex() : focusedThreadIndex();
      const newIdx = isDown ? idx + 1 : idx - 1;

      if (newIdx >= 0 && newIdx < items.length) {
        // Move within same card
        if (isCalendar) {
          setFocusedEventIndex(newIdx);
        } else {
          setFocusedThreadIndex(newIdx);
        }
        scrollFocusedIntoView();
      } else if (isDown && newIdx >= items.length) {
        // Move to next card
        const cardIndex = cardsList.findIndex(c => c.id === cardId);
        if (cardIndex < cardsList.length - 1) {
          const nextCardId = cardsList[cardIndex + 1].id;
          setFocusedCardId(nextCardId);
          if (isCalendarCard(nextCardId)) {
            setFocusedEventIndex(0);
            setFocusedThreadIndex(-1);
          } else {
            setFocusedThreadIndex(0);
            setFocusedEventIndex(-1);
          }
          scrollFocusedIntoView();
        }
      } else if (!isDown && newIdx < 0 && idx >= 0) {
        // Move to previous card
        const cardIndex = cardsList.findIndex(c => c.id === cardId);
        if (cardIndex > 0) {
          const prevCardId = cardsList[cardIndex - 1].id;
          setFocusedCardId(prevCardId);
          if (isCalendarCard(prevCardId)) {
            const prevItems = getCardEventsFlat(prevCardId);
            setFocusedEventIndex(prevItems.length - 1);
            setFocusedThreadIndex(-1);
          } else {
            const prevItems = getCardThreadsFlat(prevCardId);
            setFocusedThreadIndex(prevItems.length - 1);
            setFocusedEventIndex(-1);
          }
          scrollFocusedIntoView();
        }
      }
      return;
    }

    // Enter to open thread or event view
    if (e.key === 'Enter') {
      const cardId = focusedCardId();
      if (!cardId) return;

      const thread = getFocusedThread();
      if (thread) {
        openThread(thread.gmail_thread_id, cardId);
        return;
      }

      const event = getFocusedEvent();
      if (event) {
        openEvent(event, cardId);
        return;
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
        const isStarred = thread.labels?.includes("STARRED") ?? false;
        handleThreadAction(isStarred ? 'unstar' : 'star', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'd' || e.key === '#') {
        e.preventDefault();
        handleThreadAction('trash', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'r') {
        e.preventDefault();
        openThreadQuickReply(thread.gmail_thread_id, cardId);
        return;
      }
      if (e.key === 'u') {
        e.preventDefault();
        const isRead = (thread.unread_count ?? 0) === 0;
        handleThreadAction(isRead ? 'unread' : 'read', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'i') {
        e.preventDefault();
        const isImportant = thread.labels?.includes("IMPORTANT") ?? false;
        handleThreadAction(isImportant ? 'notImportant' : 'important', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'f') {
        e.preventDefault();
        handleForward(thread.gmail_thread_id, cardId);
        return;
      }
    }

    // Quick actions on focused event
    const event = getFocusedEvent();
    if (event && cardId) {
      if (e.key === 'r') {
        e.preventDefault();
        openEventQuickReply(event.id);
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
    const target = e.target as HTMLElement;

    // Intercept clicks on links to open in external browser
    const link = target.closest('a') as HTMLAnchorElement | null;
    if (link && link.href) {
      const href = link.href;
      // Only intercept http/https links (not javascript:, mailto:, etc.)
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault();
        e.stopPropagation();
        openUrl(href);
        return;
      }
    }

    // Close account chooser when clicking outside
    if (accountChooserOpen() && !target.closest('.account-chooser-container')) {
      setAccountChooserOpen(false);
    }
  }

  // Insert a freshly authenticated account, replacing any stale entry with the
  // same email (re-login can mint a new account id for the same mailbox)
  function upsertAccount(account: Account) {
    const existing = accounts().find(a => a.email === account.email);
    if (existing) {
      setAccounts(accounts().map(a => (a.email === account.email ? account : a)));
      if (selectedAccount()?.email === account.email) {
        setSelectedAccount(account);
      }
    } else {
      setAccounts([...accounts(), account]);
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
      console.log("Sign in complete, account:", account.id, account.email);
      upsertAccount(account);
      setSelectedAccount(account);

      // Try to restore cards from iCloud (remaps orphaned cards to new account)
      // Small delay to allow iCloud sync to complete
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const icloudResult = await pullFromICloud();
        console.log("iCloud pull result:", icloudResult);
        // If first attempt didn't find cards, try once more after a longer delay
        if (!icloudResult) {
          console.log("No iCloud cards found, retrying...");
          await new Promise(resolve => setTimeout(resolve, 1000));
          const retryResult = await pullFromICloud();
          console.log("iCloud retry result:", retryResult);
        }
      } catch (e) {
        console.warn("iCloud pull failed:", e);
      }

      const cardList = await getCards(account.id);
      console.log("Cards after iCloud pull:", cardList.length, cardList.map(c => c.name));
      setCards(cardList);

      // Show restore prompt if cards exist (restored from iCloud)
      // Otherwise show preset selection for new users
      if (cardList.length > 0) {
        setShowRestorePrompt(true);
      } else {
        console.log("No cards found, showing preset selection");
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

      upsertAccount(account);
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
        // Detect calendar card from query
        const cardType = cardPreset.query.toLowerCase().includes("calendar:") ? "calendar" : "email";
        const card = await createCard(account.id, cardPreset.name, cardPreset.query, cardPreset.color || null, "date", cardType);
        newCards.push(card);
      }

      setCards(newCards);

      // Initialize collapsed state
      const collapsed: Record<string, boolean> = {};
      newCards.forEach(c => { collapsed[c.id] = false; });
      setCollapsedCards(reconcile(collapsed));

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
      await Promise.allSettled(currentCards.map(card => deleteCard(card.id)));
      setCards([]);
      setCollapsedCards(reconcile({}));

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

        upsertAccount(account);
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
      setCardThreads(reconcile({}));
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
      setCollapsedCards(card.id, false);
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

    const form = eventForm();

    if (!form.summary) {
      setEventForm(f => ({ ...f, error: "Title is required" }));
      return;
    }

    setEventForm(f => ({ ...f, saving: true, error: null }));

    const editing = form.editing;

    try {
      let start: number, end: number;
      if (form.allDay) {
        const sParts = form.startDate.split('-');
        start = Date.UTC(parseInt(sParts[0]), parseInt(sParts[1]) - 1, parseInt(sParts[2]), 12, 0, 0);

        const eParts = form.endDate.split('-');
        end = Date.UTC(parseInt(eParts[0]), parseInt(eParts[1]) - 1, parseInt(eParts[2]), 12, 0, 0);
      } else {
        const s = new Date(`${form.startDate}T${form.startTime}`);
        start = s.getTime();
        const e = new Date(`${form.endDate}T${form.endTime}`);
        end = e.getTime();
      }

      const attendeesList = form.attendees
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      const eventInput: EventInput = {
        summary: form.summary,
        description: form.description || null,
        location: form.location || null,
        startTime: start,
        endTime: end,
        allDay: form.allDay,
        attendees: attendeesList.length > 0 ? attendeesList : null,
        recurrence: form.recurrence ? [form.recurrence] : null,
      };

      if (editing) {
        // Update existing event
        await updateCalendarEvent(
          account.id,
          editing.calendarId,
          editing.id,
          eventInput
        );
      } else {
        // Create new event
        await createCalendarEvent(
          account.id,
          null,
          eventInput
        );
      }

      setCreatingEvent(false);
      setEventForm(defaultEventForm());

      // Refresh calendar cards
      cards().forEach(card => {
        if (isCalendarCard(card.id)) {
          fetchAndCacheCalendarEvents(account.id, card.id, card.query);
        }
      });

      showToast(editing ? "Event updated" : "Event created");

    } catch (e) {
      console.error(e);
      setEventForm(f => ({ ...f, error: (editing ? "Failed to update event: " : "Failed to create event: ") + String(e) }));
    } finally {
      setEventForm(f => ({ ...f, saving: false }));
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
      isHtml: composeIsHtml(),
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
      // Convert plain text to HTML if sending as HTML
      let body = pending.body;
      if (pending.isHtml) {
        // Escape HTML entities and convert newlines to <br>
        body = body
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>\n');
        body = `<div>${body}</div>`;
      }

      if (pending.reply) {
        await replyToThread(
          account.id,
          pending.reply.threadId,
          pending.to,
          pending.cc,
          pending.bcc,
          pending.subject,
          body,
          pending.reply.messageId,
          pending.attachments,
          pending.isHtml
        );
      } else {
        await sendEmail(account.id, pending.to, pending.cc, pending.bcc, pending.subject, body, pending.attachments, pending.isHtml);
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
    const threadId = quickReply().threadId;
    const cardId = quickReplyCardId();
    const text = quickReply().text;
    if (!account || !threadId || !cardId || !text.trim()) return;

    // Get thread info for reply
    const threads = getCardThreadsFlat(cardId);
    const thread = threads.find(t => t.gmail_thread_id === threadId);
    if (!thread) return;

    // Get the sender to reply to
    const replyTo = thread.participants[0] || "";
    const subject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;

    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      await replyToThread(account.id, threadId, replyTo, "", "", subject, text, undefined, [], false);
      setQuickReply({ threadId: null, text: "", sending: false });
      setQuickReplyCardId(null);
    } catch (e) {
      console.error("Failed to send reply:", e);
      setError(`Failed to send reply: ${e}`);
    } finally {
      setQuickReply(qr => ({ ...qr, sending: false }));
    }
  }

  async function handleEventQuickReply(event: GoogleCalendarEvent) {
    const account = selectedAccount();
    const text = quickReply().text;
    if (!account || !event.organizer || !text.trim()) return;

    const subject = `Re: ${event.title}`;

    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      await sendEmail(account.id, event.organizer, "", "", subject, text);
      setQuickReplyEventId(null);
      setQuickReply(qr => ({ ...qr, text: "", sending: false }));
      showToast("Reply sent");
    } catch (e) {
      console.error("Failed to send reply:", e);
      setError(`Failed to send reply: ${e}`);
    } finally {
      setQuickReply(qr => ({ ...qr, sending: false }));
    }
  }

  async function handleQuickReaction(threadId: string, emoji: string) {
    const account = selectedAccount();
    if (!account || quickReactionSending()) return;

    setQuickReactionSending(true);

    try {
      // Fetch thread details to get the last message
      const fullThread = await getThreadDetails(account.id, threadId);
      if (!fullThread.messages.length) return;

      const lastMsg = fullThread.messages[fullThread.messages.length - 1];
      const headers = lastMsg.payload?.headers || [];
      const fromHeader = headers.find(h => h.name === 'From')?.value;
      const messageIdHeader = headers.find(h => h.name === 'Message-ID')?.value || lastMsg.id;

      if (!fromHeader) return;

      const toEmail = extractEmail(fromHeader);
      await sendReaction(account.id, threadId, messageIdHeader, emoji, toEmail);
    } catch (e) {
      console.error("Failed to send reaction:", e);
    } finally {
      setQuickReactionSending(false);
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

  function handleReplyFromThread(to: string, cc: string, subject: string, quotedBody: string, messageId: string, isHtml: boolean) {
    const threadId = activeThreadId();
    if (!threadId) return;

    setReplyingToThread({ threadId, messageId });
    setComposeTo(to);
    setComposeCc(cc);
    setComposeBcc("");
    setComposeSubject(subject);
    setComposeBody(quotedBody);
    setComposeIsHtml(isHtml);
    setFocusComposeBody(true);
    setComposing(true);

    const thread = activeThread();
    if (thread) {
      const messageIndex = thread.messages.findIndex(m => m.id === messageId);
      if (messageIndex >= 0) setFocusedMessageIndex(messageIndex);
    }
  }

  function handleForwardFromThread(subject: string, body: string) {
    const threadId = activeThreadId();
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

      const htmlContent = findContent(msg.payload?.parts, 'text/html');
      if (htmlContent) return htmlContent;

      const textContent = findContent(msg.payload?.parts, 'text/plain');
      if (textContent) return `<pre style="white-space: pre-wrap; font-family: inherit;">${textContent}</pre>`;

      return msg.snippet || '(No content)';
    };

    try {
      const results = await Promise.allSettled(
        threadIds.map(async (threadId) => {
          const details = await getThreadDetails(account.id, threadId);
          if (details.messages && details.messages.length > 0) {
            const lastMsg = details.messages[details.messages.length - 1];
            const headers = lastMsg.payload?.headers || [];
            const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
            const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
            const date = lastMsg.internalDate
              ? new Date(parseInt(lastMsg.internalDate)).toLocaleDateString()
              : '';
            return {
              threadId,
              subject,
              snippet: lastMsg.snippet || '',
              body: extractBody(lastMsg),
              from,
              date,
              messageId: lastMsg.id,
              to: extractEmail(from),
            } as BatchReplyThread;
          }
          return null;
        })
      );

      const threads = results
        .filter((r): r is PromiseFulfilledResult<BatchReplyThread | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((t): t is BatchReplyThread => t !== null);

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
      const replySubject = addReplyPrefix(thread.subject);
      await replyToThread(account.id, threadId, thread.to, "", "", replySubject, message, undefined, attachments, false);

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

    await Promise.allSettled(toSend.map(thread => sendBatchReply(thread.threadId)));
  }

  function saveCollapsedState(collapsed: Record<string, boolean>) {
    setCollapsedCards(reconcile(collapsed));
    safeSetJSON("collapsedCards", { ...collapsed });
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
    setEditCardGroupBy(card.group_by || "date");
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
      // Detect card type from query
      const newQuery = editCardQuery();
      const cardType = newQuery.toLowerCase().includes("calendar:") ? "calendar" : "email";
      const updatedCard: Card = {
        ...card,
        name: editCardName(),
        query: newQuery,
        color: editCardColor() || null,
        card_type: cardType,
        group_by: editCardGroupBy(),
      };
      await updateCard(updatedCard);
      setCards(cards().map(c => c.id === cardId ? updatedCard : c));
      setEditingCardId(null);

      // If query changed, clear cache and refresh
      if (queryChanged) {
        await clearCardCache(cardId);
        setCardThreads(produce(s => { delete s[cardId]; }));
        setCardPageTokens(produce(s => { delete s[cardId]; }));
        setCardCalendarEvents(produce(s => { delete s[cardId]; }));
        // Force refresh since we just cleared the cache
        loadCardThreads(cardId, false, true);
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
      const { [cardId]: _, ...remainingCollapsed } = { ...collapsedCards };
      saveCollapsedState(remainingCollapsed);
    } catch (err) {
      console.error("Failed to delete card:", err);
      alert(`Failed to delete card: ${err}`);
    }
  }

  async function toggleCardCollapse(cardId: string) {
    const isCollapsed = collapsedCards[cardId];
    const newCollapsed = { ...collapsedCards, [cardId]: !isCollapsed };
    saveCollapsedState(newCollapsed);

    const account = selectedAccount();
    if (isCollapsed && account && !cardThreads[cardId]) {
      loadCardThreads(cardId);
    }
  }


  async function switchAccount(account: Account) {
    if (selectedAccount()?.id === account.id) return;

    setSelectedAccount(account);
    setCardThreads(reconcile({}));
    setCardCalendarEvents(reconcile({}));

    try {
      const cardList = await getCards(account.id);
      setCards(cardList);

      const savedCollapsed = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
      const collapsed: Record<string, boolean> = {};
      cardList.forEach(c => { collapsed[c.id] = savedCollapsed[c.id] ?? false; });
      setCollapsedCards(reconcile(collapsed));

      for (const card of cardList) {
        if (!collapsed[card.id]) {
          loadCardThreads(card.id);
        }
      }

      fetchContacts(account.id)
        .then(contacts => setGoogleContacts(contacts))
        .catch(e => console.warn("Failed to fetch contacts (user may need to re-auth):", e));
    } catch (e) {
      setError(String(e));
    }
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
    if (append && loadingMore[cardId]) return;

    // Prevent concurrent initial loads (unless force refresh)
    if (!append && !forceRefresh && loadingThreads[cardId]) return;

    if (append) {
      setLoadingMore(cardId, true);
    } else {
      setLoadingThreads(cardId, true);
      setCardErrors(cardId, null);
    }

    try {
      // For initial load (not append), try cache first (unless force refresh)
      if (!append && !forceRefresh) {
        const cached = await getCachedCardThreads(cardId);
        if (cached && cached.groups.length > 0) {
          // Show cached data immediately
          setCardThreads(cardId, cached.groups);
          setCardPageTokens(cardId, cached.next_page_token);
          setCardHasMore(cardId, !!cached.next_page_token);
          // cached_at is in seconds (Unix timestamp), convert to milliseconds
          setLastSyncTimes(cardId, cached.cached_at * 1000);
          setLoadingThreads(cardId, false);

          // Fetch fresh data in background (don't await)
          fetchAndCacheThreads(account.id, cardId);
          return;
        }
      }

      const pageToken = append ? cardPageTokens[cardId] : null;
      const result = await fetchThreadsPaginated(account.id, cardId, pageToken);

      if (append) {
        // Merge new threads into existing groups
        const existingGroups = cardThreads[cardId] || [];
        const mergedGroups = mergeThreadGroups(existingGroups, result.groups);
        setCardThreads(cardId, mergedGroups);
        // Save merged groups to cache
        await saveCachedCardThreads(cardId, mergedGroups, result.next_page_token);
      } else {
        setCardThreads(cardId, result.groups);
        // Save to cache
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      }

      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
    } catch (e) {
      const errorMsg = String(e);
      console.error("loadCardThreads error:", errorMsg);
      // Check for session expiry (token revoked, keyring issues, refresh failures)
      if (errorMsg.includes("Keyring error") ||
          errorMsg.includes("No auth token") ||
          errorMsg.includes("Token refresh failed") ||
          errorMsg.includes("invalid_grant") ||
          errorMsg.includes("unauthorized")) {
        // Only trigger sign out once (prevent race conditions from multiple card loads)
        if (!error()?.includes("Session expired")) {
          setError("Session expired - please sign in again");
          setTimeout(async () => {
            await handleSignOut();
            setError(null);
          }, 1500);
        }
      } else {
        setCardErrors(cardId, errorMsg);
        setSyncErrors(cardId, errorMsg);
      }
    } finally {
      if (append) {
        setLoadingMore(cardId, false);
      } else {
        setLoadingThreads(cardId, false);
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
    if (!forceRefresh && loadingThreads[cardId]) return;

    setLoadingThreads(cardId, true);
    setCardErrors(cardId, null);

    try {
      // For initial load (not force refresh), try cache first
      if (!forceRefresh) {
        const cached = await getCachedCardEvents(cardId);
        if (cached && cached.events.length > 0) {
          // Show cached data immediately
          setCardCalendarEvents(cardId, cached.events);
          // cached_at is in seconds
          setLastSyncTimes(cardId, cached.cached_at * 1000);
          setLoadingThreads(cardId, false);

          // Fetch fresh data in background
          fetchAndCacheCalendarEvents(account.id, cardId, card.query);
          return;
        }
      }

      // No cache or forced refresh - fetch and wait
      await fetchAndCacheCalendarEvents(account.id, cardId, card.query);
    } catch (e) {
      const errorMsg = String(e);
      console.error("loadCalendarEvents error:", errorMsg);
      if (errorMsg.includes("Keyring error") ||
          errorMsg.includes("No auth token") ||
          errorMsg.includes("Token refresh failed") ||
          errorMsg.includes("invalid_grant") ||
          errorMsg.includes("unauthorized")) {
        if (!error()?.includes("Session expired")) {
          setError("Session expired - please sign in again");
          setTimeout(async () => {
            await handleSignOut();
            setError(null);
          }, 1500);
        }
      } else {
        setCardErrors(cardId, errorMsg);
        setSyncErrors(cardId, errorMsg);
      }
    } finally {
      if (!cardCalendarEvents[cardId]) {
        // Only turn off loading if we didn't populate from cache (if we did, it's already off)
        // or if we waited for fetch.
        // Actually, if we populated from cache, we returned early.
        // If we didn't, we are here.
        setLoadingThreads(cardId, false);
      } else {
        // If we have data (from await fetch), ensure loading is off
        setLoadingThreads(cardId, false);
      }
    }
  }

  async function fetchAndCacheCalendarEvents(accountId: string, cardId: string, query: string) {
    try {
      const events = await fetchCalendarEvents(accountId, query);
      setCardCalendarEvents(cardId, events);
      await saveCachedCardEvents(cardId, events);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
    } catch (e) {
      console.error("Failed to fetch calendar events:", e);
      setSyncErrors(cardId, String(e));
      // If foreground load failed, rethrow to be caught by loadCalendarEvents
      if (loadingThreads[cardId]) {
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
      setCardThreads(cardId, result.groups);
      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
    } catch (e) {
      // Background refresh failed - set sync error but keep cached data shown
      setSyncErrors(cardId, String(e));
    }
  }

  function getGroupByForCard(cardId: string): GroupBy {
    const card = cards().find(c => c.id === cardId);
    return card?.group_by || "date";
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

    // All-day events: compare dates only, not times
    if (event.all_day) {
      return formatCalendarEventDate(event.start_time, event.end_time, event.all_day);
    }

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
      // Each label's actual day, for chronological group ordering (sorting by
      // first event start_time misorders groups once multi-day events repeat)
      const groupDays: Record<string, number> = {};

      // Setup date boundaries
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Compare calendar days by components; midnight-to-midnight ms math
      // breaks on DST-transition days (23h/25h)
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

      const labelFor = (day: Date) =>
        sameDay(day, today) ? "Today"
          : sameDay(day, tomorrow) ? "Tomorrow"
            : sameDay(day, yesterday) ? "Yesterday"
              : day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

      const addToDay = (event: GoogleCalendarEvent, day: Date) => {
        const label = labelFor(day);
        if (!groups[label]) {
          groups[label] = [];
          groupDays[label] = day.getTime();
        }
        groups[label].push(event);
      };

      for (const event of events) {
        // First/last calendar day the event covers (local; UTC components for
        // all-day, whose timestamps are UTC midnight with an exclusive end)
        let firstDay: Date;
        let lastDay: Date;
        if (event.all_day) {
          const s = new Date(event.start_time);
          firstDay = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
          if (event.end_time) {
            const e = new Date(event.end_time - 86400000);
            lastDay = new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
          } else {
            lastDay = firstDay;
          }
        } else {
          const s = new Date(event.start_time);
          firstDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
          if (event.end_time && event.end_time > event.start_time) {
            // -1ms so an event ending exactly at midnight stays on its own day
            const e = new Date(event.end_time - 1);
            lastDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
          } else {
            lastDay = firstDay;
          }
        }
        if (lastDay < firstDay) lastDay = firstDay;

        // Ongoing/multi-day events appear under their start day and every
        // remaining day they span from today on (capped so month-long events
        // don't flood the list)
        addToDay(event, firstDay);
        const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 31);
        const from = firstDay < today
          ? today
          : new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 1);
        for (let day = from; day <= lastDay && day <= horizon; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
          addToDay(event, day);
        }
      }

      return Object.entries(groups)
        .map(([label, events]) => ({
          label,
          events: events.sort((a, b) => a.start_time - b.start_time),
        }))
        .sort((a, b) => groupDays[a.label] - groupDays[b.label]);
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
    const threads = cardThreads[cardId];
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
    const events = cardCalendarEvents[cardId];
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
    const groups = cardThreads[cardId];
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
      const savedPath = await saveAttachmentApi(
        account.id,
        messageId,
        attachmentId || null,
        filename,
        mimeType || null,
        inlineData || null
      );
      showToast(`Saved to ${savedPath}`);
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
    if (!target.closest('.quick-reply-box') && !quickReply().text.trim()) {
      setQuickReply(qr => ({ ...qr, threadId: null }));
      setQuickReplyEventId(null);
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
    Object.values(cardThreads).forEach(groups => {
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
          const contacts = contactCandidates();
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
    setCidAttachmentData({});

    // Check if thread is unread and mark as read
    const groups = cardThreads[cardId] || [];
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

      // Fetch CID attachments in background (don't block thread display)
      fetchCidAttachments(account.id, details);
    } catch (e) {
      console.error("Failed to load thread details", e);
      setThreadError("Failed to load email. Please try again.");
    } finally {
      setThreadLoading(false);
    }
  }

  // Fetch CID image attachments for inline display
  async function fetchCidAttachments(accountId: string, thread: FullThread) {
    const cidImages: { messageId: string; attachmentId: string; cid: string }[] = [];

    // Find all CID images in all messages
    for (const msg of thread.messages) {
      const findCidParts = (parts: any[]) => {
        parts?.forEach(part => {
          const contentIdHeader = part.headers?.find((h: any) =>
            h.name?.toLowerCase() === 'content-id'
          );
          if (contentIdHeader && part.mimeType?.startsWith('image/') && part.body?.attachmentId) {
            const cid = contentIdHeader.value?.replace(/^<|>$/g, '') || '';
            if (cid && !part.body?.data) {
              cidImages.push({
                messageId: msg.id,
                attachmentId: part.body.attachmentId,
                cid
              });
            }
          }
          if (part.parts) findCidParts(part.parts);
        });
      };
      findCidParts(msg.payload?.parts || []);
    }

    if (cidImages.length === 0) return;

    // Fetch all CID attachments in parallel
    const results = await Promise.allSettled(
      cidImages.map(async ({ messageId, attachmentId, cid }) => {
        const data = await downloadAttachmentApi(accountId, messageId, attachmentId);
        return { cid, data };
      })
    );

    // Update CID data signal
    const newCidData: Record<string, string> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newCidData[result.value.cid] = result.value.data;
      }
    }
    if (Object.keys(newCidData).length > 0) {
      setCidAttachmentData(prev => ({ ...prev, ...newCidData }));
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
    setToast(prev => ({
      message: message || null,
      visible: true,
      closing: false,
      key: (prev?.key ?? 0) + 1, // Increment key to force remount and restart animation
    }));
    toastTimeoutId = window.setTimeout(() => {
      hideToast();
    }, 5000);
  }

  function hideToast() {
    setToast(t => t ? { ...t, closing: true } : null);
    setTimeout(() => {
      setToast(null);
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
    const updatedCardThreads: Record<string, ThreadGroup[]> = {};

    for (const [cId, groups] of Object.entries(cardThreads)) {
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

    setCardThreads(reconcile(updatedCardThreads));
    setActionsWheelOpen(false);

    // Update cache with optimistic changes
    for (const [cId, groups] of Object.entries(updatedCardThreads)) {
      if (groups) {
        saveCachedCardThreads(cId, groups, cardPageTokens[cId] || null);
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

  return (
    <div class="app" onClick={handleAppClick}>
      {/* Drag region for frameless window */}
      <div class="drag-region" onMouseDown={() => getCurrentWindow().startDragging()}></div>

      {/* Global filter bar - keyboard activated */}
      <div class={`global-filter-bar ${showGlobalFilter() ? 'visible' : ''}`}>
        <div class="global-filter-container">
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
                <Show when={contactCandidates().length > 0}>
                  <div class={`compose-suggestions ${composeFabHovered() ? 'visible' : ''}`}>
                    <For each={contactCandidates().slice(0, 5)}>
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
                            onClick={() => {
                              setAccountChooserOpen(false);
                              switchAccount(account);
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
          <button
            class="auth-settings-btn"
            onClick={() => setSettingsOpen(true)}
            style="margin-top: 24px; background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: var(--font-size-sm);"
          >
            Settings
          </button>
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
                        class={`card ${collapsedCards[card.id] ? 'collapsed' : ''} ${editingCardId() === card.id ? 'editing' : ''}`}
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
                            groupBy={editCardGroupBy()}
                            setGroupBy={setEditCardGroupBy}
                            colorPickerOpen={editColorPickerOpen()}
                            setColorPickerOpen={setEditColorPickerOpen}
                            onSave={saveEditCard}
                            onCancel={cancelEditCard}
                            onDelete={() => handleDeleteCard(card.id)}
                            saveDisabled={!editCardName() || !editCardQuery()}
                            setQueryHelpOpen={setQueryHelpOpen}
                            setQueryInputRef={setQueryInputRef}
                            getQuerySuggestions={getQuerySuggestions}
                            queryAutocompleteOpen={queryAutocompleteOpen}
                            setQueryAutocompleteOpen={setQueryAutocompleteOpen}
                            queryAutocompleteIndex={queryAutocompleteIndex}
                            setQueryAutocompleteIndex={setQueryAutocompleteIndex}
                            updateDropdownPosition={updateDropdownPosition}
                            debounceQueryPreview={debounceQueryPreview}
                            setActiveQueryGetter={setActiveQueryGetter}
                            setActiveQuerySetter={setActiveQuerySetter}
                            applyQuerySuggestion={applyQuerySuggestion}
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
                            <Show when={lastSyncTimes[card.id] && !loadingThreads[card.id]}>
                              {(() => {
                                const state = getSyncState(lastSyncTimes[card.id], currentTime());
                                const hasError = syncErrors[card.id];
                                return (
                                  <span
                                    class={`sync-status ${hasError ? 'sync-error' : ''} ${state === 'fresh' ? 'sync-fresh' : ''} ${state === 'stale' ? 'sync-stale' : ''}`}
                                    title={hasError ? `Sync failed: ${hasError}` : `Last synced: ${formatSyncTime(lastSyncTimes[card.id], currentTime())}`}
                                  >
                                    {hasError ? 'sync failed' : formatSyncTime(lastSyncTimes[card.id], currentTime())}
                                  </span>
                                );
                              })()}
                            </Show>
                            <Show when={getCardUnreadCount(card.id) > 0}>
                              <span class="card-unread-badge">{getCardUnreadCount(card.id)}</span>
                            </Show>
                            <div class="card-actions">
                              <button
                                class={`icon-btn ${loadingThreads[card.id] || loadingMore[card.id] ? 'spinning' : ''} `}
                                onClick={(e) => refreshCard(card.id, e)}
                                disabled={loadingThreads[card.id]}
                                title="Refresh"
                              >
                                <RefreshIcon />
                              </button>
                              <button
                                class="icon-btn"
                                onClick={(e) => startEditCard(card, e)}
                                title="Edit query"
                              >
                                <SearchIcon />
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
                            if (nearBottom && cardHasMore[card.id] && !loadingMore[card.id] && !loadingThreads[card.id]) {
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
                              <For each={groupCalendarEvents(queryPreviewCalendarEvents(), editCardGroupBy())}>
                                {(group) => (
                                  <>
                                    <div class="date-header">{group.label}</div>
                                    <For each={group.events}>
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
                                              {getResponseStatusLabel(event.response_status)}
                                            </div>
                                          </Show>
                                        </div>
                                      )}
                                    </For>
                                  </>
                                )}
                              </For>
                            </Show>
                            {/* Email threads preview */}
                            <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && editCardQuery().trim() && !editCardQuery().toLowerCase().includes("calendar:")}>
                              <div class="empty">No matches</div>
                            </Show>
                            <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                              <For each={regroupThreads(queryPreviewThreads(), editCardGroupBy())}>
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
                                          <div class="thread-snippet">{decodeHtmlEntities(thread.snippet)}</div>
                                          {/* Attachment previews */}
                                          <Show when={thread.attachments?.length > 0 && !thread.calendar_event}>
                                            <div class="thread-attachments">
                                              <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 3)}>
                                                {(attachment) => (
                                                  <img
                                                    class="thread-image-thumb clickable"
                                                    src={`data:${attachment.mime_type};base64,${normalizeBase64Url(attachment.inline_data || '')}`}
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
                            <Show when={loadingThreads[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id]}>
                              <div class="loading">Loading...</div>
                            </Show>
                            <Show when={!loadingThreads[card.id] && cardErrors[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id]}>
                              <div class="card-error">
                                <span class="error-icon">⚠</span>
                                <span class="error-text">{cardErrors[card.id]}</span>
                                <button class="retry-btn" onClick={(e) => refreshCard(card.id, e)}>Try again</button>
                              </div>
                            </Show>

                            {/* Calendar card: show calendar events */}
                            <Show when={card.card_type === "calendar" && cardCalendarEvents[card.id]}>
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
                                          class={`calendar-event-item ${event.response_status === "declined" ? "declined" : ""} ${selectedEvents()[card.id]?.has(event.id) ? "selected" : ""} ${isEventFocused(card.id, event.id) ? "focused" : ""} ${quickReplyEventId() === event.id ? "replying" : ""}`}
                                          onClick={() => openEvent(event, card.id)}
                                          onMouseEnter={() => showEventHoverActions(event.id)}
                                          onMouseLeave={hideEventHoverActions}
                                          tabindex="0"
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
                                              {getResponseStatusLabel(event.response_status)}
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
                                            <Show when={(hoveredEvent() === event.id && eventActionsWheelOpen()) || isEventFocused(card.id, event.id)}>
                                              <ActionsWheel
                                                cardId={card.id}
                                                event={event}
                                                selectedCount={selectedEvents()[card.id]?.has(event.id) ? (selectedEvents()[card.id]?.size || 0) : 0}
                                                open={true}
                                                onClose={() => setEventActionsWheelOpen(false)}
                                                selectedAccount={selectedAccount}
                                                actionSettings={actionSettings}
                                                actionOrder={actionOrder}
                                                eventActionSettings={eventActionSettings}
                                                eventActionOrder={eventActionOrder}
                                                selectedThreads={selectedThreads}
                                                setSelectedThreads={setSelectedThreads}
                                                selectedEvents={selectedEvents}
                                                setSelectedEvents={setSelectedEvents}
                                                openThreadQuickReply={openThreadQuickReply}
                                                openEventQuickReply={openEventQuickReply}
                                                startBatchReply={startBatchReply}
                                                handleForward={handleForward}
                                                handleThreadAction={handleThreadAction}
                                                showToast={showToast}
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
                                              value={quickReply().text}
                                              onChange={(val: string) => setQuickReply(qr => ({ ...qr, text: val }))}
                                              onSend={() => handleEventQuickReply(event)}
                                              onCancel={() => { setQuickReplyEventId(null); setQuickReply(qr => ({ ...qr, text: "" })); }}
                                              disabled={quickReply().sending}
                                              autofocus
                                            />
                                            <div class="quick-reply-actions">
                                              <button class="btn" onClick={() => { setQuickReplyEventId(null); setQuickReply(qr => ({ ...qr, text: "" })); }} disabled={quickReply().sending}>Cancel <span class="shortcut-hint">ESC</span></button>
                                              <ComposeSendButton
                                                onClick={() => handleEventQuickReply(event)}
                                                disabled={!quickReply().text.trim()}
                                                sending={quickReply().sending}
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
                            <Show when={card.card_type !== "calendar" && cardThreads[card.id]}>
                              <Show when={getDisplayGroups(card.id).length === 0}>
                                <div class="empty">All clear</div>
                              </Show>
                              <For each={getDisplayGroups(card.id)}>
                                {(group) => (
                                  <>
                                    <div class="date-header">{group.label}</div>
                                    <For each={group.threads}>
                                      {(thread) => {
                                        // Load RSVP status once per invite row (guarded inside fetchRsvpStatus)
                                        createEffect(() => {
                                          const uid = thread.calendar_event?.uid;
                                          if (thread.calendar_event?.method === "REQUEST" && uid) {
                                            fetchRsvpStatus(thread.gmail_thread_id, uid);
                                          }
                                        });
                                        return (
                                        <>
                                          <div
                                            class={`thread ${thread.unread_count > 0 ? 'unread' : ''} ${selectedThreads()[card.id]?.has(thread.gmail_thread_id) ? 'selected' : ''} ${isThreadFocused(card.id, thread.gmail_thread_id) ? 'focused' : ''} ${quickReply().threadId === thread.gmail_thread_id ? 'replying' : ''}`}
                                            onMouseEnter={() => showThreadHoverActions(thread.gmail_thread_id)}
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
                                                  <div class="calendar-rsvp" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                      class={rsvpStatus[thread.gmail_thread_id] === "accepted" ? "selected" : ""}
                                                      disabled={rsvpLoading[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "yes")}
                                                    >Yes</button>
                                                    <button
                                                      class={rsvpStatus[thread.gmail_thread_id] === "tentative" ? "selected" : ""}
                                                      disabled={rsvpLoading[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "maybe")}
                                                    >Maybe</button>
                                                    <button
                                                      class={rsvpStatus[thread.gmail_thread_id] === "declined" ? "selected" : ""}
                                                      disabled={rsvpLoading[thread.gmail_thread_id]}
                                                      onClick={() => handleRsvp(thread.gmail_thread_id, thread.calendar_event!.uid, "no")}
                                                    >No</button>
                                                  </div>
                                                </Show>
                                              </div>
                                            </Show>
                                            <Show when={!thread.calendar_event}>
                                              <div class="thread-snippet">{decodeHtmlEntities(thread.snippet)}</div>
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
                                                          src={`data:${attachment.mime_type};base64,${normalizeBase64Url(attachment.inline_data || '')}`}
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
                                                  selectedCount={selectedThreads()[card.id]?.has(thread.gmail_thread_id) ? (selectedThreads()[card.id]?.size || 0) : 0}
                                                  open={true}
                                                  onClose={() => setActionsWheelOpen(false)}
                                                  selectedAccount={selectedAccount}
                                                  actionSettings={actionSettings}
                                                  actionOrder={actionOrder}
                                                  eventActionSettings={eventActionSettings}
                                                  eventActionOrder={eventActionOrder}
                                                  selectedThreads={selectedThreads}
                                                  setSelectedThreads={setSelectedThreads}
                                                  selectedEvents={selectedEvents}
                                                  setSelectedEvents={setSelectedEvents}
                                                  openThreadQuickReply={openThreadQuickReply}
                                                  openEventQuickReply={openEventQuickReply}
                                                  startBatchReply={startBatchReply}
                                                  handleForward={handleForward}
                                                  handleThreadAction={handleThreadAction}
                                                  showToast={showToast}
                                                />
                                              </Show>
                                            </div>
                                            <div class="thread-actions-wheel-placeholder"></div>
                                          </div>
                                          <Show when={quickReply().threadId === thread.gmail_thread_id}>
                                            <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                              <ComposeTextarea
                                                class="quick-reply-input"
                                                placeholder="Write a reply..."
                                                value={quickReply().text}
                                                onChange={(val: string) => setQuickReply(qr => ({ ...qr, text: val }))}
                                                onSend={handleQuickReply}
                                                onCancel={() => setQuickReply({ threadId: null, text: "", sending: false })}
                                                disabled={quickReply().sending}
                                                autofocus
                                              />
                                              <div class="quick-reply-actions">
                                                <ReactionButton
                                                  onSelect={(emoji) => handleQuickReaction(thread.gmail_thread_id, emoji)}
                                                  sending={quickReactionSending()}
                                                />
                                                <button class="btn" onClick={() => setQuickReply({ threadId: null, text: "", sending: false })} disabled={quickReply().sending}>Cancel <span class="shortcut-hint">ESC</span></button>
                                                <ComposeSendButton
                                                  onClick={handleQuickReply}
                                                  disabled={!quickReply().text.trim()}
                                                  sending={quickReply().sending}
                                                />
                                              </div>
                                            </div>
                                          </Show>
                                        </>
                                        );
                                      }}
                                    </For>
                                  </>
                                )}
                              </For>
                              {/* Loading more indicator for infinite scroll */}
                              <Show when={loadingMore[card.id]}>
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
                    setQueryHelpOpen={setQueryHelpOpen}
                    setQueryInputRef={setQueryInputRef}
                    getQuerySuggestions={getQuerySuggestions}
                    queryAutocompleteOpen={queryAutocompleteOpen}
                    setQueryAutocompleteOpen={setQueryAutocompleteOpen}
                    queryAutocompleteIndex={queryAutocompleteIndex}
                    setQueryAutocompleteIndex={setQueryAutocompleteIndex}
                    updateDropdownPosition={updateDropdownPosition}
                    debounceQueryPreview={debounceQueryPreview}
                    setActiveQueryGetter={setActiveQueryGetter}
                    setActiveQuerySetter={setActiveQuerySetter}
                    applyQuerySuggestion={applyQuerySuggestion}
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
                      <For each={groupCalendarEvents(queryPreviewCalendarEvents(), newCardGroupBy())}>
                        {(group) => (
                          <>
                            <div class="date-header">{group.label}</div>
                            <For each={group.events}>
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
                                      {getResponseStatusLabel(event.response_status)}
                                    </div>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </>
                        )}
                      </For>
                    </Show>
                    {/* Email threads preview */}
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && newCardQuery().trim() && !newCardQuery().toLowerCase().includes("calendar:")}>
                      <div class="empty">No matches</div>
                    </Show>
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                      <For each={regroupThreads(queryPreviewThreads(), newCardGroupBy())}>
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
                                  <div class="thread-snippet">{decodeHtmlEntities(thread.snippet)}</div>
                                  <Show when={thread.attachments?.length > 0}>
                                    <div class="thread-attachments">
                                      <For each={thread.attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")).slice(0, 3)}>
                                        {(attachment) => (
                                          <img
                                            class="thread-image-thumb"
                                            src={`data:${attachment.mime_type};base64,${normalizeBase64Url(attachment.inline_data || '')}`}
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
          closing={eventForm().closing}
          onClose={closeEventForm}
          summary={eventForm().summary}
          setSummary={(v: string) => setEventForm(f => ({ ...f, summary: v }))}
          description={eventForm().description}
          setDescription={(v: string) => setEventForm(f => ({ ...f, description: v }))}
          location={eventForm().location}
          setLocation={(v: string) => setEventForm(f => ({ ...f, location: v }))}
          startDate={eventForm().startDate}
          setStartDate={(v: string) => setEventForm(f => ({ ...f, startDate: v }))}
          startTime={eventForm().startTime}
          setStartTime={(v: string) => setEventForm(f => ({ ...f, startTime: v }))}
          endDate={eventForm().endDate}
          setEndDate={(v: string) => setEventForm(f => ({ ...f, endDate: v }))}
          endTime={eventForm().endTime}
          setEndTime={(v: string) => setEventForm(f => ({ ...f, endTime: v }))}
          allDay={eventForm().allDay}
          setAllDay={(v: boolean) => setEventForm(f => ({ ...f, allDay: v }))}
          attendees={eventForm().attendees}
          setAttendees={(v: string) => setEventForm(f => ({ ...f, attendees: v }))}
          recurrence={eventForm().recurrence}
          setRecurrence={(v: string | null) => setEventForm(f => ({ ...f, recurrence: v }))}
          saving={eventForm().saving}
          onSave={handleCreateEvent}
          error={eventForm().error}
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
          onClose={() => { setActiveThreadId(null); setActiveThreadCardId(null); setFocusedMessageIndex(0); setLabelDrawerOpen(false); closeCompose(); setCidAttachmentData({}); }}
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
            const groups = cardThreads[cardId] || [];
            for (const group of groups) {
              const thread = group.threads.find(t => t.gmail_thread_id === threadId);
              if (thread) return thread.attachments;
            }
            return undefined;
          })()}
          cidAttachmentData={cidAttachmentData()}
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
            const account = selectedAccount();
            if (!event || !account || rsvpLoading[event.id]) return;
            setRsvpLoading(event.id, true);
            try {
              try {
                await rsvpCalendarEvent(account.id, event.id, status);
              } catch (err) {
                // Google-origin events are looked up by iCalUID, which is "<id>@google.com"
                if (String(err).includes("not found")) {
                  await rsvpCalendarEvent(account.id, `${event.id}@google.com`, status);
                } else {
                  throw err;
                }
              }
              setRsvpStatus(event.id, status);
              setActiveEvent(ev => (ev && ev.id === event.id ? { ...ev, response_status: status } : ev));
              const cardId = activeEventCardId();
              if (cardId && cardCalendarEvents[cardId]) {
                setCardCalendarEvents(cardId, cardCalendarEvents[cardId].map(ev =>
                  ev.id === event.id ? { ...ev, response_status: status } : ev
                ));
              }
              showToast(`Response updated to ${status}`);
            } catch (e) {
              console.error("Failed to update RSVP", e);
              showToast(`Failed to update RSVP: ${e}`);
            } finally {
              setRsvpLoading(event.id, false);
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
          onEdit={() => {
            const event = activeEvent();
            if (!event) return;
            // Pre-fill the event form with current event data
            const startDate = new Date(event.start_time);
            let endDateVal = event.end_time ? new Date(event.end_time) : startDate;
            // All-day end_time is Google's exclusive end (day after the last
            // day); the form's endDate is inclusive, so step back one day
            if (event.all_day && event.end_time) {
              endDateVal = new Date(endDateVal.getTime() - 86400000);
            }
            setEventForm(f => ({
              ...f,
              summary: event.title || '',
              description: event.description || '',
              location: event.location || '',
              startDate: toDateInputString(startDate, event.all_day),
              startTime: startDate.toTimeString().slice(0, 5),
              endDate: toDateInputString(endDateVal, event.all_day),
              endTime: endDateVal.toTimeString().slice(0, 5),
              allDay: event.all_day,
              attendees: event.attendees.map(a => a.email).join(', '),
              recurrence: null, // Recurrence editing not supported yet
              editing: { id: event.id, calendarId: event.calendar_id },
            }));
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
                const currentEvents = cardCalendarEvents[cardId] || [];
                setCardCalendarEvents(cardId, currentEvents.filter(e => e.id !== event.id));
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
          rsvpLoading={!!(activeEvent() && rsvpLoading[activeEvent()!.id])}
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
          inlineEdit={eventForm().editing && activeEvent() && eventForm().editing!.id === activeEvent()!.id ? {
            summary: eventForm().summary,
            setSummary: (v: string) => setEventForm(f => ({ ...f, summary: v })),
            description: eventForm().description,
            setDescription: (v: string) => setEventForm(f => ({ ...f, description: v })),
            location: eventForm().location,
            setLocation: (v: string) => setEventForm(f => ({ ...f, location: v })),
            startDate: eventForm().startDate,
            setStartDate: (v: string) => setEventForm(f => ({ ...f, startDate: v })),
            startTime: eventForm().startTime,
            setStartTime: (v: string) => setEventForm(f => ({ ...f, startTime: v })),
            endDate: eventForm().endDate,
            setEndDate: (v: string) => setEventForm(f => ({ ...f, endDate: v })),
            endTime: eventForm().endTime,
            setEndTime: (v: string) => setEventForm(f => ({ ...f, endTime: v })),
            allDay: eventForm().allDay,
            setAllDay: (v: boolean) => setEventForm(f => ({ ...f, allDay: v })),
            attendees: eventForm().attendees,
            setAttendees: (v: string) => setEventForm(f => ({ ...f, attendees: v })),
            recurrence: eventForm().recurrence,
            setRecurrence: (v: string | null) => setEventForm(f => ({ ...f, recurrence: v })),
            saving: eventForm().saving,
            onSave: handleCreateEvent,
            onClose: () => setEventForm(f => ({ ...f, editing: null })),
            error: eventForm().error,
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
                        focusBody={batchReplyThreads()[0]?.threadId === thread.threadId}
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
                AI-powered reply suggestions via Gemini.
              </p>
              <div class="settings-form-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={geminiApiKey()}
                  onInput={(e) => {
                    setGeminiApiKey(e.currentTarget.value);
                    localStorage.setItem("gemini_api_key", e.currentTarget.value);
                  }}
                  placeholder="AIza..."
                />
              </div>
            </Show>
          </div>
        </div>
        <div class="settings-footer">
          <Show when={selectedAccount()}>
            <button class="signout-btn" onClick={handleSignOut}>Sign out</button>
          </Show>
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

      {/* Undo Toast - For with key forces remount to restart progress bar animation */}
      <For each={toast()?.visible ? [toast()!.key] : []}>
        {() => (
          <div class={`undo-toast ${toast()?.closing ? 'closing' : ''}`}>
            <div class="toast-progress"></div>
            <div class="toast-content">
              <span class="toast-message">{toast()?.message || (lastAction() ? getActionLabel(lastAction()!.action, lastAction()!.threadIds.length) : '')}</span>
              <Show when={!toast()?.message && lastAction()}>
                <button class="toast-undo-btn" onClick={undoLastAction}>Undo <span class="shortcut-hint">z</span></button>
              </Show>
              <button class="toast-close-btn" onClick={hideToast} title="Dismiss">
                <CloseIcon />
              </button>
            </div>
          </div>
        )}
      </For>

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
