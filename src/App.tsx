import { batch, createSignal, onMount, onCleanup, Show, For, Index, createMemo, createEffect, createComputed, on, untrack } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import DOMPurify from 'dompurify';
import { DOMPURIFY_CONFIG } from './components/MessageBody';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
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
  takePendingMailtos,
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
  updateAccountSignature,
  setGeminiApiKey,
  hasGeminiApiKey,
  fetchThreadsPaginated,
  searchThreadsPreview,
  modifyThreads,
  type Account,
  type MailtoData,
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
  formatFileSize,
  formatTime,
  formatSyncTime,
  getSyncState,
  truncateMiddle,
  getInitial,
  extractEmail,
  extractMessageText,
  getAvatarColor,
  validateEmailList,
  formatCalendarEventDate,
  decodeHtmlEntities,
  getResponseStatusLabel,
  normalizeBase64Url,
  addReplyPrefix,
  addForwardPrefix,
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
import { createUndoableSend } from "./app/undoableSend";
import { findHeader, lastMessageFromOthers } from "./app/messages";
import { batchReplyEntry, type BatchReplyThread } from "./app/batchReply";
import { completeRecipient, currentRecipient, matchContacts, rankContacts } from "./app/contacts";
import { eventReplyRecipients } from "./app/eventReply";
import { actionLabel, actionRemovesFromCard, applyThreadAction, labelChangeFor, threadMayJoinCard, undoLabelChanges, type LabelReversal } from "./app/threadActions";
import { PRESETS } from "./app/presets";
import { normalizeActionOrder } from "./app/actionOrder";
import { parseStoredWidth } from "./app/storedWidth";
import { isSessionExpiredError, needsSignInAgain } from "./app/authErrors";
import { withSignature } from "./app/signature";
import { readFilesAsAttachments } from "./app/attachments";
import { eventTimesFromForm, smartEventDefaults } from "./app/eventForm";
import { composePlacement } from "./app/composePlacement";
import { cidImagesToFetch, fetchCidImages } from "./app/cidImages";
import { sendPending, type PendingSend } from "./app/pendingSend";
import { parseMailto } from "./app/mailto";
import { coalesceByKey } from "./app/coalesce";
import { threadLoadErrorMessage } from "./app/loadErrors";
import { cardTypeForQuery } from "./app/cardType";
import { createDraftSync, draftKey, findLatestDraft, hasDraftContent, markDraftClosed, removeAccountDrafts, sessionDraftKey, type DraftFields } from "./app/drafts";
import { nextCardFocus, nextItemFocus } from "./app/keyboardNav";
import { getSmartEventTime, groupCalendarEvents, isUserLabel, mergeThreadGroups, regroupThreads, type CalendarEventGroup } from "./app/grouping";

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
  // The account availableCalendars was loaded for
  let calendarsAccountId: string | null = null;
  let calendarsFetchingFor: string | null = null;

  // Label drawer state
  const [labelDrawerOpen, setLabelDrawerOpen] = createSignal(false);
  const [accountLabels, setAccountLabels] = createSignal<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = createSignal(false);
  const [labelsFailed, setLabelsFailed] = createSignal(false);
  const [labelSearchQuery, setLabelSearchQuery] = createSignal("");

  const [error, setError] = createSignal<string | null>(null);
  const [expiredAccountId, setExpiredAccountId] = createSignal<string | null>(null);
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
  // Ticking clock for relative time displays
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
    accountId: string;
    action: string;
    threadIds: string[];
    cardId: string;
    cardIds: string[]; // every card the optimistic update touched
    reversals: LabelReversal[];
    timestamp: number;
  }
  const [lastAction, setLastAction] = createSignal<UndoableAction | null>(null);
  const [toast, setToast] = createSignal<{
    message: string | null;
    action?: { label: string; run: () => void };
    visible: boolean;
    closing: boolean;
    key: number;
  } | null>(null);
  let toastTimeoutId: number | undefined;
  let toastHideTimeoutId: number | undefined;

  // Undo send state
  const undoableSend = createUndoableSend<PendingSend>({
    delayMs: 5000,
    send: async pending => {
      await sendPending(pending);
      if (pending.draft) drafts.discard(pending.draft.key, pending.accountId, pending.draft.gmailDraftId);
    },
    onFailed: (pending, e) => {
      console.error("Failed to send email:", e);
      restoreSend(pending);
      setError(`Failed to send email: ${e}`);
    },
  });

  // Settings
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);
  const [accountChooserOpen, setAccountChooserOpen] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const MIN_CARD_WIDTH = 250;
  const MAX_CARD_WIDTH = 600;
  const [cardWidth, setCardWidth] = createSignal<number>(
    parseStoredWidth(safeGetItem("cardWidth"), 320, MIN_CARD_WIDTH, MAX_CARD_WIDTH)
  );
  const snippetLines = 5; // Fixed at 5 lines

  // Inline compose resize
  const [inlineResizing, setInlineResizing] = createSignal(false);
  const MIN_MESSAGE_WIDTH = 200;
  const MAX_MESSAGE_WIDTH = 1200;
  const getMaxMessageWidth = () => Math.min(MAX_MESSAGE_WIDTH, window.innerWidth - 96 - 220);
  const [inlineMessageWidth, setInlineMessageWidth] = createSignal<number>(
    parseStoredWidth(safeGetItem("inlineMessageWidth"), 400, MIN_MESSAGE_WIDTH, getMaxMessageWidth())
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
  // Stored settings and orders predate some actions; defaults fill the gaps
  const DEFAULT_ACTION_SETTINGS: ActionSettings = { "archive": false, "star": true, "trash": false, "markRead": true, "markUnread": false, "markImportant": true, "spam": false, "quickReply": true, "quickForward": false };
  const [actionSettings, setActionSettings] = createSignal<Record<string, boolean>>(
    { ...DEFAULT_ACTION_SETTINGS, ...safeGetJSON<ActionSettings>("actionSettings", {}) }
  );
  const DEFAULT_ACTION_ORDER = ["markImportant", "markRead", "star", "quickReply", "quickForward", "archive", "spam", "trash"];
  const [actionOrder, setActionOrder] = createSignal<string[]>(
    normalizeActionOrder(safeGetJSON<unknown>("actionOrder", null), DEFAULT_ACTION_ORDER)
  );
  const [draggingAction, setDraggingAction] = createSignal<string | null>(null);

  // Event action visibility settings
  const DEFAULT_EVENT_ACTION_SETTINGS = { "openCalendar": true, "rsvpYes": true, "rsvpNo": true, "joinMeeting": true, "quickReply": true, "delete": false };
  const [eventActionSettings, setEventActionSettings] = createSignal<Record<string, boolean>>(
    { ...DEFAULT_EVENT_ACTION_SETTINGS, ...safeGetJSON<Record<string, boolean>>("eventActionSettings", {}) }
  );
  const DEFAULT_EVENT_ACTION_ORDER = ["openCalendar", "rsvpYes", "rsvpNo", "joinMeeting", "quickReply", "delete"];
  const [eventActionOrder, setEventActionOrder] = createSignal<string[]>(
    normalizeActionOrder(safeGetJSON<unknown>("eventActionOrder", null), DEFAULT_EVENT_ACTION_ORDER)
  );

  // Background color picker (stores index, not color value)
  const [bgColorPickerOpen, setBgColorPickerOpen] = createSignal(false);
  // A stored index can be stale (BG_COLORS shrank/reordered) or corrupt;
  // render sites dereference BG_COLORS[idx] directly, so validate on load
  function readSavedBgColorIndex(): number | null {
    const raw = safeGetItem("bgColorIndex");
    if (raw === null) return null;
    const idx = parseInt(raw, 10);
    return Number.isInteger(idx) && idx >= 0 && idx < BG_COLORS.length ? idx : null;
  }
  const [selectedBgColorIndex, setSelectedBgColorIndex] = createSignal<number | null>(readSavedBgColorIndex());

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

  // While editing, the card body doubles as a live preview: it keeps showing
  // the card's real content until the draft query diverges from the saved one
  function isPreviewingQuery(cardId: string): boolean {
    if (editingCardId() !== cardId) return false;
    const card = cards().find(c => c.id === cardId);
    if (!card) return false;
    return editCardQuery().trim() !== card.query.trim();
  }

  function effectiveCardType(card: Card): Card["card_type"] {
    if (editingCardId() === card.id) {
      return cardTypeForQuery(editCardQuery());
    }
    return card.card_type;
  }

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
      action: () => forwardAttachment(att),
    });

    const menu = await Menu.new({
      items: [openItem, downloadItem, separator, forwardItem],
    });
    await menu.popup();
  }

  // Attach to the open compose, or start a new email with it
  async function forwardAttachment(
    att: { messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null }
  ) {
    const account = selectedAccount();
    if (!account) return;
    try {
      const data = att.inlineData || await downloadAttachmentApi(account.id, att.messageId, att.attachmentId);
      // The compose that is animating out is done; start a new one
      if (!composing() || closingCompose()) startCompose({});
      setComposeAttachments([...composeAttachments(), { filename: att.filename, mime_type: att.mimeType, data }]);
    } catch (e) {
      console.error("Failed to forward attachment:", e);
      showToast(`Failed to forward ${att.filename}: ${e}`);
    }
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

  // The dropdown floats at app level with fixed coordinates; keep it glued
  // to its input while open (deck/card scrolls are caught via capture phase)
  createEffect(() => {
    if (!queryAutocompleteOpen()) return;
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    onCleanup(() => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    });
  });

  function getCurrentQuery(): string {
    const getter = activeQueryGetter();
    return getter ? getter() : "";
  }

  // Preview requests can resolve out of order; only the latest may render
  let queryPreviewSeq = 0;

  async function fetchQueryPreview(query: string) {
    const seq = ++queryPreviewSeq;

    if (!query.trim()) {
      setQueryPreviewThreads([]);
      setQueryPreviewCalendarEvents([]);
      setQueryPreviewLoading(false);
      return;
    }

    const account = selectedAccount();
    if (!account) {
      setQueryPreviewLoading(false);
      return;
    }

    setQueryPreviewLoading(true);

    // Fetch calendar events for calendar queries
    if (cardTypeForQuery(query) === "calendar") {
      setQueryPreviewThreads([]);
      try {
        const events = await fetchCalendarEvents(account.id, query);
        if (seq !== queryPreviewSeq) return;
        setQueryPreviewCalendarEvents(events);
      } catch {
        if (seq !== queryPreviewSeq) return;
        setQueryPreviewCalendarEvents([]);
      } finally {
        if (seq === queryPreviewSeq) setQueryPreviewLoading(false);
      }
      return;
    }

    // Fetch threads for email queries
    setQueryPreviewCalendarEvents([]);
    try {
      const groups = await searchThreadsPreview(account.id, query);
      if (seq !== queryPreviewSeq) return;
      setQueryPreviewThreads(groups);
    } catch {
      if (seq !== queryPreviewSeq) return;
      setQueryPreviewThreads([]);
    } finally {
      if (seq === queryPreviewSeq) setQueryPreviewLoading(false);
    }
  }

  function debounceQueryPreview(query: string) {
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
    // Loading starts at the debounce, not the fetch, so the window between
    // typing and the request doesn't flash a stale empty state
    setQueryPreviewLoading(true);
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
  // The account a compose was opened in: switching accounts mid-compose must
  // not change the sender or where its draft is saved. A compose opened
  // before any account was signed in adopts the first one.
  const [composeAccount, setComposeAccount] = createSignal<Account | null>(null);
  createComputed(on([composing, selectedAccount], ([open, account], prev) => {
    if (open && (!prev?.[0] || !untrack(composeAccount))) setComposeAccount(account);
  }));
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

  const defaultEventForm = (): EventFormState => {
    const defaults = smartEventDefaults();
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
    const defaults = smartEventDefaults();
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
  const [replyingToThread, setReplyingToThread] = createSignal<{ threadId: string; messageId?: string } | null>(null);
  const [replyingToEvent, setReplyingToEvent] = createSignal<{ eventId: string } | null>(null);
  const [forwardingEvent, setForwardingEvent] = createSignal<{ eventId: string } | null>(null);
  const composeShownIn = createMemo(() => composePlacement({
    composing: composing(),
    activeThreadId: activeThreadId(),
    replyThreadId: replyingToThread()?.threadId,
    forwardThreadId: forwardingThread()?.threadId,
    activeEventId: activeEvent()?.id,
    replyEventId: replyingToEvent()?.eventId,
    forwardEventId: forwardingEvent()?.eventId,
  }));
  const [focusComposeBody, setFocusComposeBody] = createSignal(false);
  const [composeEmailError, setComposeEmailError] = createSignal<string | null>(null);
  const [composeAttachments, setComposeAttachments] = createSignal<SendAttachment[]>([]);
  let fabHoverTimeout: number | undefined;
  let draftSaveTimeout: number | undefined;
  const drafts = createDraftSync();
  // Where the open compose keeps its draft, chosen when it opens
  let composeDraftKey = "";

  function composeDraftFields(): DraftFields {
    return {
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      threadId: replyingToThread()?.threadId,
    };
  }

  function saveDraft() {
    cancelDraftSave();
    const account = composeAccount();
    if (!composing() || closingCompose() || !account) return;
    drafts.save(composeDraftKey, account.id, composeDraftFields());
  }

  // Every edit is kept locally at once, so a quit can't lose it; Gmail gets
  // it once typing pauses
  function handleComposeInput() {
    if (!composing() || closingCompose()) return;
    drafts.saveLocal(composeDraftKey, composeDraftFields());
    clearTimeout(draftSaveTimeout);
    draftSaveTimeout = window.setTimeout(saveDraft, 3000);
  }

  function flushDraftSave() {
    if (draftSaveTimeout !== undefined) saveDraft();
  }

  function cancelDraftSave() {
    clearTimeout(draftSaveTimeout);
    draftSaveTimeout = undefined;
  }

  // The saved draft a compose opening on this target picks up again. A new
  // email only picks up one left behind by a quit, crash or failed sync; one
  // the user closed is in Gmail's Drafts.
  function restorableDraft(group: string, forNewEmail: boolean) {
    return findLatestDraft(group, draft => !forNewEmail || !draft.closed);
  }

  // Batch Reply
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
  const [geminiKeyDraft, setGeminiKeyDraft] = createSignal("");
  const [geminiKeySaved, setGeminiKeySaved] = createSignal(false);
  const [smartRepliesOpen, setSmartRepliesOpen] = createSignal(false);

  // Preset selection for new accounts
  const [showPresetSelection, setShowPresetSelection] = createSignal(false);
  const [showRestorePrompt, setShowRestorePrompt] = createSignal(false);

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
      if (selectedAccount()?.id !== account.id) return;

      // Update sync times for non-collapsed email cards; calendar cards are
      // not touched by Gmail history sync and must not be stamped as synced
      const now = Date.now();
      const nonCollapsedCardIds = cards()
        .filter(c => !collapsedCards[c.id] && c.account_id === account.id && c.card_type !== "calendar")
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

      if (result.is_full_sync) {
        // History ID was reset; incremental results are unusable.
        // Refetch all non-collapsed email cards and go back to fast polling.
        setPollInterval(BASE_POLL_INTERVAL);
        const nonCollapsedCards = cards().filter(c => !collapsedCards[c.id] && c.account_id === account.id && c.card_type !== "calendar");
        for (const card of nonCollapsedCards) {
          fetchAndCacheThreads(account.id, card.id);
        }
      } else if (hasChanges) {
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
      noteBackgroundError(account.id, e);
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
    const cardsWithModified = new Set<string>();
    const cardsWithDeleted = new Set<string>();

    for (const cardId of Object.keys(cardThreads)) {
      const groups = cardThreads[cardId];
      if (!groups) continue;

      const updatedGroups = groups.map(group => {
        let threads = group.threads.filter(t => !deletedThreadIds.includes(t.gmail_thread_id));
        if (threads.length !== group.threads.length) cardsWithDeleted.add(cardId);

        // Update modified threads
        for (const modifiedThread of modifiedThreads) {
          const existingIndex = threads.findIndex(t => t.gmail_thread_id === modifiedThread.gmail_thread_id);
          if (existingIndex >= 0) {
            threads[existingIndex] = modifiedThread;
            matchedThreadIds.add(modifiedThread.gmail_thread_id);
            cardsWithModified.add(cardId);
          }
        }

        return { ...group, threads };
      });

      // Filter out empty groups
      updatedCardThreads[cardId] = updatedGroups.filter(g => g.threads.length > 0);
    }

    setCardThreads(produce(s => { Object.assign(s, updatedCardThreads); }));

    // A modified thread may no longer match its card's query (archived or
    // read elsewhere), and a thread in no card may be new to some card; only
    // the server can tell, so refetch the affected cards in the background
    const account = selectedAccount();
    if (!account) return;
    const unmatched = modifiedThreads.filter(t => !matchedThreadIds.has(t.gmail_thread_id));
    for (const card of cards()) {
      if (card.card_type === "calendar") continue;
      const mayGainThread = unmatched.some(t => threadMayJoinCard(t, card.query));
      if (!collapsedCards[card.id] && (mayGainThread || cardsWithModified.has(card.id))) {
        fetchAndCacheThreads(account.id, card.id);
      } else if (cardsWithDeleted.has(card.id)) {
        saveCachedCardThreads(card.id, updatedCardThreads[card.id], cardPageTokens[card.id] || null)
          .catch(e => console.warn("Failed to update thread cache:", e));
      }
    }
  }

  // Schedule next poll
  let disposed = false;
  function schedulePoll() {
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId);
    }
    pollTimeoutId = window.setTimeout(async () => {
      await performIncrementalSync();
      if (disposed) return; // Unmounted while syncing; don't re-arm
      schedulePoll(); // Schedule next poll after this one completes
    }, pollInterval());
  }

  // Handle window focus - reset to fast polling and sync immediately
  function handleWindowFocus() {
    setPollInterval(BASE_POLL_INTERVAL);
    setCurrentTime(Date.now());
    performIncrementalSync();
    // Re-arm the timer so the fast interval applies now, not after the
    // previously scheduled (possibly backed-off) timeout fires
    schedulePoll();
  }

  // Polling, focus-sync, and contact fetch must start whether the account
  // came from disk at mount or from an OAuth flow later in the session
  let backgroundSyncStarted = false;
  function startBackgroundSync(accountId: string) {
    if (!backgroundSyncStarted) {
      backgroundSyncStarted = true;
      schedulePoll();
      window.addEventListener("focus", handleWindowFocus);
    }
    fetchContacts(accountId)
      .then(contacts => setGoogleContacts(contacts))
      .catch(e => console.warn("Failed to fetch contacts (user may need to re-auth):", e));
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

  // Dock badge: unread threads across cards. The memo only notifies when the
  // total changes, so refreshes that change nothing don't touch the badge.
  const totalUnread = createMemo(() => {
    // A thread can match several cards; count it once
    const unreadThreadIds = new Set<string>();
    for (const groups of Object.values(cardThreads)) {
      for (const group of groups) {
        for (const thread of group.threads) {
          if (thread.unread_count > 0) unreadThreadIds.add(thread.gmail_thread_id);
        }
      }
    }
    return unreadThreadIds.size;
  });
  createEffect(() => {
    const total = totalUnread();
    // undefined removes the badge
    getCurrentWindow().setBadgeCount(total > 0 ? total : undefined).catch(() => {
      // Badge not supported on this platform
    });
  });

  let unlistenMailto: (() => void) | undefined;
  // Hoisted out of onMount so onCleanup can remove them
  let handleResize: (() => void) | undefined;
  let colorSchemeQuery: MediaQueryList | undefined;
  let handleColorSchemeChange: ((e: MediaQueryListEvent) => void) | undefined;

  onMount(async () => {
    document.documentElement.style.setProperty("--card-width", `${cardWidth()}px`);

    // Apply saved inline message width
    document.documentElement.style.setProperty("--inline-message-width", `${inlineMessageWidth()}px`);

    // Constrain inline message width on window resize
    handleResize = () => {
      const maxWidth = getMaxMessageWidth();
      if (inlineMessageWidth() > maxWidth) {
        updateInlineMessageWidth(Math.max(MIN_MESSAGE_WIDTH, maxWidth));
      }
    };
    window.addEventListener("resize", handleResize);

    // Listen for color scheme changes
    colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    handleColorSchemeChange = (e: MediaQueryListEvent) => {
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

    loadGeminiKeyState();

    // Listen for mailto: deep-link events whether or not startup succeeds
    listen<MailtoData>(
      "mailto-received",
      (event) => startCompose(event.payload),
    ).then(unlisten => {
      if (disposed) unlisten();
      else unlistenMailto = unlisten;
    }).catch(e => console.warn("Failed to listen for mailto links:", e));

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
        await loadAccountCards(accts[0]);
        startBackgroundSync(accts[0].id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      // Apply saved background color after UI is rendered
      const savedBgColorIndex = readSavedBgColorIndex();
      if (savedBgColorIndex !== null) {
        setTimeout(() => applyBgColor(savedBgColorIndex), 0);
      }
    }

    // The backend holds links, including the launch link, until they are
    // taken; taking them after startup lets compose pick up the account's
    // signature, and outside the startup try a failed load still opens them
    try {
      for (const mailto of await takePendingMailtos()) startCompose(mailto);
    } catch (e) {
      console.warn("mailto links unavailable:", e);
    }
  });

  const timeUpdateInterval = setInterval(() => setCurrentTime(Date.now()), 15000);

  onCleanup(() => {
    disposed = true;
    if (pollTimeoutId) {
      clearTimeout(pollTimeoutId);
    }
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
    }
    clearInterval(timeUpdateInterval);
    window.removeEventListener("focus", handleWindowFocus);
    if (handleResize) window.removeEventListener("resize", handleResize);
    if (handleColorSchemeChange) colorSchemeQuery?.removeEventListener("change", handleColorSchemeChange);
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
      const cardId = focusedCardId();
      const focusedCard = cardId ? document.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`)?.closest('.card-wrapper') : null;
      focusedCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      const focused = document.querySelector('.thread.focused, .calendar-event-item.focused');
      focused?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }

  // Focus a card and the item at `index` in it (-1 focuses the card only)
  function focusCardItem(cardId: string, index: number) {
    setFocusedCardId(cardId);
    const calendar = isCalendarCard(cardId);
    setFocusedEventIndex(calendar ? index : -1);
    setFocusedThreadIndex(calendar ? -1 : index);
    scrollFocusedIntoView();
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

    // Cmd/Ctrl+Enter to save card when editing
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (editingCardId() && editCardName() && editCardQuery() && !activeThreadId() && !activeEvent()) {
        e.preventDefault();
        saveEditCard();
      }
      return;
    }

    // Everything below is a bare-key shortcut; Cmd/Ctrl/Alt combos (Cmd+A
    // select-all, system shortcuts) must never trigger thread/card actions
    if (e.metaKey || e.ctrlKey || e.altKey) {
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

    // Same for modals and panels over the cards; Escape still closes them
    const overlayOpen = settingsOpen() || shortcutsHelpOpen() || queryHelpOpen() || creatingEvent() || showPresetSelection() || showRestorePrompt();
    if (overlayOpen && e.key !== 'Escape') {
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

    // c to compose new email
    if (e.key === 'c') {
      e.preventDefault();
      if (!composing() || closingCompose()) startCompose({});
      return;
    }

    if (e.key === 'Escape') {
      // Priority: filter > dropdowns > color pickers > shortcuts help > batch reply > compose > query help > event form > card editing > sidebar > action menu > selection > focus
      if (showGlobalFilter()) {
        setShowGlobalFilter(false);
        setGlobalFilter("");
      } else if (accountChooserOpen()) {
        setAccountChooserOpen(false);
      } else if (colorPickerOpen() || editColorPickerOpen() || bgColorPickerOpen()) {
        setColorPickerOpen(false);
        setEditColorPickerOpen(false);
        setBgColorPickerOpen(false);
      } else if (shortcutsHelpOpen()) {
        setShortcutsHelpOpen(false);
      } else if (batchReplyOpen()) {
        closeBatchReply();
      } else if (composing() && !closingCompose()) {
        closeCompose();
      } else if (queryHelpOpen()) {
        setQueryHelpOpen(false);
      } else if (creatingEvent()) {
        closeEventForm();
      } else if (editingCardId()) {
        setEditingCardId(null);
      } else if (settingsOpen()) {
        setSettingsOpen(false);
      } else if (actionConfigMenu()) {
        setActionConfigMenu(null);
      } else if (focusedCardId() && (selectedThreads()[focusedCardId()!]?.size || selectedEvents()[focusedCardId()!]?.size)) {
        const cardId = focusedCardId()!;
        setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
        setSelectedEvents({ ...selectedEvents(), [cardId]: new Set() });
      } else if (focusedCardId()) {
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
        setFocusedEventIndex(-1);
      }
      return;
    }

    // Card navigation - h/l/ArrowLeft/ArrowRight for left/right between cards
    if (e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cardIds = cards().filter(c => !collapsedCards[c.id]).map(c => c.id);
      const move = nextCardFocus(cardIds, focusedCardId(), e.key === 'l' || e.key === 'ArrowRight', addingCard());
      if (!move) return;
      if (move.addingCard && !addingCard()) {
        setNewCardColor(null);
        setQueryPreviewThreads([]);
        setQueryPreviewCalendarEvents([]);
        setQueryPreviewLoading(false);
      }
      setAddingCard(move.addingCard);
      if (move.cardId) {
        focusCardItem(move.cardId, 0);
      } else {
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
        setFocusedEventIndex(-1);
      }
      return;
    }

    // Item navigation - j/k/ArrowUp/ArrowDown for up/down within cards (threads or events)
    if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const visible = cards().filter(c => !collapsedCards[c.id]).map(c => ({
        id: c.id,
        count: (isCalendarCard(c.id) ? getCardEventsFlat(c.id) : getCardThreadsFlat(c.id)).length,
      }));
      const cardId = focusedCardId();
      const current = cardId ? { cardId, index: isCalendarCard(cardId) ? focusedEventIndex() : focusedThreadIndex() } : null;
      const next = nextItemFocus(visible, current, e.key === 'j' || e.key === 'ArrowDown');
      if (next) focusCardItem(next.cardId, next.index);
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
      if (e.key === '!') {
        e.preventDefault();
        handleThreadAction('spam', [thread.gmail_thread_id], cardId);
        return;
      }
      if (e.key === 'x') {
        e.preventDefault();
        toggleThreadSelection(cardId, thread.gmail_thread_id);
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
    cancelDraftSave();
  });

  function handleGlobalClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Web links open in the browser and mailto links in compose. Links in an
    // email must never navigate the app's own page; the app's links (href="#")
    // are left to their own handlers.
    const link = target.closest('a') as HTMLAnchorElement | null;
    if (link && link.href && !e.defaultPrevented) {
      const inEmail = !!link.closest('.message-body');
      if (link.protocol === 'mailto:') {
        e.preventDefault();
        startCompose(parseMailto(link.href));
        return;
      }
      if ((link.protocol === 'http:' || link.protocol === 'https:') && link.origin !== window.location.origin) {
        e.preventDefault();
        e.stopPropagation();
        openUrl(link.href);
        return;
      }
      if (inEmail) {
        e.preventDefault();
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

  // Post-OAuth: restore the account's layout from iCloud (sync can lag, so pull
  // once, then retry after a longer delay if the first pull found nothing) and
  // only offer the preset picker when no layout exists.
  async function restoreLayoutAfterAuth(account: Account) {
    upsertAccount(account);
    setSelectedAccount(account);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const icloudResult = await pullFromICloud();
      if (!icloudResult) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await pullFromICloud();
      }
    } catch (e) {
      console.warn("iCloud pull failed:", e);
    }

    const cardList = await loadAccountCards(account);
    if (!cardList) return;
    startBackgroundSync(account.id);

    if (cardList.length > 0) {
      setShowRestorePrompt(true);
    } else {
      setShowPresetSelection(true);
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
      await restoreLayoutAfterAuth(account);
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

      await loadAccountCards(account);
      startBackgroundSync(account.id);

      setSettingsOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setAuthLoading(false);
    }
  }

  let applyingPreset = false;
  async function applyPreset(presetKey: string) {
    const account = selectedAccount();
    const preset = PRESETS[presetKey];
    if (!account || !preset || applyingPreset) return;

    applyingPreset = true;
    const newCards: Card[] = [];
    try {
      for (const cardPreset of preset.cards) {
        const cardType = cardTypeForQuery(cardPreset.query);
        newCards.push(await createCard(account.id, cardPreset.name, cardPreset.query, cardPreset.color || null, "date", cardType));
      }
    } catch (e) {
      setError(String(e));
      // Nothing was created: stay on the picker so the user can retry
      if (newCards.length === 0) return;
    } finally {
      applyingPreset = false;
    }

    // Show whatever was created, even if a later card failed: the created
    // ones are already stored, and hiding them invites duplicates on retry
    setCards(newCards);
    setCollapsedCards(reconcile(Object.fromEntries(newCards.map(c => [c.id, false]))));
    setShowPresetSelection(false);
    newCards.forEach(card => loadCardThreads(card.id));
  }

  async function handleStartFresh() {
    const currentCards = cards();
    const count = `${currentCards.length} card${currentCards.length === 1 ? "" : "s"}`;
    if (currentCards.length > 0 && !confirm(`Delete the restored layout's ${count}? This can't be undone.`)) return;
    const results = await Promise.allSettled(currentCards.map(card => deleteCard(card.id)));
    // Cards that failed to delete still exist; keep showing them rather than
    // letting a preset pile new cards on top
    const remaining = currentCards.filter((_, i) => results[i].status === "rejected");
    setCards(remaining);
    setCollapsedCards(reconcile(Object.fromEntries(remaining.map(c => [c.id, collapsedCards[c.id] ?? false]))));

    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      setError(`Failed to reset layout: ${failure.reason}`);
      return;
    }
    setShowRestorePrompt(false);
    setShowPresetSelection(true);
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
        await restoreLayoutAfterAuth(account);
      } catch (e) {
        setError(String(e));
      } finally {
        setAuthLoading(false);
      }
    } catch (e) {
      setError(`Failed to save credentials: ${e}`);
    }
  }

  async function saveSignature(account: Account, text: string) {
    const signature = text.trim() ? text : null;
    try {
      await updateAccountSignature(account.id, signature);
      const updated = { ...account, signature };
      setAccounts(accounts().map(a => (a.id === account.id ? updated : a)));
      if (selectedAccount()?.id === account.id) setSelectedAccount(updated);
    } catch (e) {
      setError(`Failed to save signature: ${e}`);
    }
  }

  async function handleSignOut() {
    const account = selectedAccount();
    if (!account) return;
    if (!confirm(`Sign out of ${account.email}? Its cards and the drafts saved on this computer are removed.`)) return;

    const signedOutCards = cards();
    try {
      await deleteAccount(account.id);
      closeAccountViews();
      const remaining = accounts().filter(a => a.id !== account.id);
      setAccounts(remaining);
      setSelectedAccount(null);
      setCards([]);
      setCardThreads(reconcile({}));
      setAccountLabels([]);
      const collapsed = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
      for (const card of signedOutCards) delete collapsed[card.id];
      safeSetJSON("collapsedCards", collapsed);
      removeAccountDrafts(account.id);
      // Fall through to the next account instead of a blank screen
      if (remaining.length > 0) {
        await switchAccount(remaining[0]);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAddCard() {
    const account = selectedAccount();
    if (!account || !newCardName() || !newCardQuery()) return;

    try {
      const query = newCardQuery();
      const cardType = cardTypeForQuery(query);

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

  // One object per view, read through getters, so typing updates the inline
  // compose in place instead of handing the view a new object per keystroke
  function inlineComposeProps(target: { replyToMessageId: () => string | null; isForward: () => boolean; onClose: () => void }) {
    return {
      get replyToMessageId() { return target.replyToMessageId(); },
      get isForward() { return target.isForward(); },
      get to() { return composeTo(); },
      setTo: setComposeTo,
      get cc() { return composeCc(); },
      setCc: setComposeCc,
      get bcc() { return composeBcc(); },
      setBcc: setComposeBcc,
      get showCcBcc() { return showCcBcc(); },
      setShowCcBcc: setShowCcBcc,
      get body() { return composeBody(); },
      setBody: setComposeBody,
      get attachments() { return composeAttachments(); },
      onRemoveAttachment: removeAttachment,
      onFileSelect: handleFileSelect,
      get error() { return composeEmailError(); },
      get draftSaving() { return drafts.saving(); },
      get draftSaved() { return drafts.saved(); },
      onSend: handleSendEmail,
      onClose: target.onClose,
      onInput: handleComposeInput,
      get focusBody() { return focusComposeBody(); },
      get resizing() { return inlineResizing(); },
      onResizeStart: handleInlineResizeStart,
    };
  }
  const threadInlineCompose = inlineComposeProps({
    replyToMessageId: () => replyingToThread()?.messageId || null,
    isForward: () => !!forwardingThread(),
    onClose: closeCompose,
  });
  const eventInlineCompose = inlineComposeProps({
    replyToMessageId: () => null,
    isForward: () => !!forwardingEvent(),
    onClose: () => { closeCompose(); setReplyingToEvent(null); setForwardingEvent(null); },
  });

  // Cancelled by resetCompose when a new compose replaces one animating out
  let closeComposeTimeout: number | undefined;
  // Closing keeps a draft the user wrote in (saved in Gmail's Drafts too) and
  // offers to discard it; a compose never typed in leaves nothing behind
  function closeCompose() {
    if (closingCompose()) return;
    flushDraftSave();
    const key = composeDraftKey;
    const accountId = composeAccount()?.id;
    const keep = hasDraftContent(composeDraftFields()) && safeGetItem(key) !== null;
    setClosingCompose(true);
    if (keep) {
      markDraftClosed(key);
      drafts.detach();
      showToast("Draft saved", { label: "Discard", run: () => { if (accountId) drafts.discard(key, accountId); } });
    } else {
      drafts.clear(key, accountId);
    }
    closeComposeTimeout = window.setTimeout(resetCompose, 200);
  }

  // A sent email's draft stays saved until the send goes out
  function closeComposeAfterSend() {
    setClosingCompose(true);
    drafts.detach();
    closeComposeTimeout = window.setTimeout(resetCompose, 200);
  }

  // Open compose with these fields. Nothing of a compose that is already open
  // (reply target, attachments, HTML mode) carries over.
  function startCompose(init: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    isHtml?: boolean;
    reply?: { threadId: string; messageId?: string };
    forward?: { threadId: string; subject: string; body: string };
    replyEvent?: { eventId: string };
    forwardEvent?: { eventId: string };
    focusBody?: boolean;
    // False when putting back an email that already has its signature
    signature?: boolean;
    // Defaults to the selected account
    accountId?: string;
    // Continue this saved draft instead of looking for one
    draftKey?: string;
  }) {
    if (composing() || closingCompose()) resetCompose();
    const accountId = init.accountId ?? selectedAccount()?.id;
    const group = draftKey(accountId, {
      replyThreadId: init.reply?.threadId,
      forwardThreadId: init.forward?.threadId,
      replyEventId: init.replyEvent?.eventId,
      forwardEventId: init.forwardEvent?.eventId,
    });
    const isNewEmail = !init.reply && !init.forward && !init.replyEvent && !init.forwardEvent;
    const prefilled = !!(init.to || init.subject || init.body);
    const saved = init.draftKey || (isNewEmail && prefilled) ? null : restorableDraft(group, isNewEmail);
    composeDraftKey = init.draftKey ?? saved?.key ?? sessionDraftKey(group);
    if (init.draftKey || saved) drafts.load(composeDraftKey);
    const fields = saved?.draft ?? init;
    batch(() => {
      setReplyingToEvent(init.replyEvent ?? null);
      setForwardingEvent(init.forwardEvent ?? null);
      setReplyingToThread(init.reply ?? null);
      setForwardingThread(init.forward ?? null);
      setComposeTo(fields.to ?? "");
      setComposeCc(fields.cc ?? "");
      setComposeBcc(fields.bcc ?? "");
      setShowCcBcc(!!(fields.cc || fields.bcc));
      setComposeSubject(fields.subject ?? "");
      const body = fields.body ?? "";
      setComposeBody(saved || init.signature === false ? body : withSignature(body, selectedAccount()?.signature));
      setComposeIsHtml(!!init.isHtml);
      setFocusComposeBody(!!init.focusBody);
      setComposing(true);
    });
  }

  // Batched so an open compose goes away in one step instead of re-rendering
  // through half-cleared states (e.g. a reply form once the forward is gone)
  function resetCompose() {
    clearTimeout(closeComposeTimeout);
    closeComposeTimeout = undefined;
    flushDraftSave();
    drafts.detach();
    batch(() => {
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
      setComposeIsHtml(false);
      setComposing(false);
      setClosingCompose(false);
    });
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const { attachments, skipped } = await readFilesAsAttachments(Array.from(input.files));
    if (skipped.length > 0) {
      setComposeEmailError(`Skipped: ${skipped.join(', ')}`);
    }
    if (attachments.length > 0) {
      setComposeAttachments([...composeAttachments(), ...attachments]);
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

    const times = eventTimesFromForm(form);
    if ("error" in times) {
      setEventForm(f => ({ ...f, error: times.error }));
      return;
    }

    setEventForm(f => ({ ...f, saving: true, error: null }));

    const editing = form.editing;

    try {
      const attendeesList = form.attendees
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      const eventInput: EventInput = {
        summary: form.summary,
        description: form.description || null,
        location: form.location || null,
        startTime: times.start,
        endTime: times.end,
        allDay: form.allDay,
        attendees: attendeesList.length > 0 ? attendeesList : null,
        recurrence: form.recurrence ? [form.recurrence] : null,
      };

      if (editing) {
        // Update existing event
        const updated = await updateCalendarEvent(
          account.id,
          editing.calendarId,
          editing.id,
          eventInput
        );
        // Sync the open EventView and the card's copy immediately; the
        // background refetch below lands later
        setActiveEvent(ev => (ev && ev.id === updated.id ? updated : ev));
        updateEventInCards(updated.id, () => updated);
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
    const account = composeAccount();
    if (!account || !composeTo().trim()) return;
    // A send was just queued and compose is animating out with its fields
    // still populated; a second click/Cmd+Enter must not queue a duplicate
    if (closingCompose()) return;

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

    // Queue the send with undo capability. Capture the account now so
    // switching accounts during the undo window can't change the sender.
    const pending: PendingSend = {
      accountId: account.id,
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      attachments: [...composeAttachments()],
      reply: replyingToThread() ? { ...replyingToThread()! } : undefined,
      isHtml: composeIsHtml(),
    };

    // Saved locally as sent, so a quit during the undo window leaves it as a
    // draft rather than losing it
    cancelDraftSave();
    drafts.saveLocal(composeDraftKey, composeDraftFields());
    pending.draft = { key: composeDraftKey, gmailDraftId: drafts.gmailDraftId() ?? undefined };
    closeComposeAfterSend();
    undoableSend.queue(pending);
  }

  // Compose closed when the send was queued, so an undone or failed send puts
  // the email back, continuing its saved draft
  function restoreSend(pending: PendingSend) {
    startCompose({
      to: pending.to,
      cc: pending.cc,
      bcc: pending.bcc,
      subject: pending.subject,
      body: pending.body,
      isHtml: pending.isHtml,
      reply: pending.reply,
      signature: false,
      accountId: pending.accountId,
      draftKey: pending.draft?.key,
    });
    setComposeAttachments(pending.attachments);
    setComposeAccount(accounts().find(a => a.id === pending.accountId) ?? null);
  }

  function undoSend() {
    const pending = undoableSend.undo();
    if (pending) restoreSend(pending);
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

    const subject = addReplyPrefix(thread.subject);

    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      // The thread list lacks Reply-To and who wrote last; the full thread has both
      const details = await getThreadDetails(account.id, threadId);
      const entry = batchReplyEntry(threadId, details.messages ?? [], account.email);
      if (!entry?.to) {
        showToast("No one else to reply to");
        return;
      }
      await replyToThread(account.id, threadId, entry.to, "", "", subject, text, entry.messageId, [], false);
      setQuickReply({ threadId: null, text: "", sending: false });
      setQuickReplyCardId(null);
      showToast("Reply sent");
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
    if (!account || !text.trim()) return;
    const { to } = eventReplyRecipients(event, account.email);
    if (!to) {
      showToast("No one else to reply to");
      return;
    }

    const subject = addReplyPrefix(event.title);

    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      await sendEmail(account.id, to, "", "", subject, text);
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
      const fullThread = await getThreadDetails(account.id, threadId);
      const target = lastMessageFromOthers(fullThread.messages, account.email);
      const fromHeader = target && findHeader(target.payload?.headers, 'From');
      const toEmail = fromHeader ? extractEmail(fromHeader) : "";
      // Only the user's own messages: a reaction would go to themselves
      if (!target || !toEmail || toEmail.toLowerCase() === account.email.toLowerCase()) {
        showToast("No one else to react to");
        return;
      }
      const messageIdHeader = findHeader(target.payload?.headers, 'Message-ID') || target.id;

      await sendReaction(account.id, threadId, messageIdHeader, emoji, toEmail);
    } catch (e) {
      console.error("Failed to send reaction:", e);
      showToast(`Failed to send reaction: ${e}`);
    } finally {
      setQuickReactionSending(false);
    }
  }

  async function handleForward(threadId: string, cardId: string) {
    // Find the thread
    const threads = getCardThreadsFlat(cardId);
    const thread = threads.find(t => t.gmail_thread_id === threadId);
    if (!thread) return;

    // Build forwarded subject and body
    const fwdSubject = addForwardPrefix(thread.subject);

    // Quote the full last message like the ThreadView forward path; fall
    // back to the snippet if the fetch fails
    let from = thread.participants[0] || 'Unknown';
    let date = '';
    let body = thread.snippet;
    const account = selectedAccount();
    if (account) {
      try {
        const details = await getThreadDetails(account.id, threadId);
        const lastMsg = details.messages[details.messages.length - 1];
        if (lastMsg) {
          from = findHeader(lastMsg.payload?.headers, 'From') || from;
          date = findHeader(lastMsg.payload?.headers, 'Date') || '';
          body = extractMessageText(lastMsg.payload, lastMsg.snippet);
        }
      } catch (e) {
        console.error("Failed to fetch thread for forward:", e);
      }
    }
    const quotedBody = `\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${date}\nSubject: ${thread.subject}\n\n${body}`;

    startCompose({
      subject: fwdSubject,
      body: quotedBody,
      forward: { threadId, subject: fwdSubject, body: quotedBody },
    });
  }

  function handleReplyFromThread(to: string, cc: string, subject: string, quotedBody: string, messageId: string | undefined, isHtml: boolean) {
    const threadId = activeThreadId();
    if (!threadId) return;

    startCompose({ to, cc, subject, body: quotedBody, isHtml, reply: { threadId, messageId }, focusBody: true });

    const thread = activeThread();
    if (thread && messageId) {
      // ThreadView may report either the Gmail API id or the RFC Message-ID
      const messageIndex = thread.messages.findIndex(m =>
        m.id === messageId ||
        findHeader(m.payload?.headers, 'Message-ID') === messageId
      );
      if (messageIndex >= 0) setFocusedMessageIndex(messageIndex);
    }
  }

  function handleForwardFromThread(subject: string, body: string) {
    startCompose({ subject, body, forward: { threadId: activeThreadId() || '', subject, body } });
  }

  // Label drawer functions
  let labelsAccountId: string | null = null;
  let labelsFetchingFor: string | null = null;
  async function fetchAccountLabels() {
    const account = selectedAccount();
    if (!account) return;

    // Clear cache if account changed
    if (labelsAccountId !== account.id) {
      setAccountLabels([]);
      labelsAccountId = account.id;
    }

    if (accountLabels().length > 0) return; // Already cached
    if (labelsFetchingFor === account.id) return;

    labelsFetchingFor = account.id;
    setLabelsLoading(true);
    setLabelsFailed(false);
    try {
      const labels = await listLabels(account.id);
      if (selectedAccount()?.id !== account.id) return;
      // Sort: user labels first (alphabetically), then system labels
      const sorted = labels.sort((a, b) => {
        if (a.label_type === 'user' && b.label_type !== 'user') return -1;
        if (a.label_type !== 'user' && b.label_type === 'user') return 1;
        return a.name.localeCompare(b.name);
      });
      setAccountLabels(sorted);
    } catch (e) {
      console.error("Failed to fetch labels:", e);
      if (selectedAccount()?.id === account.id) setLabelsFailed(true);
    } finally {
      if (labelsFetchingFor === account.id) labelsFetchingFor = null;
      setLabelsLoading(false);
    }
  }

  const labelNames = createMemo(() => Object.fromEntries(accountLabels().map(l => [l.id, l.name])));

  // "Group by label" shows label names, which only the label list carries
  createEffect(() => {
    if (!selectedAccount()) return;
    const wantsLabels = cards().some(c => c.group_by === "label")
      || (editingCardId() !== null && editCardGroupBy() === "label")
      || (addingCard() && newCardGroupBy() === "label");
    if (wantsLabels) untrack(fetchAccountLabels);
  });

  // Calendar drawer functions (for events)
  async function fetchAvailableCalendars() {
    const account = selectedAccount();
    if (!account) return;

    if (calendarsAccountId !== account.id) {
      setAvailableCalendars([]);
      calendarsAccountId = account.id;
    }

    if (availableCalendars().length > 0) return; // Already cached
    if (calendarsFetchingFor === account.id) return;

    calendarsFetchingFor = account.id;
    setCalendarsLoading(true);
    try {
      const calendars = await listCalendars(account.id);
      if (selectedAccount()?.id !== account.id) return;
      // Sort: primary first, then alphabetically
      const sorted = calendars.sort((a, b) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return a.name.localeCompare(b.name);
      });
      setAvailableCalendars(sorted);
    } catch (e) {
      console.error("Failed to fetch calendars:", e);
      if (selectedAccount()?.id === account.id) showToast("Failed to load calendars");
    } finally {
      if (calendarsFetchingFor === account.id) calendarsFetchingFor = null;
      if (selectedAccount()?.id === account.id) setCalendarsLoading(false);
    }
  }

  // An event can show in several calendar cards; change every copy, and each
  // card's saved cache, so none of them shows the old state until a refetch.
  // `update` returning null removes the event.
  function updateEventInCards(eventId: string, update: (ev: GoogleCalendarEvent) => GoogleCalendarEvent | null) {
    for (const [cId, events] of Object.entries(cardCalendarEvents)) {
      if (!events?.some(e => e.id === eventId)) continue;
      const next = events.flatMap(e => (e.id === eventId ? update(e) ?? [] : [e]));
      setCardCalendarEvents(cId, next);
      saveCachedCardEvents(cId, next).catch(e => console.warn("Failed to update event cache:", e));
    }
  }

  function markEventRsvp(eventId: string, status: string) {
    setActiveEvent(ev => (ev && ev.id === eventId ? { ...ev, response_status: status } : ev));
    updateEventInCards(eventId, ev => ({ ...ev, response_status: status }));
  }

  async function deleteEvent(event: GoogleCalendarEvent) {
    const account = selectedAccount();
    if (!account) return;
    try {
      await deleteCalendarEvent(account.id, event.calendar_id, event.id);
      updateEventInCards(event.id, () => null);
      showToast('Event deleted');
      if (activeEvent()?.id === event.id) closeEvent();
    } catch (e) {
      console.error('Failed to delete event:', e);
      showToast(String(e));
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

      // The cards' copies must pick up the new calendar_id too, or a later
      // delete/edit from a card targets the old calendar and 404s
      updateEventInCards(event.id, () => movedEvent);
      cards().forEach(card => {
        if (isCalendarCard(card.id)) {
          fetchAndCacheCalendarEvents(account.id, card.id, card.query);
        }
      });

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
    return getCurrentThreadLabels().filter(isUserLabel).length;
  }

  async function handleThreadViewAction(action: string) {
    const thread = activeThread();
    const account = selectedAccount();
    const cardId = activeThreadCardId();
    if (!thread || !account) return;

    // Close thread view after action (except for read/unread/important)
    const shouldClose = ['archive', 'inbox', 'trash', 'spam'].includes(action);

    await handleThreadAction(action, [thread.id], cardId || '');
    if (activeThreadId() !== thread.id) return;

    if (shouldClose) {
      closeThreadView();
    } else {
      await refreshActiveThread(account.id, thread.id);
    }
  }

  // Reload the open thread after changing it; the user may have opened
  // another one meanwhile, which must stay
  async function refreshActiveThread(accountId: string, threadId: string) {
    try {
      const updated = await getThreadDetails(accountId, threadId);
      if (activeThreadId() === threadId) setActiveThread(updated);
    } catch (e) {
      console.error("Failed to refresh thread:", e);
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
      await refreshActiveThread(account.id, thread.id);
      showToast(`${isAdding ? 'Added' : 'Removed'} label "${labelName}"`);
    } catch (e) {
      console.error("Failed to modify labels:", e);
      setError(`Failed to ${isAdding ? 'add' : 'remove'} label: ${e}`);
    }
  }

  // Bumped on every open and close so a slow load can't fill a batch that
  // was closed or reopened for other threads
  let batchReplyRequest = 0;
  async function startBatchReply(cardId: string, threadIds: string[]) {
    const account = selectedAccount();
    if (!account || threadIds.length === 0) return;

    const request = ++batchReplyRequest;
    setBatchReplyLoading(true);
    setBatchReplyOpen(true);
    setBatchReplyCardId(cardId);
    setBatchReplyMessages({});
    setBatchReplySending({});

    try {
      const results = await Promise.allSettled(threadIds.map(async threadId =>
        batchReplyEntry(threadId, (await getThreadDetails(account.id, threadId)).messages ?? [], account.email)
      ));

      const threads = results
        .filter((r): r is PromiseFulfilledResult<BatchReplyThread | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((t): t is BatchReplyThread => t !== null);

      if (request === batchReplyRequest) setBatchReplyThreads(threads);
    } finally {
      if (request === batchReplyRequest) setBatchReplyLoading(false);
    }
  }

  function closeBatchReply() {
    batchReplyRequest++;
    setBatchReplyLoading(false);
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

    const { attachments, skipped } = await readFilesAsAttachments(Array.from(input.files));
    if (skipped.length > 0) {
      showToast(`Skipped: ${skipped.join(', ')}`);
    }
    if (attachments.length > 0) {
      const current = batchReplyAttachments()[threadId] || [];
      setBatchReplyAttachments({ ...batchReplyAttachments(), [threadId]: [...current, ...attachments] });
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

    // Close if no more threads (the list above was already filtered)
    if (batchReplyThreads().length === 0) {
      closeBatchReply();
    }
  }

  async function sendBatchReply(threadId: string) {
    const account = selectedAccount();
    const thread = batchReplyThreads().find(t => t.threadId === threadId);
    const message = batchReplyMessages()[threadId];
    const attachments = batchReplyAttachments()[threadId] || [];

    if (!account || !thread || !message?.trim()) return;
    if (!thread.to) {
      showToast(`No one to reply to in "${thread.subject}"`);
      return;
    }

    setBatchReplySending({ ...batchReplySending(), [threadId]: true });

    try {
      const replySubject = addReplyPrefix(thread.subject);
      await replyToThread(account.id, threadId, thread.to, "", "", replySubject, message, thread.messageId, attachments, false);

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

      // Close if no more threads (the list above was already filtered)
      if (batchReplyThreads().length === 0) {
        closeBatchReply();
        // Clear selection
        if (cardId) {
          setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
        }
      }
    } catch (e) {
      console.error('Failed to send reply:', e);
      showToast(`Failed to send: ${e}`);
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
    // The store only holds this account's cards; keep other accounts' entries
    const stored = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
    for (const id of Object.keys(collapsedCards)) delete stored[id];
    setCollapsedCards(reconcile(collapsed));
    safeSetJSON("collapsedCards", { ...stored, ...collapsed });
  }

  function startEditCard(card: Card, e: MouseEvent) {
    e.stopPropagation();
    // Close add card form if open
    if (addingCard()) {
      setAddingCard(false);
    }
    // Clear any existing preview; the body keeps showing the card's real
    // content until the draft query diverges, so no initial fetch is needed
    if (queryPreviewTimeout) {
      clearTimeout(queryPreviewTimeout);
      queryPreviewTimeout = undefined;
    }
    setQueryPreviewThreads([]);
    setQueryPreviewCalendarEvents([]);
    setQueryPreviewLoading(false);
    setEditingCardId(card.id);
    setEditCardName(card.name);
    setEditCardQuery(card.query);
    setEditCardColor((card.color as CardColor) || null);
    setEditCardGroupBy(card.group_by || "date");
    setEditColorPickerOpen(false);
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
      const cardType = cardTypeForQuery(newQuery);
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
    const name = cards().find(c => c.id === cardId)?.name || "Untitled";
    if (!confirm(`Delete the card "${name}"? This can't be undone.`)) return;
    try {
      await deleteCard(cardId);
      setCards(cards().filter(c => c.id !== cardId));
      setEditingCardId(null);
      // Its threads would otherwise still count toward the dock badge
      setCardThreads(produce(s => { delete s[cardId]; }));
      setCardPageTokens(produce(s => { delete s[cardId]; }));
      setCardCalendarEvents(produce(s => { delete s[cardId]; }));
      if (focusedCardId() === cardId) {
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
        setFocusedEventIndex(-1);
      }
      // Clean up collapsed state
      const { [cardId]: _, ...remainingCollapsed } = { ...collapsedCards };
      saveCollapsedState(remainingCollapsed);
    } catch (err) {
      console.error("Failed to delete card:", err);
      showToast(`Failed to delete card: ${err}`);
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


  // Show the selected account's cards: drop the previous account's loaded
  // content, then load the cards, their collapsed state and every expanded
  // card's threads/events. Returns null if the account changed meanwhile.
  async function loadAccountCards(account: Account): Promise<Card[] | null> {
    setCardThreads(reconcile({}));
    setCardCalendarEvents(reconcile({}));
    const cardList = await getCards(account.id);
    if (selectedAccount()?.id !== account.id) return null;
    setCards(cardList);

    const savedCollapsed = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
    const collapsed: Record<string, boolean> = {};
    cardList.forEach(c => { collapsed[c.id] = savedCollapsed[c.id] ?? false; });
    setCollapsedCards(reconcile(collapsed));

    for (const card of cardList) {
      if (!collapsed[card.id]) loadCardThreads(card.id);
    }
    return cardList;
  }

  function closeThreadView() {
    setActiveThreadId(null);
    setActiveThreadCardId(null);
    setFocusedMessageIndex(0);
    setLabelDrawerOpen(false);
    setCidAttachmentData({});
  }

  // Views bound to the selected account's threads and events. Compose stays
  // open: it remembers the account it was opened in.
  function closeAccountViews() {
    closeThreadView();
    setActiveThread(null);
    setActiveEvent(null);
    setActiveEventCardId(null);
    setReplyingToEvent(null);
    setForwardingEvent(null);
    setCalendarDrawerOpen(false);
    if (batchReplyOpen()) closeBatchReply();
    setQuickReply({ threadId: null, text: "", sending: false });
    setQuickReplyCardId(null);
    setQuickReplyEventId(null);
    setActionsWheelOpen(false);
    if (creatingEvent() && eventForm().editing) closeEventForm();
  }

  async function switchAccount(account: Account) {
    if (selectedAccount()?.id === account.id) return;

    closeAccountViews();
    setSelectedAccount(account);
    try {
      if (await loadAccountCards(account)) startBackgroundSync(account.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadCardThreads(cardId: string, append = false, forceRefresh = false) {
    const account = selectedAccount();
    if (!account) return;

    // A response landing after the user switched accounts must not write
    // the old account's threads into the store (dock badge, autocomplete)
    const stale = () => selectedAccount()?.id !== account.id;

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
        if (stale()) return;
        if (cached && cached.groups.length > 0) {
          // Show cached data immediately
          setCardThreads(cardId, reconcile(cached.groups, { key: "gmail_thread_id" }));
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
      if (stale()) return;

      if (append) {
        // Merge new threads into existing groups
        const existingGroups = cardThreads[cardId] || [];
        const mergedGroups = mergeThreadGroups(existingGroups, result.groups);
        setCardThreads(cardId, mergedGroups);
        // Save merged groups to cache
        await saveCachedCardThreads(cardId, mergedGroups, result.next_page_token);
      } else {
        setCardThreads(cardId, reconcile(result.groups, { key: "gmail_thread_id" }));
        // Save to cache
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      }

      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
    } catch (e) {
      if (stale()) return;
      console.error("loadCardThreads error:", e);
      handleCardLoadError(cardId, e);
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

    const stale = () => selectedAccount()?.id !== account.id;

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
        if (stale()) return;
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
      if (stale()) return;
      console.error("loadCalendarEvents error:", e);
      handleCardLoadError(cardId, e);
    } finally {
      setLoadingThreads(cardId, false);
    }
  }

  function handleCardLoadError(cardId: string, e: unknown) {
    const errorMsg = String(e);
    if (!isSessionExpiredError(errorMsg)) {
      setCardErrors(cardId, errorMsg);
      setSyncErrors(cardId, errorMsg);
      return;
    }
    setCardErrors(cardId, "Session expired");
    const accountId = selectedAccount()?.id;
    if (accountId) markSessionExpired(accountId);
  }

  // The account and its cards stay: signing in again with the same email
  // reuses the account id, so the layout comes back as it was
  function markSessionExpired(accountId: string) {
    if (expiredAccountId() === accountId) return;
    setExpiredAccountId(accountId);
    setError("Session expired - sign in again");
  }

  // Background syncs keep showing cached mail; an expired session must still
  // surface, or the cards silently go stale
  function noteBackgroundError(accountId: string, e: unknown) {
    if (isSessionExpiredError(String(e)) && selectedAccount()?.id === accountId) markSessionExpired(accountId);
  }

  async function handleReauth() {
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
      setExpiredAccountId(null);
      upsertAccount(account);
      closeAccountViews();
      setSelectedAccount(account);
      if (await loadAccountCards(account)) startBackgroundSync(account.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setAuthLoading(false);
    }
  }

  async function fetchAndCacheCalendarEvents(accountId: string, cardId: string, query: string) {
    try {
      const events = await fetchCalendarEvents(accountId, query);
      if (selectedAccount()?.id !== accountId) return;
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
  // Background refresh of a card's first page. Overlapping requests for a
  // card share one follow-up fetch instead of downloading it concurrently.
  const refreshCardThreads = coalesceByKey((key: string) => {
    const [accountId, cardId] = JSON.parse(key) as [string, string];
    return refreshCardThreadsNow(accountId, cardId);
  });
  function fetchAndCacheThreads(accountId: string, cardId: string) {
    // Skip for calendar cards (they don't use thread caching)
    if (isCalendarCard(cardId)) return Promise.resolve();
    return refreshCardThreads(JSON.stringify([accountId, cardId]));
  }

  async function refreshCardThreadsNow(accountId: string, cardId: string) {

    // Capture pagination state so a page-1 fetch that resolves after the
    // user paginated doesn't wipe appended pages or rewind the page token
    const tokenBeforeFetch = cardPageTokens[cardId] ?? null;
    try {
      const result = await fetchThreadsPaginated(accountId, cardId, null);
      if (selectedAccount()?.id !== accountId) return;
      // Skip update if a recent action happened (prevents overwriting optimistic updates)
      const recent = lastAction();
      if (recent && Date.now() - recent.timestamp < 3000) {
        // Don't touch UI state; also skip the cache write when the action
        // touched this card — this fetch may predate the server-side modify,
        // and caching its groups would resurrect the pre-action state
        if (recent.cardIds.includes(cardId) || recent.cardId === cardId) return;
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
        return;
      }
      if ((cardPageTokens[cardId] ?? null) !== tokenBeforeFetch || loadingMore[cardId]) {
        // Card paginated while this fetch was in flight; refresh the
        // page-1 cache but leave UI state alone
        await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
        return;
      }
      setCardThreads(cardId, reconcile(result.groups, { key: "gmail_thread_id" }));
      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      await saveCachedCardThreads(cardId, result.groups, result.next_page_token);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
    } catch (e) {
      // Background refresh failed - set sync error but keep cached data shown
      setSyncErrors(cardId, String(e));
      noteBackgroundError(accountId, e);
    }
  }

  function getGroupByForCard(cardId: string): GroupBy {
    if (editingCardId() === cardId) return editCardGroupBy();
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
      if (!color) return;
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const bgColor = isDark ? color.dark : color.light;
      deck.style.background = bgColor;
      deck.dataset.bgLight = color.light;
      deck.dataset.bgDark = color.dark;
      document.documentElement.style.setProperty("--accent", color.hex);
      document.documentElement.style.setProperty("--app-bg", bgColor);
    }
  }

  function getDisplayGroups(cardId: string): ThreadGroup[] {
    const threads = isPreviewingQuery(cardId) ? queryPreviewThreads() : cardThreads[cardId];
    if (!threads) return [];
    const groupBy = getGroupByForCard(cardId);
    let groups = regroupThreads(threads, groupBy, labelNames());

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
    const events = isPreviewingQuery(cardId) ? queryPreviewCalendarEvents() : cardCalendarEvents[cardId];
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
      // The backend refuses to open files that can run code; saving them is
      // still allowed
      if (String(e).startsWith("EXECUTABLE_ATTACHMENT:")) {
        showToast(`${filename} can run code, so Posta won't open it`, {
          label: "Save instead",
          run: () => downloadAttachment(messageId, attachmentId, filename, mimeType, inlineData),
        });
        return;
      }
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
          for (const contact of matchContacts(rankedContacts(), searchPart, 6)) {
            suggestions.push({
              text: op + contact.email,
              desc: contact.name ? `${contact.name} (${contact.frequency} emails)` : `${contact.frequency} emails`,
              replace: { start: tokenStart, end: query.length },
            });
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
        handleThreadAction('read', [threadId], cardId, { silent: true });
        break;
      }
    }

    try {
      const details = await getThreadDetails(account.id, threadId);
      // A slower response for a thread the user already left must not
      // clobber the one they're looking at now
      if (activeThreadId() !== threadId) return;
      setActiveThread(details);
      // Focus the most recent (last) message
      setFocusedMessageIndex(details.messages.length - 1);

      // Fetch CID attachments in background (don't block thread display)
      fetchCidAttachments(account.id, details);
    } catch (e) {
      if (activeThreadId() !== threadId) return;
      console.error("Failed to load thread details", e);
      setThreadError(threadLoadErrorMessage(e));
      noteBackgroundError(account.id, e);
    } finally {
      if (activeThreadId() === threadId) {
        setThreadLoading(false);
      }
    }
  }

  // Fetch CID image attachments for inline display
  async function fetchCidAttachments(accountId: string, thread: FullThread) {
    const refs = cidImagesToFetch(thread);
    if (refs.length === 0) return;
    const data = await fetchCidImages(refs, (messageId, attachmentId) => downloadAttachmentApi(accountId, messageId, attachmentId));
    if (Object.keys(data).length > 0 && activeThreadId() === thread.id) {
      setCidAttachmentData(prev => ({ ...prev, ...data }));
    }
  }

  function openEvent(event: GoogleCalendarEvent, cardId: string) {
    setActiveEvent(event);
    setActiveEventCardId(cardId);
  }

  function closeEvent() {
    const wasComposing = composeShownIn() === "event";
    setActiveEvent(null);
    setActiveEventCardId(null);
    setReplyingToEvent(null);
    setForwardingEvent(null);
    setCalendarDrawerOpen(false);
    if (wasComposing) {
      closeCompose();
    }
  }

  async function saveGeminiApiKey(apiKey: string) {
    try {
      await setGeminiApiKey(apiKey);
      setGeminiKeySaved(!!apiKey.trim());
      setGeminiKeyDraft("");
    } catch (e) {
      showToast(`Couldn't save the Gemini API key: ${e}`);
    }
  }

  // Earlier builds kept the key in localStorage; move it to the keychain
  async function loadGeminiKeyState() {
    try {
      const legacyKey = safeGetItem("gemini_api_key");
      if (legacyKey) {
        await setGeminiApiKey(legacyKey);
        safeRemoveItem("gemini_api_key");
      }
      setGeminiKeySaved(await hasGeminiApiKey());
    } catch (e) {
      console.warn("Gemini API key unavailable:", e);
    }
  }

  function showToast(message?: string, action?: { label: string; run: () => void }) {
    clearTimeout(toastTimeoutId);
    // Cancel a pending hide so it can't null out this newer toast
    clearTimeout(toastHideTimeoutId);
    if (message) {
      // Plain message toast: drop any pending undo so `z` (or the Undo
      // button) can't replay an older, unrelated action. The action-undo
      // toast path calls showToast() with no message after setLastAction.
      setLastAction(null);
    }
    setToast(prev => ({
      message: message || null,
      action,
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
    toastHideTimeoutId = window.setTimeout(() => {
      setToast(null);
      setLastAction(null); // Expire undo when toast closes
    }, 200);
  }

  async function undoLastAction() {
    const action = lastAction();
    if (!action) return;

    hideToast();

    try {
      await Promise.all(action.reversals.map(r => modifyThreads(action.accountId, r.threadIds, r.add, r.remove)));
      // Refresh every card the optimistic update touched, not just the
      // one the action originated from; they are gone after an account switch
      if (selectedAccount()?.id === action.accountId) {
        const cardsToRefresh = action.cardIds.length > 0 ? action.cardIds : [action.cardId];
        for (const cId of cardsToRefresh) {
          fetchAndCacheThreads(action.accountId, cId);
        }
      }
    } catch (e) {
      console.error("Failed to undo action", e);
      setError(String(e));
    }
    setLastAction(null);
  }

  // silent: a change the user didn't ask for directly (marking a thread
  // read on open) gets no undo toast
  async function handleThreadAction(action: string, threadIds: string[], cardId: string, { silent = false } = {}) {
    const account = selectedAccount();
    if (!account) return;

    // Confirm destructive bulk actions
    if (threadIds.length > 1 && (action === 'archive' || action === 'trash' || action === 'spam')) {
      const actionText = action === 'trash' ? 'delete' : action === 'spam' ? 'move to spam' : 'archive';
      if (!confirm(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} ${threadIds.length} threads?`)) {
        return;
      }
    }

    const { add: addLabels, remove: removeLabels } = labelChangeFor(action);

    // Optimistic Update - update ALL cards that contain these threads.
    // Snapshot the affected cards first so the update can be rolled back
    // if the API call fails.
    const updatedCardThreads: Record<string, ThreadGroup[]> = {};
    const snapshot: Record<string, ThreadGroup[]> = {};
    const affectedCardIds: string[] = [];
    const labelsBefore = new Map<string, Pick<Thread, "labels" | "unread_count">>();

    for (const [cId, groups] of Object.entries(cardThreads)) {
      if (!groups) continue;
      if (groups.some(g => g.threads.some(t => threadIds.includes(t.gmail_thread_id)))) {
        snapshot[cId] = structuredClone(unwrap(groups));
        affectedCardIds.push(cId);
        for (const t of snapshot[cId].flatMap(g => g.threads)) {
          if (threadIds.includes(t.gmail_thread_id)) labelsBefore.set(t.gmail_thread_id, t);
        }
      }
      const query = cards().find(c => c.id === cId)?.query ?? "";
      updatedCardThreads[cId] = applyThreadAction(groups, threadIds, action, actionRemovesFromCard(action, query));
    }

    setCardThreads(reconcile(updatedCardThreads, { key: "gmail_thread_id" }));
    if (!silent) setActionsWheelOpen(false);

    // Clear selection after bulk action
    if (threadIds.length > 1) {
      setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
    }

    try {
      await modifyThreads(account.id, threadIds, addLabels, removeLabels);
      // Persist the optimistic changes only after the server accepted them
      for (const cId of affectedCardIds) {
        saveCachedCardThreads(cId, updatedCardThreads[cId], cardPageTokens[cId] || null);
      }
      if (silent) return;
      // Store undo state and show toast
      setLastAction({
        accountId: account.id,
        action,
        threadIds,
        cardId,
        cardIds: affectedCardIds,
        reversals: undoLabelChanges(threadIds, { add: addLabels, remove: removeLabels }, labelsBefore),
        timestamp: Date.now()
      });
      showToast();
    } catch (e) {
      console.error("Failed to modify threads", e);
      // Roll back the optimistic update; the cache was never written. After
      // an account switch those cards are no longer loaded.
      if (selectedAccount()?.id === account.id) {
        setCardThreads(produce(s => {
          for (const cId of affectedCardIds) {
            s[cId] = snapshot[cId];
          }
        }));
      }
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

  const rankedContacts = createMemo(() => rankContacts(
    googleContacts(),
    Object.values(cardThreads).flatMap(groups => groups.flatMap(g => g.threads)),
    selectedAccount()?.email,
    Date.now(),
  ));
  const contactCandidates = () => rankedContacts().slice(0, 8);

  function selectContact(email: string) {
    setComposeTo(completeRecipient(composeTo(), email));
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
              onFocusIn={() => {
                clearTimeout(fabHoverTimeout);
                setComposeFabHovered(true);
              }}
              onFocusOut={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setComposeFabHovered(false);
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
                  onClick={() => { if (!composing() || closingCompose()) startCompose({}); }}
                  title="Compose"
                  aria-label="Compose new email"
                >
                  <ComposeIcon />
                </button>
                <Show when={contactCandidates().length > 0}>
                  <div class={`compose-suggestions ${composeFabHovered() ? 'visible' : ''}`}>
                    <For each={contactCandidates().slice(0, 5)}>
                      {(contact) => {
                        const writeTo = () => {
                          startCompose({ to: contact.email, focusBody: true });
                          setComposeFabHovered(false);
                        };
                        return (
                        <div
                          class="compose-suggestion-avatar"
                          role="button"
                          tabindex={composeFabHovered() ? 0 : -1}
                          aria-label={`New email to ${contact.name || contact.email}`}
                          style={{ background: getAvatarColor(contact.name || contact.email) }}
                          title={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
                          onClick={writeTo}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            e.stopPropagation();
                            writeTo();
                          }}
                        >
                          {(contact.name || contact.email).charAt(0).toUpperCase()}
                          <span class="suggestion-label">{contact.name || contact.email}</span>
                        </div>
                        );
                      }}
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
        <div class="auth-error">
          {error()}
          <Show when={expiredAccountId() && expiredAccountId() === selectedAccount()?.id}>
            <button class="btn btn-primary" onClick={handleReauth}>Sign in again</button>
          </Show>
          <button class="btn" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
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
          <button
            class="auth-settings-btn"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </Show>

      {/* Auth loading */}
      <Show when={authLoading()}>
        <div class="auth-screen">
          <div class="auth-spinner"></div>
          <p>Complete sign-in in your browser...</p>
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
                        aria-label={`${card.name} ${card.card_type === "calendar" ? "calendar" : "email"} card`}
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
                            <button
                              class="collapse-btn"
                              aria-label={`${collapsedCards[card.id] ? "Expand" : "Collapse"} ${card.name}`}
                              aria-expanded={!collapsedCards[card.id]}
                            >
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
                          {/* Only show loading if no cached data */}
                          <Show when={loadingThreads[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id]}>
                            <div class="loading">Loading...</div>
                          </Show>
                          <Show when={isPreviewingQuery(card.id) && queryPreviewLoading()}>
                            <div class="loading">Searching...</div>
                          </Show>
                          <Show when={!loadingThreads[card.id] && cardErrors[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id]}>
                            <div class="card-error">
                              <span class="error-icon">⚠</span>
                              <span class="error-text">{cardErrors[card.id]}</span>
                              <Show
                                when={(expiredAccountId() && expiredAccountId() === selectedAccount()?.id) || needsSignInAgain(cardErrors[card.id] ?? "")}
                                fallback={<button class="retry-btn" onClick={(e) => refreshCard(card.id, e)}>Try again</button>}
                              >
                                <button class="retry-btn" onClick={handleReauth}>Sign in again</button>
                              </Show>
                            </div>
                          </Show>

                          {/* Calendar card: show calendar events */}
                          <Show when={effectiveCardType(card) === "calendar" && (isPreviewingQuery(card.id) || cardCalendarEvents[card.id])}>
                            <Show when={getCalendarEventGroups(card.id).length === 0 && !(isPreviewingQuery(card.id) && queryPreviewLoading())}>
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
                                            {getSmartEventTime(event, currentTime())}
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
                                              onDeleteEvent={deleteEvent}
                                              onRsvped={markEventRsvp}
                                              showToast={showToast}
                                            />
                                          </Show>
                                        </div>
                                      </div>
                                      {/* Event Quick Reply */}
                                      <Show when={quickReplyEventId() === event.id}>
                                        <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                          <ComposeTextarea
                                            class="quick-reply-input"
                                            placeholder={`Reply to ${eventReplyRecipients(event, selectedAccount()?.email ?? '').to || 'organizer'}...`}
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
                          <Show when={effectiveCardType(card) !== "calendar" && (isPreviewingQuery(card.id) || cardThreads[card.id])}>
                            <Show when={getDisplayGroups(card.id).length === 0 && !(isPreviewingQuery(card.id) && queryPreviewLoading())}>
                              <div class="empty">All clear</div>
                            </Show>
                            <Index each={getDisplayGroups(card.id)}>
                              {(group) => (
                                <>
                                  <div class="date-header">{group().label}</div>
                                  <For each={group().threads}>
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
                                            const imageAttachments = attachments?.filter(a => a.inline_data && a.mime_type.startsWith("image/")) ?? [];
                                            const fileAttachments = attachments?.filter(a => !a.inline_data || !a.mime_type.startsWith("image/")) ?? [];
                                            const shownCount = Math.min(imageAttachments.length, 4) + Math.min(fileAttachments.length, 3);
                                            return (
                                              <Show when={attachments && attachments.length > 0}>
                                                <div class="thread-attachments" onClick={(e) => e.stopPropagation()}>
                                                  {/* Image thumbnails */}
                                                  <For each={imageAttachments.slice(0, 4)}>
                                                    {(attachment) => (
                                                      <img
                                                        class="thread-image-thumb"
                                                        src={`data:${attachment.mime_type};base64,${normalizeBase64Url(attachment.inline_data || '')}`}
                                                        alt={attachment.filename}
                                                        title={attachment.filename}
                                                        onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttachmentContextMenu({ messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data }); }}
                                                      />
                                                    )}
                                                  </For>
                                                  {/* Other files (non-image or images without inline data) */}
                                                  <For each={fileAttachments.slice(0, 3)}>
                                                    {(attachment) => (
                                                      <div
                                                        class="thread-file-item"
                                                        title={`${attachment.filename} (${formatFileSize(attachment.size)})`}
                                                        onClick={() => openAttachment(attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data)}
                                                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showAttachmentContextMenu({ messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data }); }}
                                                      >
                                                        <span class="file-name">{truncateMiddle(attachment.filename, 14)}</span>
                                                      </div>
                                                    )}
                                                  </For>
                                                  {/* More indicator */}
                                                  <Show when={attachments && attachments.length > shownCount}>
                                                    <span class="thread-attachment-more">+{attachments!.length - shownCount}</span>
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
                            </Index>
                            {/* Loading more indicator for infinite scroll */}
                            <Show when={loadingMore[card.id]}>
                              <div class="loading">Loading more...</div>
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
                    <Show when={!queryPreviewLoading() && cardTypeForQuery(newCardQuery()) === "calendar"}>
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
                                      {getSmartEventTime(event, currentTime())}
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
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length === 0 && newCardQuery().trim() && cardTypeForQuery(newCardQuery()) !== "calendar"}>
                      <div class="empty">No matches</div>
                    </Show>
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                      <For each={regroupThreads(queryPreviewThreads(), newCardGroupBy(), labelNames())}>
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

      {/* Compose Panel (standalone, when not inline in the open thread or event) */}
      <Show when={composeShownIn() === "panel"}>
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
            draftSaving={drafts.saving()}
            draftSaved={drafts.saved()}
            onSend={handleSendEmail}
            onClose={closeCompose}
            onInput={handleComposeInput}
            focusBody={focusComposeBody()}
            autocomplete={{
              show: showAutocomplete(),
              candidates: matchContacts(rankedContacts(), currentRecipient(composeTo()), 8),
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
              <For each={Object.entries(PRESETS)}>
                {([key, preset]) => (
                  <div class={`preset-option ${key === "posta" ? "recommended" : ""}`} onClick={() => applyPreset(key)}>
                    <Show
                      when={preset.cards.length > 0}
                      fallback={<div class="preset-preview empty"><PlusIcon /></div>}
                    >
                      <div class="preset-preview">
                        <For each={preset.cards.filter(c => c.color)}>
                          {(c) => <div class={`preset-card ${c.color}`}></div>}
                        </For>
                      </div>
                    </Show>
                    <div class="preset-label">
                      {preset.label}
                      <Show when={key === "posta"}> <span class="preset-badge">Recommended</span></Show>
                    </div>
                    <div class="preset-desc">{preset.description}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Restore Found Prompt */}
      <Show when={showRestorePrompt()}>
        <div class="preset-overlay">
          <div class="preset-modal">
            <h2>Welcome Back</h2>
            <p>We found a layout from iCloud.</p>
            <div class="restore-actions">
              <button class="btn btn-primary" onClick={() => setShowRestorePrompt(false)}>
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
          currentUserEmail={selectedAccount()?.email}
          onError={showToast}
          loading={threadLoading()}
          error={threadError()}
          card={activeThreadCardId() ? (() => {
            const c = cards().find(c => c.id === activeThreadCardId());
            return c ? { name: c.name, color: (c.color as CardColor) || null } : null;
          })() : null}
          focusColor={selectedBgColorIndex() !== null ? BG_COLORS[selectedBgColorIndex()!].hex : null}
          onClose={() => { if (composeShownIn() === "thread") closeCompose(); closeThreadView(); }}
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
          inlineCompose={composeShownIn() === "thread" ? threadInlineCompose : null}
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

                <Show when={labelsFailed()}>
                  <div class="label-drawer-empty">
                    Couldn't load labels.{" "}
                    <button class="retry-btn" onClick={() => fetchAccountLabels()}>Try again</button>
                  </div>
                </Show>
                <Show when={!labelsLoading() && !labelsFailed() && accountLabels().filter(l =>
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
              markEventRsvp(event.id, status);
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
            const subject = addReplyPrefix(event.title);
            const { to } = eventReplyRecipients(event, selectedAccount()?.email ?? '');
            startCompose({ to, subject, focusBody: true, replyEvent: { eventId: event.id } });
          }}
          onReplyAll={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = addReplyPrefix(event.title);
            const { to, cc } = eventReplyRecipients(event, selectedAccount()?.email ?? '', true);
            startCompose({ to, cc, subject, focusBody: true, replyEvent: { eventId: event.id } });
          }}
          onForward={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = addForwardPrefix(event.title);
            const body = `---------- Forwarded event ----------\n` +
              `Title: ${event.title}\n` +
              `When: ${new Date(event.start_time).toLocaleString()}\n` +
              (event.location ? `Where: ${event.location}\n` : '') +
              (event.organizer ? `Organizer: ${event.organizer}\n` : '') +
              (event.description ? `\n${event.description}` : '');
            startCompose({ subject, body, focusBody: true, forwardEvent: { eventId: event.id } });
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
            // All-day timestamps are UTC-anchored; their local rendering is a
            // time the user never chose (e.g. 17:00 in UTC-7), which would be
            // saved verbatim if "All day" gets unchecked. Prefill smart
            // defaults instead.
            const timeDefaults = smartEventDefaults();
            setEventForm(f => ({
              ...f,
              summary: event.title || '',
              description: event.description || '',
              location: event.location || '',
              startDate: toDateInputString(startDate, event.all_day),
              startTime: event.all_day ? timeDefaults.startTime : startDate.toTimeString().slice(0, 5),
              endDate: toDateInputString(endDateVal, event.all_day),
              endTime: event.all_day ? timeDefaults.endTime : endDateVal.toTimeString().slice(0, 5),
              allDay: event.all_day,
              attendees: event.attendees.map(a => a.email).join(', '),
              // Cards list single occurrences; a null rule leaves a series' recurrence alone
              recurrence: null,
              editing: { id: event.id, calendarId: event.calendar_id },
            }));
          }}
          onDelete={() => { const event = activeEvent(); if (event) deleteEvent(event); }}
          onOpenCalendars={() => { fetchAvailableCalendars(); setCalendarDrawerOpen(true); }}
          calendarDrawerOpen={calendarDrawerOpen()}
          onCloseCalendarDrawer={() => setCalendarDrawerOpen(false)}
          calendars={availableCalendars()}
          calendarsLoading={calendarsLoading()}
          onMoveToCalendar={handleMoveEventToCalendar}
          rsvpLoading={!!(activeEvent() && rsvpLoading[activeEvent()!.id])}
          inlineCompose={composeShownIn() === "event" ? eventInlineCompose : null}
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
            occurrenceOnly: !!activeEvent()!.recurring_event_id,
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
                        placeholder={`Reply to ${thread.to || extractEmail(thread.from)}...`}
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
            <p class="settings-hint">
              <a href="#" onClick={(e) => { e.preventDefault(); openUrl('https://console.cloud.google.com/apis/credentials'); }} class="settings-link">
                Open Google Cloud Console
              </a>, create an OAuth client of type "Desktop app", and enable the Gmail API, Google Calendar API and People API for its project.
            </p>
            <div class="settings-form-group">
              <label for="settings-client-id">Client ID</label>
              <input
                id="settings-client-id"
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
              <label for="settings-client-secret">Client Secret</label>
              <input
                id="settings-client-secret"
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
            >
              Connect <span class="shortcut-hint">↵</span>
            </button>
          </div>
          <Show when={selectedAccount()}>
            {(account) => (
              <div class="settings-section">
                <div class="settings-section-title">Signature</div>
                <p class="settings-hint">
                  Added to new emails, replies and forwards from {account().email}.
                </p>
                <div class="settings-form-group">
                  <textarea
                    aria-label="Signature"
                    rows={4}
                    value={account().signature ?? ""}
                    onChange={(e) => saveSignature(account(), e.currentTarget.value)}
                  />
                </div>
              </div>
            )}
          </Show>
          <div class={`settings-section collapsible ${smartRepliesOpen() ? 'open' : ''}`}>
            <div class="settings-section-title" onClick={() => setSmartRepliesOpen(!smartRepliesOpen())}>
              <span>Smart Replies</span>
              <span class="collapse-icon">{smartRepliesOpen() ? '−' : '+'}</span>
            </div>
            <Show when={smartRepliesOpen()}>
              <p class="settings-hint">
                AI-powered reply suggestions via Gemini.
              </p>
              <div class="settings-form-group">
                <label>API Key</label>
                <input
                  type="password"
                  aria-label="Gemini API key"
                  value={geminiKeyDraft()}
                  onInput={(e) => setGeminiKeyDraft(e.currentTarget.value)}
                  onChange={(e) => { if (e.currentTarget.value.trim()) saveGeminiApiKey(e.currentTarget.value); }}
                  placeholder={geminiKeySaved() ? "Saved in the keychain" : "AIza..."}
                />
              </div>
              <Show when={geminiKeySaved()}>
                <button class="link-btn" onClick={() => saveGeminiApiKey("")}>Remove key</button>
              </Show>
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
              <div class="shortcut-row"><kbd>h</kbd> <span>Previous card</span></div>
              <div class="shortcut-row"><kbd>l</kbd> <span>Next card</span></div>
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
              <div class="shortcut-row"><kbd>#</kbd> <span>Delete thread</span></div>
              <div class="shortcut-row"><kbd>r</kbd> <span>Reply to thread</span></div>
              <div class="shortcut-row"><kbd>f</kbd> <span>Forward thread</span></div>
              <div class="shortcut-row"><kbd>u</kbd> <span>Toggle read</span></div>
              <div class="shortcut-row"><kbd>i</kbd> <span>Toggle important</span></div>
              <div class="shortcut-row"><kbd>!</kbd> <span>Report spam</span></div>
              <div class="shortcut-row"><kbd>z</kbd> <span>Undo last action</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Open thread</h3>
              <div class="shortcut-row"><kbd>j</kbd> <span>Next message</span></div>
              <div class="shortcut-row"><kbd>k</kbd> <span>Previous message</span></div>
              <div class="shortcut-row"><kbd>r</kbd> <span>Reply to message</span></div>
              <div class="shortcut-row"><kbd>⇧R</kbd> <span>Reply all</span></div>
              <div class="shortcut-row"><kbd>f</kbd> <span>Forward message</span></div>
              <div class="shortcut-row"><kbd>l</kbd> <span>Labels</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Compose</h3>
              <div class="shortcut-row"><kbd>c</kbd> <span>New email</span></div>
              <div class="shortcut-row"><kbd>e</kbd> <span>New event</span></div>
              <div class="shortcut-row"><kbd>⌘Enter</kbd> <span>Send email</span></div>
              <div class="shortcut-row"><kbd>Escape</kbd> <span>Close compose</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Selection</h3>
              <div class="shortcut-row"><kbd>x</kbd> <span>Select thread</span></div>
              <div class="shortcut-row"><kbd>Escape</kbd> <span>Clear selection</span></div>
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
              <span class="toast-message">{toast()?.message || (lastAction() ? actionLabel(lastAction()!.action, lastAction()!.threadIds.length) : '')}</span>
              <Show when={!toast()?.message && lastAction()}>
                <button class="toast-undo-btn" onClick={undoLastAction}>Undo <span class="shortcut-hint">z</span></button>
              </Show>
              <Show when={toast()?.action}>
                {(action) => (
                  <button class="toast-undo-btn" onClick={() => { hideToast(); action().run(); }}>{action().label}</button>
                )}
              </Show>
              <button class="toast-close-btn" onClick={hideToast} title="Dismiss">
                <CloseIcon />
              </button>
            </div>
          </div>
        )}
      </For>

      {/* Send Toast with Undo */}
      <Show when={undoableSend.toastVisible()}>
        <div class={`undo-toast send-toast ${undoableSend.toastClosing() ? 'closing' : ''}`}>
          <div class="toast-progress send-progress" style={{ width: `${undoableSend.progress()}%` }}></div>
          <div class="toast-content">
            <span class="toast-message">Sending message...</span>
            <Show when={undoableSend.pending()}>
              <button class="toast-undo-btn" onClick={undoSend}>Undo</button>
            </Show>
          </div>
        </div>
      </Show>
    </div >
  );
}



export default App;
