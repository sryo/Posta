import { batch, createSignal, onMount, onCleanup, Show, For, Index, createMemo, createEffect, createComputed, createSelector, mapArray, on, untrack } from "solid-js";
import { StatusLine } from "./components/StatusLine";
import { Avatar } from "./components/Avatar";
import { KeyHint } from "./components/KeyHint";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { MessageBody } from './components/MessageBody';
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
  getICloudSyncStatus,
  type ICloudSyncStatus,
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
  fetchQueryThreads,
  searchThreadsPreview,
  modifyThreads,
  type Account,
  type MailtoData,
  type Card,
  type ThreadGroup,
  type Thread,
  type Attachment,
  getThreadDetails,
  listThreadDrafts,
  deleteDraft,
  type FullThread,
  sendEmail,
  unsubscribeOneClick,
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
  rsvpListedCalendarEvent,
  getCalendarRsvpStatus,
  syncThreadsIncremental,
  fetchContacts,
  type Contact,
  fetchCalendarEvents,
  type GoogleCalendarEvent,
  type CalendarEvent,
  type CalendarInfo,
  listCalendars,
  moveCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  pullFromICloud,
  cancelOAuthFlow,
  reopenOAuthPage,
  getCachedCardEvents,
  saveCachedCardEvents,
  createCalendarEvent,
  type EventInput,
  sendReaction,
  setDockIcon,
} from "./api/tauri";
import { createDockIconSync, dockIconForHue, renderIconPng } from "./app/dockIcon";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import {
  formatTime,
  formatSyncTime,
  extractEmail,
  extractMessageText,
  validateEmailList,
  splitEmailList,
  addReplyPrefix,
  addForwardPrefix,
  buildForwardBody,
  smoothScroll,
  toDateInputString,
} from "./utils";
import "./App.css";
import {
  RefreshIcon,
  PlusIcon,
  SettingsIcon,
  ComposeIcon,
  CloseIcon,
  SearchIcon,
  CalendarIcon,
  ChevronIcon,
  WarningIcon,
  CheckIcon,
  MailIcon,
  RepeatIcon,
} from "./components/Icons";
import { ReactionButton } from "./components/ReactionButton";
import { ComposeTextarea, CloseButton } from "./components/ComposeAtoms";
import { CancelButton, FormFooter, SettingsGroup, SettingsRow, SubmitButton } from "./components/FormParts";
import { AuthScreen } from "./components/AuthScreen";
import { PresetPicker } from "./components/PresetPicker";
import { EmptyBoard } from "./components/EmptyBoard";
import { SmartRepliesSettings } from "./components/SmartRepliesSettings";
import { cardSpecs, copyableCards, loadLayoutSnapshot, saveLayoutSnapshot, specAccountId, type CardSpec } from "./app/layoutSnapshot";
import { ALL_ACCOUNTS, accountFromError, accountsToPoll, boardMixesScopes, cardAccountIds, cardCoversAccount, eventAccountId, inAccount, threadAccountId, threadIdsByAccount, threadKey } from "./app/accountScope";
import { GoogleCredentialsForm } from "./components/GoogleCredentialsForm";
import { credentialsValid } from "./app/googleCredentials";
import { ComposeForm } from "./components/ComposeForm";
import { CreateEventForm } from "./components/CreateEventForm";
import { ThreadRowLines } from "./components/ThreadRowLines";
import { EventRowLines } from "./components/EventRowLines";
import { InviteRowLines } from "./components/InviteRow";
import { inviteEnd, inviteState, inviteSummary, inviteTitle } from "./app/inviteRow";
import { dayOtherEvents, stripLayout } from "./app/dayStrip";
import { createInviteDayLookups, rangeDaysFor, type DayEvents } from "./app/inviteDays";
import type { DayBusy } from "./app/dayTimeline";
import { isHappeningNow, isNowGroup, withNowSection } from "./app/nowSection";
import { deletePrompt, eventActions, meetingOver } from "./app/eventActions";
import { defaultCalendarId, lastUsedCalendar, rememberCalendar } from "./app/eventCalendars";
import { deletedByScope, type RecurrenceScope } from "./app/recurrence";
import { ThreadView } from "./components/ThreadView";
import { EventView } from "./components/EventView";
import { ActionsWheel } from "./components/ActionsWheel";
import { BoardSlotWheel } from "./components/BoardSlotWheel";
import { BoardFlower } from "./components/BoardFlower";
import { RADIAL_HOVER_CLOSE_MS, RADIAL_HOVER_OPEN_MS } from "./app/radial";
import { createHoverHold } from "./app/hoverHold";
import { inputMode } from "./app/inputMode";
import { CardForm } from "./components/CardForm";
import { QueryField } from "./components/QueryField";
import { CardAccountQualifier, cardTitleLabel } from "./components/CardAccountQualifier";
import { Sheet } from "./components/Sheet";
import { ToastFrame, Toasts } from "./components/Toasts";
import { createToasts, type ToastAction, type ToastTone } from "./app/toasts";
import { failureMessage, storedCredentialsFailure } from "./app/errorText";
import { formatClock, formatDayLabel, formatShortDate, formatWhen, threadGroupLabel } from "./app/dateFormat";
import { safeGetItem, safeSetItem, safeRemoveItem, safeGetJSON, safeSetJSON } from "./shared/storage";
import { BOARD_COLORS, type ActionSettings, type CardColor, type GroupBy } from "./shared/constants";
import { createUndoableSend } from "./app/undoableSend";
import { findHeader, lastMessageFromOthers, messageDate } from "./app/messages";
import { lastLetterLine, latestDate } from "./app/transit";
import { batchReplyEntry, type BatchReplyThread } from "./app/batchReply";
import { matchContacts, rankContacts, type RecentContact } from "./app/contacts";
import { eventReplyRecipients } from "./app/eventReply";
import { labelDisplayName } from "./app/labels";
import { nameInThreads, personName } from "./app/people";
import { afterRemoval, loadAfterArchive, stepThread, threadPosition } from "./app/threadNavigation";
import { AttachmentList } from "./components/Attachments";
import { watchScrollFade } from "./app/scrollFade";
import { createThumbnails } from "./app/thumbnails";
import { AfterArchiveSetting } from "./components/AfterArchiveSetting";
import { runUnsubscribe, type UnsubscribeMethod } from "./app/unsubscribe";
import { actionFailureLabel, actionLabel, actionRemovesFromCard, applyThreadAction, labelChangeFor, threadMayJoinCard, undoLabelChanges, type LabelReversal } from "./app/threadActions";
import { PRESETS } from "./app/presets";
import { normalizeActionOrder } from "./app/actionOrder";
import { parseStoredWidth } from "./app/storedWidth";
import { isSessionExpiredError, needsSignInAgain } from "./app/authErrors";
import { signatureBlock, swapSignature, withSignature } from "./app/signature";
import { isPreviewable, readFilesAsAttachments, visibleAttachments } from "./app/attachments";
import { AttachmentLightbox, type PreviewAttachment } from "./components/AttachmentLightbox";
import { MessageSender } from "./components/MessageSender";
import { isForwardSubject } from "./app/quotedHistory";
import { eventAttendees, eventFromThread, eventTimesFromForm, smartEventDefaults } from "./app/eventForm";
import { guestList, rankEventSuggestions, type EventSuggestion } from "./app/eventSuggestions";
import { composePlacement, panelBesideView } from "./app/composePlacement";
import { cidImagesToFetch, createLruCache, fetchCidImages } from "./app/cidImages";
import { sendPending, type PendingSend } from "./app/pendingSend";
import { parseMailto } from "./app/mailto";
import { coalesceByKey } from "./app/coalesce";
import { batchReplyLoadErrorMessage, cardLoadErrorMessage, isOfflineError, queryPreviewErrorMessage, threadLoadErrorMessage } from "./app/loadErrors";
import { cardSyncStatus, cardWaitingMessage, connectionStatus } from "./app/connectionStatus";
import { CardEmpty, CardSkeleton, ConnectionStatusBar, PostmarkDefs, type NoMatch } from "./components/CardStates";
import { createPostmarkLedger } from "./app/postmark";
import { dayGutters, gutterDay, type Gutter } from "./app/gutters";
import { CalendarGutter } from "./components/CalendarGutter";
import { cardTypeForQuery } from "./app/cardType";
import { SEARCH_CARD_ID, forgetSearch, isSearchCard, keptCardName, parseRecentSearches, rememberSearch, searchCard as searchCardFor } from "./app/quickSearch";
import { discardThreadDrafts, draftToOpen, isDraftThread, prepareDraftCompose, withDraftsDiscarded, type DraftToOpen } from "./app/draftThreads";
import { createDraftSync, draftKey, findLatestDraft, findUnsentDrafts, hasDraftContent, markDraftClosed, markDraftSending, pruneDrafts, removeAccountDrafts, sessionDraftKey, type DraftFields } from "./app/drafts";
import { escapeTarget, nextCardFocus, nextItemFocus, type ItemFocus } from "./app/keyboardNav";
import { getSmartEventTime, groupCalendarEvents, isUserLabel, mergeThreadGroups, regroupThreads, type CalendarEventGroup } from "./app/grouping";
import { pullLayoutWithRetry } from "./app/icloudRestore";
import { querySuggestions, type QuerySuggestion } from "./app/querySuggestions";
import { calendarRangeError } from "./app/queryTokens";
import { useLayer } from "./app/layers";
import { QueryHelpSheet } from "./components/QueryHelpSheet";
import { inviteNamesEvent, rsvpForKey, rsvpSentMessage, withOwnResponse, type RsvpStatus } from "./app/rsvp";
import { createRsvpLookups } from "./app/rsvpLookups";
import { nextSelection } from "./app/selection";
import { bulkActionForKey, extendSelection, keyTargets } from "./app/bulkKeys";
import { fingerprint } from "./app/fingerprint";
import { hasCommandModifier, isTypingTarget } from "./shared/keyboard";
import { askConfirm, ConfirmDialog, confirmOpen, dismissConfirm } from "./app/confirm";
import { askScope, ScopePrompt, type ScopeAnchor } from "./app/scopePrompt";
import { moveCard, reuseUnchanged } from "./app/cardOrder";


// As many as the backend's preview of an email query returns
const NEW_CARD_PREVIEW_EVENTS = 5;

function App() {
  const [loading, setLoading] = createSignal(true);

  // Thread View State
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
  const [activeThreadCardId, setActiveThreadCardId] = createSignal<string | null>(null);
  const [activeThread, setActiveThread] = createSignal<FullThread | null>(null);
  // The open thread's account, kept while an action takes it out of its card
  const [activeThreadAccountId, setActiveThreadAccountId] = createSignal<string | null>(null);
  // CID attachment data fetched on-demand for inline images (cid -> base64 data)
  const [cidAttachmentData, setCidAttachmentData] = createSignal<Record<string, string>>({});
  const [threadLoading, setThreadLoading] = createSignal(false);
  const [threadError, setThreadError] = createSignal<string | null>(null);
  const [focusedMessageIndex, setFocusedMessageIndex] = createSignal(0);

  // Event View State
  const [activeEvent, setActiveEvent] = createSignal<GoogleCalendarEvent | null>(null);
  const [activeEventCardId, setActiveEventCardId] = createSignal<string | null>(null);
  const [activeEventAccountId, setActiveEventAccountId] = createSignal<string | null>(null);

  // Calendar drawer state (for events)
  const [calendarDrawerOpen, setCalendarDrawerOpen] = createSignal(false);
  // Each account's calendars, loaded when first needed
  const [calendarsByAccount, setCalendarsByAccount] = createStore<Record<string, CalendarInfo[]>>({});
  const [calendarsLoading, setCalendarsLoading] = createStore<Record<string, boolean>>({});
  const calendarsFor = (accountId: string | undefined) => (accountId && calendarsByAccount[accountId]) || [];

  // Label drawer state
  const [labelDrawerOpen, setLabelDrawerOpen] = createSignal(false);
  // Each account's labels; label ids repeat across mailboxes
  const [labelsByAccount, setLabelsByAccount] = createStore<Record<string, GmailLabel[]>>({});
  const [labelsLoading, setLabelsLoading] = createSignal(false);
  const [labelsFailed, setLabelsFailed] = createSignal(false);
  const [labelSearchQuery, setLabelSearchQuery] = createSignal("");

  // The banner: a sentence, and the backend's own text behind Details
  const [error, setErrorState] = createSignal<{ message: string; details?: string } | null>(null);
  const setError = (message: string | null) => setErrorState(message === null ? null : { message });
  // "Couldn't …" in the banner, the error itself only under Details
  function setFailure(failure: string, e: unknown) {
    console.error(`${failure}:`, e);
    setErrorState(failureMessage(failure, e));
  }
  // The same as an error toast, with Retry when it can be tried again
  function showFailure(failure: string, e: unknown, retry?: () => void) {
    console.error(`${failure}:`, e);
    toasts.show({ message: failureMessage(failure, e).message, tone: "error", action: retry && { label: "Retry", run: retry } });
  }
  const [expiredAccountId, setExpiredAccountId] = createSignal<string | null>(null);
  // Set when Google couldn't be reached or the Mac says it's offline, until
  // a request gets through
  const [offline, setOffline] = createSignal(typeof navigator !== "undefined" && navigator.onLine === false);
  const [reconnecting, setReconnecting] = createSignal(false);
  const [accounts, setAccounts] = createSignal<Account[]>([]);
  // The default account: new emails, new cards and new events are its, and
  // Settings' account section is about it. Cards show every account.
  const [selectedAccount, setSelectedAccount] = createSignal<Account | null>(null);
  const accountById = (id: string | null | undefined) => (id ? accounts().find(a => a.id === id) ?? null : null);
  const cardById = (id: string | null | undefined) => (id ? boardCards().find(c => c.id === id) : undefined);
  // Whether this card shows mail of an account that needs signing in again
  const cardExpired = (card: Card) => { const expired = expiredAccountId(); return !!expired && cardCoversAccount(card, expired); };
  const [cards, setCards] = createSignal<Card[]>([]);
  // The search the filter bar ran, shown ahead of the stored cards until it
  // is kept or closed
  const [searchCard, setSearchCard] = createSignal<Card | null>(null);
  const boardCards = () => { const search = searchCard(); return search ? [search, ...cards()] : cards(); };
  const [authLoading, setAuthLoading] = createSignal(false);
  const [cardThreads, setCardThreads] = createStore<Record<string, ThreadGroup[]>>({});
  const [cardCalendarEvents, setCardCalendarEvents] = createStore<Record<string, GoogleCalendarEvent[]>>({});
  const [loadingThreads, setLoadingThreads] = createStore<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = createStore<Record<string, string | null>>({});
  const [collapsedCards, setCollapsedCards] = createStore<Record<string, boolean>>({});

  // The account a card's thread came from
  function threadOwner(threadId: string | null, cardId: string | null | undefined): Account | null {
    const card = cardById(cardId);
    const listed = (cardThreads[cardId ?? ""] ?? []).flatMap(g => g.threads).find(t => t.gmail_thread_id === threadId);
    return accountById(threadAccountId(listed ?? { account_id: "" }, card));
  }
  // When a thread last heard a letter: from the open thread, else its card row
  function threadLastDate(threadId: string): Date | null {
    const open = activeThread();
    if (open?.id === threadId) return latestDate(open.messages.map(messageDate));
    const listed = Object.values(cardThreads).flatMap(groups => groups.flatMap(g => g.threads)).find(t => t.gmail_thread_id === threadId);
    return listed?.last_message_date ? new Date(listed.last_message_date) : null;
  }
  // The account whose calendar an event is on
  function eventOwner(event: GoogleCalendarEvent, cardId?: string | null): Account | null {
    const card = cardById(cardId)
      ?? cards().find(c => c.account_id !== ALL_ACCOUNTS && cardCalendarEvents[c.id]?.some(e => e.id === event.id));
    return accountById(eventAccountId(event, card));
  }
  const activeThreadAccount = () => accountById(activeThreadAccountId());
  const activeEventAccount = () => accountById(activeEventAccountId());
  const [cardPageTokens, setCardPageTokens] = createStore<Record<string, string | null>>({});
  const [cardHasMore, setCardHasMore] = createStore<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = createStore<Record<string, boolean>>({});

  // Sync status tracking
  const [lastSyncTimes, setLastSyncTimes] = createStore<Record<string, number>>({});
  const [syncErrors, setSyncErrors] = createStore<Record<string, string | null>>({});
  // Ticking clock for relative time displays
  const [currentTime, setCurrentTime] = createSignal(Date.now());
  // Local midnight of the current day; notifies once a day, so "Today" labels
  // and today's times move on at midnight without re-rendering every tick
  const today = createMemo(() => new Date(currentTime()).setHours(0, 0, 0, 0));
  // formatTime reads the clock itself; reading today() re-runs it at midnight
  // A row's time: the clock inside the Today and Yesterday groups, whose
  // headers already name the day, else the date
  const threadTime = (timestamp: number, groupLabel?: string) => {
    today();
    if (groupLabel === "Today" || groupLabel === "Yesterday") return formatClock(new Date(timestamp));
    return formatTime(timestamp);
  };

  // Each account's Google Contacts from the People API
  const [contactsByAccount, setContactsByAccount] = createStore<Record<string, Contact[]>>({});
  const googleContacts = () => Object.values(contactsByAccount).flat();

  // The user's answer to each invite, by rsvpLookups.key(account, event uid):
  // "accepted" | "tentative" | "declined" | "needsAction"
  const [rsvpStatus, setRsvpStatus] = createStore<Record<string, string>>({});
  const [rsvpLoading, setRsvpLoading] = createStore<Record<string, boolean>>({});
  const rsvpLookups = createRsvpLookups({ lookup: getCalendarRsvpStatus, onStatus: setRsvpStatus });
  const inviteRsvp = (account: Account | null, uid: string | null) =>
    account && uid ? rsvpStatus[rsvpLookups.key(account.id, uid)] : undefined;
  // An invite that has happened or been called off steps back in its row
  const inviteIsOver = (invite: CalendarEvent | null, account: Account | null) => {
    if (!invite) return false;
    const state = inviteState(invite, inviteRsvp(account, invite.uid), minuteNow());
    return state === "past" || state === "cancelled";
  };

  // Previews of image attachments too big to come with the thread list
  const thumbnails = createThumbnails(downloadAttachmentApi);

  // Invite rows move on by the minute: the Now section, progress, now-lines
  const minuteNow = createMemo(() => currentTime(), undefined, { equals: (a, b) => Math.floor(a / 60_000) === Math.floor(b / 60_000) });
  // Each account's calendar around its unanswered invites, for day strips
  const [inviteDays, setInviteDays] = createStore<Record<string, DayEvents>>({});
  const inviteDayLookups = createInviteDayLookups({ fetch: fetchCalendarEvents, onEvents: (accountId, entry) => setInviteDays(accountId, entry) });

  // Answers an event listed in a calendar card or open in the event view
  const answerListedEvent = async (event: GoogleCalendarEvent, status: RsvpStatus, cardId?: string | null) => {
    const account = eventOwner(event, cardId);
    if (!account || rsvpLoading[event.id]) return;
    setRsvpLoading(event.id, true);
    try {
      await rsvpListedCalendarEvent(account.id, event.calendar_id, event.id, status);
      markEventRsvp(event.id, status, account);
      showToast(rsvpSentMessage(status));
    } catch (e) {
      showFailure("Couldn't send your RSVP", e);
    } finally {
      setRsvpLoading(event.id, false);
    }
  };

  // Answers an invite from its email; the calendar cards showing the event
  // pick up the answer too
  const handleRsvp = async (account: Account | null, threadId: string, eventUid: string | null, status: RsvpStatus) => {
    if (!eventUid || !account || rsvpLoading[threadId]) return;
    setRsvpLoading(threadId, true);
    try {
      await rsvpCalendarEvent(account.id, eventUid, status);
      setRsvpStatus(rsvpLookups.key(account.id, eventUid), status);
      const eventIds = new Set(Object.values(cardCalendarEvents).flatMap(events =>
        (events ?? []).filter(ev => inviteNamesEvent(eventUid, ev.id) && (!ev.account_id || ev.account_id === account.id)).map(ev => ev.id)));
      for (const eventId of eventIds) markEventRsvp(eventId, status, account);
      showToast(rsvpSentMessage(status));
    } catch (e) {
      showFailure("Couldn't send your RSVP", e);
    } finally {
      setRsvpLoading(threadId, false);
    }
  };

  // Undo/toast state
  interface UndoableAction {
    action: string;
    threadIds: string[];
    cardId: string;
    cardIds: string[]; // every card the optimistic update touched
    reversals: LabelReversal[];
    timestamp: number;
  }
  // The latest thread action, which a refresh landing just after it must not undo
  const [lastAction, setLastAction] = createSignal<UndoableAction | null>(null);
  const toasts = createToasts();
  // Tags the toast offering to discard a closed draft
  const discardDraftTag = (key: string) => `discard-draft:${key}`;

  // Undo send state
  const undoableSend = createUndoableSend<PendingSend>({
    delayMs: 5000,
    send: async pending => {
      await sendPending(pending);
      const fromBatch = batchReplyOrigins.get(pending);
      if (fromBatch?.cardId) fetchAndCacheThreads(fromBatch.cardId);
      const draft = pending.draft;
      if (draft) {
        markDraftSending(draft.key, null);
        drafts.discard(draft.key, pending.accountId, draft.gmailDraftId)
          .finally(() => sendingDraftKeys.delete(draft.key));
      }
    },
    onFailed: (pending, e) => {
      console.error("Failed to send email:", e);
      putBackSend(pending, failureMessage(`Couldn't send “${pending.subject || "(no subject)"}”`, e).message, "error");
    },
  });

  // Whether an open compose holds something replacing it would lose;
  // prefilled text alone (a reply's quote) can be had again
  function composeHasWork(): boolean {
    if (!composing() || closingCompose()) return false;
    return (composeEdited && hasDraftContent(composeDraftFields())) || composeAttachments().length > 0;
  }

  // Opening an email over one being written would replace it (and drop its
  // attachments); offer it in a toast instead
  function openComposeUnlessBusy(message: string, open: () => void) {
    if (composeHasWork()) showToast(message, { label: "Open", run: open });
    else open();
  }

  // A failed send says so even when its email opens again by itself
  function putBackSend(pending: PendingSend, message: string, tone: ToastTone = "info") {
    const fromBatch = batchReplyOrigins.get(pending);
    if (fromBatch && accountById(pending.accountId)) {
      restoreBatchReply(fromBatch);
      if (tone === "error") toasts.show({ message, tone });
      return;
    }
    if (pending.draft) {
      sendingDraftKeys.delete(pending.draft.key);
      markDraftSending(pending.draft.key, null);
    }
    const restore = () => restoreSend(pending);
    if (composeHasWork()) {
      toasts.show({ message, tone, action: { label: "Open", run: restore } });
      return;
    }
    restore();
    if (tone === "error") toasts.show({ message, tone });
  }

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

  // Where the board was double-clicked or right-clicked, while its flower is open
  const [boardFlowerAt, setBoardFlowerAt] = createSignal<{ x: number; y: number } | null>(null);
  // The corner hint teaching the flower, until it is first opened or dismissed
  const [boardHintShown, setBoardHintShown] = createSignal(safeGetItem("boardFlowerHintSeen") === null);
  const retireBoardHint = () => {
    if (!boardHintShown()) return;
    setBoardHintShown(false);
    safeSetItem("boardFlowerHintSeen", "1");
  };
  // Background color (stores index, not color value)
  // A stored index can be stale (BOARD_COLORS shrank/reordered) or corrupt;
  // render sites dereference BOARD_COLORS[idx] directly, so validate on load
  function readSavedBgColorIndex(): number | null {
    const raw = safeGetItem("bgColorIndex");
    if (raw === null) return null;
    const idx = parseInt(raw, 10);
    return Number.isInteger(idx) && idx >= 0 && idx < BOARD_COLORS.length ? idx : null;
  }
  const [selectedBgColorIndex, setSelectedBgColorIndex] = createSignal<number | null>(readSavedBgColorIndex());
  const boardHue = () => {
    const index = selectedBgColorIndex();
    return index === null ? undefined : BOARD_COLORS[index]?.hue;
  };
  // Named on <html> rather than the deck, which is rebuilt whenever the
  // signed-in account goes away and comes back. The stylesheet takes the hue
  // as the accent and a tint of it, per theme, as the board's background.
  createEffect(() => {
    const hue = boardHue();
    if (hue) document.documentElement.dataset.boardHue = hue;
    else delete document.documentElement.dataset.boardHue;
  });
  // The Dock icon's "p." wears the board's hue too, while the app runs
  const syncDockIcon = createDockIconSync(setDockIcon, svg => renderIconPng(svg, 512));
  createEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const svg = dockIconForHue(boardHue(), name => styles.getPropertyValue(name));
    syncDockIcon(svg).catch(e => console.error("Failed to set the dock icon:", e));
  });

  // Add card form
  const [addingCard, setAddingCard] = createSignal(false);
  const [closingAddCard, setClosingAddCard] = createSignal(false);
  const [newCardName, setNewCardName] = createSignal("");
  const [newCardQuery, setNewCardQuery] = createSignal("");
  const [newCardColor, setNewCardColor] = createSignal<CardColor>(null);
  const [newCardGroupBy, setNewCardGroupBy] = createSignal<GroupBy>("date");
  // The new card's account, or ALL_ACCOUNTS; null is the default account
  const [newCardAccountId, setNewCardAccountId] = createSignal<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = createSignal(false);
  let addCardFormRef: HTMLDivElement | undefined;

  // Scroll add card form into view when it appears
  createEffect(() => {
    if (addingCard() && addCardFormRef) {
      requestAnimationFrame(() => {
        addCardFormRef?.scrollIntoView({ behavior: smoothScroll(), block: 'nearest', inline: 'nearest' });
      });
    }
  });

  // Edit card state
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editCardName, setEditCardName] = createSignal("");
  const [editCardQuery, setEditCardQuery] = createSignal("");
  const [editCardColor, setEditCardColor] = createSignal<CardColor>(null);
  const [editCardGroupBy, setEditCardGroupBy] = createSignal<GroupBy>("date");
  const [editCardAccountId, setEditCardAccountId] = createSignal<string>("");
  const [editColorPickerOpen, setEditColorPickerOpen] = createSignal(false);
  // What the editor's fields held before the user touched them; a change
  // pulled from iCloud replaces only fields still holding it, so saving
  // doesn't write the pulled change back over
  let editCardStart: Pick<Card, "account_id" | "name" | "query" | "color" | "group_by"> | null = null;
  const editStartOf = (card: Card) => ({ account_id: card.account_id, name: card.name, query: card.query, color: card.color || null, group_by: card.group_by || "date" });
  // Whether the card being edited differs from where its edit started
  const editCardDirty = () => {
    const start = editCardStart;
    if (!start) return true;
    return start.name !== editCardName() || start.query !== editCardQuery() || start.color !== (editCardColor() || null)
      || start.group_by !== editCardGroupBy() || start.account_id !== editCardAccountId();
  };

  // The account (or ALL_ACCOUNTS) of the card being edited or added, which
  // its query preview searches
  const formScope = () => editingCardId() ? editCardAccountId() : newCardAccountId() ?? selectedAccount()?.id ?? null;

  // While editing, the card body doubles as a live preview: it keeps showing
  // the card's real content until the draft query diverges from the saved one
  function isPreviewingQuery(cardId: string): boolean {
    if (editingCardId() !== cardId) return false;
    const card = cards().find(c => c.id === cardId);
    if (!card) return false;
    return editCardQuery().trim() !== card.query.trim() || editCardAccountId() !== card.account_id;
  }

  // When each card last went from showing rows to empty, for its postmark
  const postmarks = createPostmarkLedger();
  // A filtered or previewed card that shows nothing says what matched nothing
  const noMatchFor = (cardId: string): NoMatch | null => {
    if (isPreviewingQuery(cardId)) return { kind: "query" };
    if (isSearchCard(cardId)) return { kind: "search", term: searchCard()?.query ?? "" };
    if (filterHides()) return { kind: "filter", term: globalFilter().trim(), onSearch: () => runSearch(), onClear: closeSearch };
    return null;
  };

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

  // Native context menu for attachments. Its items live in the backend until
  // closed, so one menu serves every right-click, acting on the attachment
  // clicked last.
  type MenuAttachment = { accountId: string; messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null };
  let menuAttachment: MenuAttachment | null = null;
  let attachmentMenu: Promise<Menu> | null = null;
  function createAttachmentMenu(): Promise<Menu> {
    const withAttachment = (run: (att: MenuAttachment) => void) => () => { if (menuAttachment) run(menuAttachment); };
    return (async () => Menu.new({
      items: [
        await MenuItem.new({ text: "Open", action: withAttachment(att => openAttachment(att.accountId, att.messageId, att.attachmentId, att.filename, att.mimeType, att.inlineData)) }),
        await MenuItem.new({ text: "Download", action: withAttachment(att => downloadAttachment(att.accountId, att.messageId, att.attachmentId, att.filename, att.mimeType, att.inlineData)) }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({ text: "Forward", action: withAttachment(forwardAttachment) }),
      ],
    }))();
  }
  async function showAttachmentContextMenu(att: MenuAttachment) {
    menuAttachment = att;
    try {
      attachmentMenu ??= createAttachmentMenu();
      await (await attachmentMenu).popup();
    } catch (e) {
      attachmentMenu = null;
      console.error("Failed to show the attachment menu:", e);
    }
  }

  // Attach to the open compose, or start a new email with it
  async function forwardAttachment(att: MenuAttachment) {
    try {
      const data = att.inlineData || await downloadAttachmentApi(att.accountId, att.messageId, att.attachmentId);
      // The compose that is animating out is done; start a new one
      if (!composing() || closingCompose()) startCompose({ accountId: att.accountId });
      setComposeAttachments([...composeAttachments(), { filename: att.filename, mime_type: att.mimeType, data }]);
    } catch (e) {
      console.error("Failed to forward attachment:", e);
      showFailure(`Couldn't forward ${att.filename}`, e);
    }
  }

  // Card query preview
  const [queryPreviewThreads, setQueryPreviewThreads] = createSignal<ThreadGroup[]>([]);
  const [queryPreviewCalendarEvents, setQueryPreviewCalendarEvents] = createSignal<GoogleCalendarEvent[]>([]);
  const [queryPreviewLoading, setQueryPreviewLoading] = createSignal(false);
  const [queryPreviewError, setQueryPreviewError] = createSignal<string | null>(null);
  const [queryHelpOpen, setQueryHelpOpen] = createSignal(false);
  const [globalFilter, setGlobalFilter] = createSignal("");
  const [showGlobalFilter, setShowGlobalFilter] = createSignal(false);
  let filterInputRef: HTMLInputElement | undefined;
  // Typing narrows the loaded cards; once the typed search has run, the
  // cards show everything again and fade what the search didn't find
  const searchShown = () => { const search = searchCard(); return !!search && search.query === globalFilter().trim(); };
  const filterHides = () => globalFilter().trim() !== "" && !searchShown();
  const searchFound = createMemo(() => {
    if (!searchCard()) return null;
    return new Set([
      ...(cardThreads[SEARCH_CARD_ID] ?? []).flatMap(g => g.threads.map(t => t.gmail_thread_id)),
      ...(cardCalendarEvents[SEARCH_CARD_ID] ?? []).map(e => e.id),
    ]);
  });
  const fadedBySearch = (cardId: string, itemId: string) => {
    const found = searchFound();
    return !!found && searchShown() && !isSearchCard(cardId) && !loadingThreads[SEARCH_CARD_ID] && !found.has(itemId);
  };
  const [recentSearches, setRecentSearches] = createSignal<string[]>(parseRecentSearches((() => { try { return localStorage.getItem("recentSearches"); } catch { return null; } })()));
  // Inserts text at the caret of the query field shown or focused last
  let insertIntoQueryField: ((text: string) => void) | null = null;
  let queryPreviewTimeout: number | undefined;

  // Preview requests can resolve out of order; only the latest may render
  let queryPreviewSeq = 0;

  async function fetchQueryPreview(query: string) {
    const seq = ++queryPreviewSeq;

    setQueryPreviewError(null);
    const rangeError = calendarRangeError(query);
    if (!query.trim() || rangeError) {
      setQueryPreviewThreads([]);
      setQueryPreviewCalendarEvents([]);
      setQueryPreviewError(rangeError);
      setQueryPreviewLoading(false);
      return;
    }

    const scope = formScope();
    if (!scope) {
      setQueryPreviewLoading(false);
      return;
    }

    setQueryPreviewLoading(true);

    // Fetch calendar events for calendar queries
    if (cardTypeForQuery(query) === "calendar") {
      setQueryPreviewThreads([]);
      try {
        const events = await fetchCalendarEvents(scope, query);
        if (seq !== queryPreviewSeq) return;
        setQueryPreviewCalendarEvents(events);
      } catch (e) {
        if (seq !== queryPreviewSeq) return;
        setQueryPreviewCalendarEvents([]);
        console.warn("Query preview failed:", e);
        setQueryPreviewError(queryPreviewErrorMessage(e, true));
      } finally {
        if (seq === queryPreviewSeq) setQueryPreviewLoading(false);
      }
      return;
    }

    // Fetch threads for email queries
    setQueryPreviewCalendarEvents([]);
    try {
      const groups = await searchThreadsPreview(scope, query);
      if (seq !== queryPreviewSeq) return;
      setQueryPreviewThreads(groups);
    } catch (e) {
      if (seq !== queryPreviewSeq) return;
      setQueryPreviewThreads([]);
      console.warn("Query preview failed:", e);
      setQueryPreviewError(queryPreviewErrorMessage(e, false));
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
  // Rows read these rather than quickReply(), which changes on every keystroke
  const isQuickReplyThread = createSelector(createMemo(() => quickReply().threadId));
  const isQuickReplyEvent = createSelector(quickReplyEventId);

  // Open quick reply for a thread/event, closing the other target and clearing
  // draft text whenever the target changes so text never leaks between them
  // (a reply still sending to the previous target doesn't block the new one)
  function openThreadQuickReply(threadId: string, cardId: string) {
    setQuickReplyEventId(null);
    setQuickReply(qr => (qr.threadId === threadId ? qr : { threadId, text: "", sending: false }));
    setQuickReplyCardId(cardId);
  }

  function openEventQuickReply(eventId: string) {
    const sameTarget = quickReplyEventId() === eventId;
    setQuickReply(qr => (sameTarget ? { ...qr, threadId: null } : { threadId: null, text: "", sending: false }));
    setQuickReplyCardId(null);
    setQuickReplyEventId(eventId);
  }

  // Thread actions wheel
  const [hoveredThread, setHoveredThread] = createSignal<string | null>(null);
  const [actionsWheelOpen, setActionsWheelOpen] = createSignal(false);
  const [actionConfigMenu, setActionConfigMenu] = createSignal<{ x: number; y: number; isEvent?: boolean } | null>(null);
  // Any press outside the wheel's settings menu closes it; most clicks on the
  // board stop before they reach the app's own handler
  createEffect(() => {
    if (!actionConfigMenu()) return;
    const onPress = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".action-config-menu")) setActionConfigMenu(null);
    };
    document.addEventListener("pointerdown", onPress, true);
    onCleanup(() => document.removeEventListener("pointerdown", onPress, true));
  });
  let hoverActionsTimeout: number | undefined;

  // Event actions wheel
  const [hoveredEvent, setHoveredEvent] = createSignal<string | null>(null);
  const [eventActionsWheelOpen, setEventActionsWheelOpen] = createSignal(false);
  // Hover is kept per card (rowKey): an email in two cards is two rows
  const isHoveredThread = createSelector(hoveredThread);
  const isHoveredEvent = createSelector(hoveredEvent);
  let hoverEventActionsTimeout: number | undefined;

  // A row's wheel opens once the pointer rests on it, so passing over a list
  // doesn't bloom a wheel on every row; moving on from an open one is instant
  // Leaving a row for somewhere near its open wheel keeps the wheel; another
  // row entered there waits until the pointer moves away from it
  const threadHold = createHoverHold();
  const eventHold = createHoverHold();
  const openWheelIn = (e?: MouseEvent) => (e?.currentTarget as Element | null)?.querySelector(`.radial-menu[role="menu"]`);

  function showThreadHoverActions(cardId: string, threadId: string, e?: MouseEvent) {
    const key = rowKey(cardId, threadId);
    if (e && key !== hoveredThread() && threadHold.wait(key, e.clientX, e.clientY, () => showThreadHoverActions(cardId, threadId))) return;
    threadHold.release();
    eventHold.release();
    clearTimeout(hoverActionsTimeout);
    // Close event wheel when showing thread wheel
    setEventActionsWheelOpen(false);
    setHoveredEvent(null);

    const open = () => {
      setHoveredThread(key);
      setActionsWheelOpen(true);
    };
    if (actionsWheelOpen()) open();
    else hoverActionsTimeout = window.setTimeout(open, RADIAL_HOVER_OPEN_MS);
  }

  function hideThreadHoverActions(cardId: string, threadId: string, e?: MouseEvent) {
    const key = rowKey(cardId, threadId);
    if (key !== hoveredThread() && threadHold.leave(key)) return;
    clearTimeout(hoverActionsTimeout);
    // The answer menu opens outside the row; reaching into it isn't leaving
    if (document.querySelector('.invite-answer[aria-expanded="true"]')) return;
    const close = () => {
      hoverActionsTimeout = window.setTimeout(() => {
        setActionsWheelOpen(false);
        setHoveredThread(null);
      }, RADIAL_HOVER_CLOSE_MS);
    };
    if (e && threadHold.hold(openWheelIn(e), e.clientX, e.clientY, close)) return;
    close();
  }

  function showEventHoverActions(cardId: string, eventId: string, e?: MouseEvent) {
    const key = rowKey(cardId, eventId);
    if (e && key !== hoveredEvent() && eventHold.wait(key, e.clientX, e.clientY, () => showEventHoverActions(cardId, eventId))) return;
    eventHold.release();
    threadHold.release();
    clearTimeout(hoverEventActionsTimeout);
    // Close thread wheel when showing event wheel
    setActionsWheelOpen(false);
    setHoveredThread(null);

    const open = () => {
      setHoveredEvent(key);
      setEventActionsWheelOpen(true);
    };
    if (eventActionsWheelOpen()) open();
    else hoverEventActionsTimeout = window.setTimeout(open, RADIAL_HOVER_OPEN_MS);
  }

  function hideEventHoverActions(cardId: string, eventId: string, e?: MouseEvent) {
    const key = rowKey(cardId, eventId);
    if (key !== hoveredEvent() && eventHold.leave(key)) return;
    clearTimeout(hoverEventActionsTimeout);
    const close = () => {
      hoverEventActionsTimeout = window.setTimeout(() => {
        setEventActionsWheelOpen(false);
        setHoveredEvent(null);
      }, RADIAL_HOVER_CLOSE_MS);
    };
    if (e && eventHold.hold(openWheelIn(e), e.clientX, e.clientY, close)) return;
    close();
  }

  const [selectedThreads, setSelectedThreads] = createSignal<Record<string, Set<string>>>({});
  const [lastSelectedThread, setLastSelectedThread] = createSignal<Record<string, string | null>>({});

  // Event selection (like thread selection)
  const [selectedEvents, setSelectedEvents] = createSignal<Record<string, Set<string>>>({});
  const [lastSelectedEvent, setLastSelectedEvent] = createSignal<Record<string, string | null>>({});

  // Compose
  const [composing, setComposing] = createSignal(false);
  // The account a compose sends from, set when it opens: the thread's or
  // event's for a reply, else the default account. Changing the default
  // mid-compose changes neither the sender nor where its draft is saved. A
  // compose opened before any account was signed in adopts the first one.
  const [composeAccount, setComposeAccount] = createSignal<Account | null>(null);
  let composeOpeningAccountId: string | undefined;
  createComputed(on([composing, selectedAccount], ([open, account], prev) => {
    if (!open || (prev?.[0] && untrack(composeAccount))) return;
    const adopting = !!prev?.[0] && !!account;
    setComposeAccount(untrack(() => accountById(composeOpeningAccountId)) ?? account);
    if (adopting) untrack(() => moveComposeDraftTo(account.id));
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
    // Chosen in the form; null goes to the default calendar
    calendarId: string | null;
    addMeet: boolean;
    saving: boolean;
    error: string | null;
    editing: { id: string; calendarId: string; accountId: string } | null;
    closing: boolean;
  }

  const defaultEventForm = (): EventFormState => {
    const defaults = smartEventDefaults();
    return {
      summary: "", description: "", location: "",
      startDate: defaults.date, startTime: defaults.startTime,
      endDate: defaults.endDate, endTime: defaults.endTime,
      allDay: false, attendees: "", recurrence: null, calendarId: null, addMeet: false,
      saving: false, error: null, editing: null, closing: false,
    };
  };

  const [eventForm, setEventForm] = createSignal<EventFormState>(defaultEventForm());

  // A new event starts now; what was typed into a closed new-event form stays,
  // but an event's edit never carries into a new one
  // `about` starts the event from an email thread instead
  const openNewEventForm = (about?: { summary: string; attendees: string }) => {
    // One panel at a time: an email in the compose panel closes, keeping its draft
    if (composeShownIn() === "panel" && composing() && !closingCompose()) closeCompose();
    const defaults = smartEventDefaults();
    setEventForm(f => about
      ? { ...defaultEventForm(), ...about }
      : f.editing
      ? defaultEventForm()
      : { ...f, startDate: defaults.date, startTime: defaults.startTime, endDate: defaults.endDate, endTime: defaults.endTime });
    setCreatingEvent(true);
    fetchAvailableCalendars(eventFormAccount()?.id);
  };
  // An edited event's account; a new event is the default account's
  const eventFormAccount = () => {
    const editing = eventForm().editing;
    return editing ? accountById(editing.accountId) : selectedAccount();
  };
  // The user's other events on the event form's day, for its timeline, read
  // with the invite strips' calendar lookups; a past day isn't looked up
  const eventFormDay = () => {
    const start = new Date(eventForm().startDate + "T00:00");
    return { start: start.getTime(), end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime() };
  };
  createEffect(() => {
    const account = eventFormAccount();
    if (!creatingEvent() || !account || eventForm().allDay) return;
    const { end } = eventFormDay();
    if (end > Date.now()) inviteDayLookups.request(account.id, end);
  });
  const eventFormDayBusy = createMemo<DayBusy | undefined>(() => {
    const account = eventFormAccount();
    if (!creatingEvent() || !account) return undefined;
    const { start, end } = eventFormDay();
    const now = minuteNow();
    if (end <= now) return undefined;
    if (rangeDaysFor(end, now) === null) return "unavailable";
    const known = inviteDays[account.id];
    if (!known || known.until < end) return "loading";
    const editingId = eventForm().editing?.id;
    return dayOtherEvents(known.events.filter(e => e.id !== editingId), { start, end: start, uid: null });
  });
  const newEventCalendarId = () => {
    const account = eventFormAccount();
    return eventForm().calendarId ?? (account ? defaultCalendarId(calendarsFor(account.id), lastUsedCalendar(account.id)) : null);
  };
  // The form is kept nowhere once closed, so typed details need a yes first
  const dismissEventForm = async () => {
    const f = eventForm();
    const typed = [f.summary, f.description, f.location, f.attendees].some(v => v.trim());
    if (f.closing || (typed && !(await askConfirm({ title: "Discard this event?", message: "What you typed in it is lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" })))) return;
    if (creatingEvent()) closeEventForm();
  };
  // The form can open over a thread or event view, so Escape reaches it first
  useLayer(() => creatingEvent(), () => { dismissEventForm(); });
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
  // The board's +, bloomed into a wheel of new things, ringed with the
  // contacts and events to start them from
  const [slotOpen, setSlotOpen] = createSignal(false);
  const composeFabHovered = slotOpen;
  const eventFabHovered = slotOpen;
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
  let slotCloseTimeout: number | undefined;
  let slotButton: HTMLButtonElement | undefined;
  const openSlot = () => {
    clearTimeout(slotCloseTimeout);
    setSlotOpen(true);
  };
  let draftSaveTimeout: number | undefined;
  const drafts = createDraftSync();
  // Where the open compose keeps its draft, chosen when it opens
  let composeDraftKey = "";
  // Typed in since it opened; prefilled text alone (a signature, a quoted
  // message) is no draft
  let composeEdited = false;
  // Drafts of emails queued or going out; not offered to a new compose
  const sendingDraftKeys = new Set<string>();

  function composeDraftFields(): DraftFields {
    const attachmentNames = composeAttachments().map(a => a.filename);
    return {
      to: composeTo(),
      cc: composeCc(),
      bcc: composeBcc(),
      subject: composeSubject(),
      body: composeBody(),
      threadId: replyingToThread()?.threadId,
      replyMessageId: replyingToThread()?.messageId,
      forwardThreadId: forwardingThread()?.threadId,
      attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
    };
  }

  // A compose opened before any account saved its draft under no account;
  // file it under the account it adopted, where that account's composes and
  // sign-out look for it
  function moveComposeDraftTo(accountId: string) {
    const key = sessionDraftKey(draftKey(accountId, {
      replyThreadId: replyingToThread()?.threadId,
      forwardThreadId: forwardingThread()?.threadId,
      replyEventId: replyingToEvent()?.eventId,
      forwardEventId: forwardingEvent()?.eventId,
    }));
    const stored = safeGetItem(composeDraftKey);
    if (stored !== null && !safeSetItem(key, stored)) return;
    safeRemoveItem(composeDraftKey);
    composeDraftKey = key;
  }

  // Named in a reply with more than one account signed in
  const composeFromEmail = () => (accounts().length > 1 ? composeAccount()?.email : undefined);
  // A new email can go out from any account; a reply from its thread's
  const composeIsReply = () => !!replyingToThread() || !!replyingToEvent();

  // Sends the open compose from another account: its draft moves to that
  // account, and its signature takes the old one's place
  function changeComposeAccount(accountId: string) {
    const next = accountById(accountId);
    const previous = composeAccount();
    if (!next || next.id === previous?.id || !composing() || closingCompose()) return;
    // The Gmail draft saved so far is in the old account's Drafts
    const oldDraftId = drafts.gmailDraftId();
    cancelDraftSave();
    drafts.detach();
    if (previous && oldDraftId) {
      deleteDraft(previous.id, oldDraftId).catch(e => console.warn("Failed to delete the old account's draft:", e));
    }
    setComposeAccount(next);
    moveComposeDraftTo(next.id);
    setComposeBody(swapSignature(composeBody(), previous?.signature, next.signature));
    handleComposeInput();
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
    composeEdited = true;
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
    return findLatestDraft(group, (draft, key) => !sendingDraftKeys.has(key) && (!forNewEmail || !draft.closed));
  }

  // Batch Reply
  const [batchReplyOpen, setBatchReplyOpen] = createSignal(false);
  const [batchReplyCardId, setBatchReplyCardId] = createSignal<string | null>(null);
  const [batchReplyThreads, setBatchReplyThreads] = createSignal<BatchReplyThread[]>([]);
  const [batchReplyMessages, setBatchReplyMessages] = createSignal<Record<string, string>>({});
  const [batchReplyLoading, setBatchReplyLoading] = createSignal(false);
  const [batchReplyAttachments, setBatchReplyAttachments] = createSignal<Record<string, SendAttachment[]>>({});
  // Inline image data downloaded for each thread's message (thread id -> cid -> data)
  const [batchReplyCidData, setBatchReplyCidData] = createSignal<Record<string, Record<string, string>>>({});
  // Set when none of the batch's threads could be loaded, with what to retry
  const [batchReplyError, setBatchReplyError] = createSignal<{ message: string; threadIds: string[] } | null>(null);

  // Settings form
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  // The stored OAuth client's ID: null when none is stored, undefined while
  // it couldn't be read
  const [storedClientId, setStoredClientId] = createSignal<string | null | undefined>(undefined);
  const [googleFormOpen, setGoogleFormOpen] = createSignal(false);
  const [signInFailed, setSignInFailed] = createSignal(false);
  const [geminiKeyDraft, setGeminiKeyDraft] = createSignal("");
  // undefined until the keychain has answered, so views ask it themselves
  const [geminiKeySaved, setGeminiKeySaved] = createSignal<boolean | undefined>(undefined);
  const [smartRepliesOpen, setSmartRepliesOpen] = createSignal(false);

  // Preset selection for new accounts
  const [showPresetSelection, setShowPresetSelection] = createSignal(false);
  // Bumped when a replaced layout is kept, so Settings offers it back
  const [layoutSnapshotVersion, setLayoutSnapshotVersion] = createSignal(0);

  // Enhanced polling with adaptive interval
  const BASE_POLL_INTERVAL = 30000; // 30 seconds
  const MAX_POLL_INTERVAL = 300000; // 5 minutes
  const [pollInterval, setPollInterval] = createSignal(BASE_POLL_INTERVAL);
  let pollTimeoutId: number | undefined;
  let isPolling = false;

  // Ask Gmail what changed in every account a card shows, and update the
  // cards showing each account's mail
  async function performIncrementalSync() {
    if (isPolling) return;
    const polled = accountsToPoll(cards(), accounts());
    if (polled.length === 0) return;

    isPolling = true;
    refreshCalendarCards();
    try {
      const changed = await Promise.all(polled.map(syncAccount));
      if (changed.some(c => c === null)) {
        // On error, backoff but don't stop polling
        setPollInterval(prev => Math.min(prev * 2, MAX_POLL_INTERVAL));
      } else if (changed.some(Boolean)) {
        setPollInterval(BASE_POLL_INTERVAL);
      } else {
        // Backoff when idle (multiply by 1.5, max 5 minutes)
        setPollInterval(prev => Math.min(Math.floor(prev * 1.5), MAX_POLL_INTERVAL));
      }
    } finally {
      isPolling = false;
    }
  }

  // Whether the account's mail changed; null when the sync failed
  async function syncAccount(account: Account): Promise<boolean | null> {
    try {
      const result = await syncThreadsIncremental(account.id);
      if (!accountById(account.id)) return false;
      setOffline(false);
      const covering = cards().filter(c => c.card_type !== "calendar" && cardCoversAccount(c, account.id));

      // Update sync times for non-collapsed email cards; calendar cards are
      // not touched by Gmail history sync and must not be stamped as synced
      const now = Date.now();
      const nonCollapsedCardIds = covering.filter(c => !collapsedCards[c.id]).map(c => c.id);
      if (nonCollapsedCardIds.length > 0) {
        setLastSyncTimes(produce(s => {
          for (const cardId of nonCollapsedCardIds) {
            s[cardId] = now;
          }
        }));
      }

      if (result.is_full_sync) {
        // History ID was reset; incremental results are unusable. Refetch
        // the account's non-collapsed email cards.
        for (const card of covering) {
          if (collapsedCards[card.id]) cardsMissingFullSync.add(card.id);
          else fetchAndCacheThreads(card.id);
        }
        return true;
      }
      applyIncrementalChanges(account.id, result.modified_threads, result.deleted_thread_ids);
      return result.modified_threads.length > 0 || result.deleted_thread_ids.length > 0;
    } catch (e) {
      console.error("Incremental sync failed:", e);
      noteBackgroundError(account.id, e);
      return null;
    }
  }

  // Apply one account's changes to the cards showing its mail
  function applyIncrementalChanges(accountId: string, modifiedThreads: Thread[], deletedThreadIds: string[]) {
    if (modifiedThreads.length === 0 && deletedThreadIds.length === 0) return;

    const updatedCardThreads: Record<string, ThreadGroup[]> = {};
    const matchedThreadIds = new Set<string>();
    const cardsWithModified = new Set<string>();
    const cardsWithDeleted = new Set<string>();
    const deleted = new Set(deletedThreadIds);
    const modifiedById = new Map(modifiedThreads.map(t => [t.gmail_thread_id, t]));
    const covering = cards().filter(c => c.card_type !== "calendar" && cardCoversAccount(c, accountId));

    for (const card of covering) {
      const cardId = card.id;
      const groups = cardThreads[cardId];
      if (!groups) continue;
      const ours = (t: Thread) => threadAccountId(t, card) === accountId;

      const updatedGroups = groups.map(group => {
        const threads = group.threads.filter(t => !(ours(t) && deleted.has(t.gmail_thread_id))).map(t => {
          const modified = ours(t) ? modifiedById.get(t.gmail_thread_id) : undefined;
          if (!modified) return t;
          matchedThreadIds.add(t.gmail_thread_id);
          cardsWithModified.add(cardId);
          return { ...modified, account_id: accountId };
        });
        if (threads.length !== group.threads.length) cardsWithDeleted.add(cardId);
        return { ...group, threads };
      });

      if (cardsWithModified.has(cardId) || cardsWithDeleted.has(cardId)) {
        updatedCardThreads[cardId] = updatedGroups.filter(g => g.threads.length > 0);
      }
    }

    // Reconciled so a changed thread's row updates in place, and only the
    // cards holding a change are touched
    batch(() => {
      for (const [cardId, groups] of Object.entries(updatedCardThreads)) {
        setCardThreads(cardId, reconcile(groups, { key: "gmail_thread_id" }));
      }
    });

    // A modified thread may no longer match its card's query (archived or
    // read elsewhere), and a thread in no card may be new to some card; only
    // the server can tell, so refetch the affected cards in the background
    const unmatched = modifiedThreads.filter(t => !matchedThreadIds.has(t.gmail_thread_id));
    for (const card of covering) {
      const mayGainThread = unmatched.some(t => threadMayJoinCard(t, card.query));
      if (!collapsedCards[card.id] && (mayGainThread || cardsWithModified.has(card.id))) {
        fetchAndCacheThreads(card.id);
      } else if (cardsWithDeleted.has(card.id)) {
        saveCardCache(card.id, updatedCardThreads[card.id], cardPageTokens[card.id] || null)
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

  // Card changes made on another Mac, merged in without clearing what the
  // existing cards show
  async function pullCardsFromICloud() {
    if (!selectedAccount()) return;
    try {
      if (!(await pullFromICloud())) return;
      const cardList = (await getCards()).filter(c => !heldCardDeletes.has(c.id));
      if (!selectedAccount()) return;
      const fetchedAs = (c: Card) => `${c.account_id}\n${c.query}`;
      const before = new Map(cards().map(c => [c.id, fetchedAs(c)]));
      const kept = new Set(cardList.map(c => c.id));
      setCards(reuseUnchanged(cards(), cardList));
      followPulledCardInEditor();
      forgetCardState([...before.keys()].filter(id => !kept.has(id)));
      for (const card of cardList) {
        if (before.get(card.id) === fetchedAs(card) || collapsedCards[card.id]) continue;
        // A changed card's cache holds its old query's or account's threads
        loadCardThreads(card.id, false, before.has(card.id));
      }
    } catch (e) {
      console.warn("iCloud card pull failed:", e);
    }
  }

  // Set while the stored OAuth client couldn't be read (a locked keychain);
  // the next window focus tries again
  let credentialsError: string | null = null;
  async function loadStoredCredentials() {
    const storedCreds = await getStoredCredentials();
    setStoredClientId(storedCreds?.client_id ?? null);
    if (storedCreds) {
      await configureAuth({
        client_id: storedCreds.client_id,
        client_secret: storedCreds.client_secret,
      });
    }
  }
  async function retryStoredCredentials() {
    const failed = credentialsError;
    if (!failed) return;
    try {
      await loadStoredCredentials();
      credentialsError = null;
      if (error()?.message === failed) setError(null);
    } catch (e) {
      console.warn("Stored credentials still unavailable:", e);
    }
  }

  // Handle window focus - reset to fast polling and sync immediately
  async function handleWindowFocus() {
    await retryStoredCredentials();
    setPollInterval(BASE_POLL_INTERVAL);
    setCurrentTime(Date.now());
    performIncrementalSync();
    pullCardsFromICloud();
    rsvpLookups.retryFailed();
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
      window.addEventListener("online", retryConnection);
      window.addEventListener("offline", goOffline);
    }
    fetchContacts(accountId)
      .then(contacts => { if (accountById(accountId)) setContactsByAccount(accountId, contacts); })
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
    if (!draggable || !droppable) return;
    const previousCards = cards();
    const reorderedCards = moveCard(previousCards, String(draggable.id), String(droppable.id));
    if (!reorderedCards) return;
    setCards(reorderedCards);
    try {
      await reorderCards(reorderedCards.map((c, index): [string, number] => [c.id, index]));
    } catch (err) {
      console.error("Failed to persist card order:", err);
      setCards(previousCards);
      showFailure("Couldn't save the card order", err);
    }
  };

  // Dock badge: unread threads across cards. The memo only notifies when the
  // total changes, so refreshes that change nothing don't touch the badge.
  const totalUnread = createMemo(() => {
    // A thread can match several cards; count it once in each account
    const unreadThreads = new Set<string>();
    for (const card of cards()) {
      for (const group of cardThreads[card.id] ?? []) {
        for (const thread of group.threads) {
          if (thread.unread_count > 0) unreadThreads.add(threadKey(thread, card));
        }
      }
    }
    return unreadThreads.size;
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
    // The webview would open a file dropped anywhere but a drop zone in
    // place of the app

    loadGeminiKeyState();
    pruneDrafts(Date.now());

    // Listen for mailto: deep-link events whether or not startup succeeds
    listen<MailtoData>(
      "mailto-received",
      (event) => openMailto(event.payload),
    ).then(unlisten => {
      if (disposed) unlisten();
      else unlistenMailto = unlisten;
    }).catch(e => console.warn("Failed to listen for mailto links:", e));

    try {
      await initApp();

      // A locked keychain must not keep the cached cards from showing
      try {
        await loadStoredCredentials();
      } catch (e) {
        console.warn("Stored credentials unavailable:", e);
        const failure = storedCredentialsFailure(e);
        credentialsError = failure.message;
        setErrorState(failure);
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
        setSelectedAccount(accts.find(a => a.id === safeGetItem("defaultAccountId")) ?? accts[0]);
        await loadBoard();
        for (const account of accts) startBackgroundSync(account.id);
      }
      offerUnsentDraft(accts);
    } catch (e) {
      setFailure("Couldn't start Posta", e);
    } finally {
      setLoading(false);
    }

    // The backend holds links, including the launch link, until they are
    // taken; taking them after startup lets compose pick up the account's
    // signature, and outside the startup try a failed load still opens them
    try {
      for (const mailto of await takePendingMailtos()) openMailto(mailto);
    } catch (e) {
      console.warn("mailto links unavailable:", e);
    }
  });

  // Only file drags: text dropped into a field must still land there
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
    dismissConfirm();
    window.removeEventListener("focus", handleWindowFocus);
    window.removeEventListener("online", retryConnection);
    window.removeEventListener("offline", goOffline);
    if (handleResize) window.removeEventListener("resize", handleResize);
    delete document.documentElement.dataset.boardHue;
    unlistenMailto?.();
  });

  // Helper to get all threads from a card as a flat array
  function getCardThreadsFlat(cardId: string): Thread[] {
    return getDisplayGroups(cardId).flatMap(g => g.threads);
  }

  // The open thread as its card lists it, with the attachments and invite
  // the listing parsed
  function activeListedThread(): Thread | undefined {
    const cardId = activeThreadCardId();
    const threadId = activeThreadId();
    if (!cardId || !threadId) return undefined;
    for (const group of cardThreads[cardId] || []) {
      const thread = group.threads.find(t => t.gmail_thread_id === threadId);
      if (thread) return thread;
    }
    return undefined;
  }

  // Get the focused thread
  function getFocusedThread(): Thread | null {
    const cardId = focusedCardId();
    const idx = focusedThreadIndex();
    if (!cardId || idx < 0) return null;
    const threads = getCardThreadsFlat(cardId);
    return threads[idx] || null;
  }

  // Selectors notify only the rows whose answer changes, so moving focus or
  // hovering updates two rows instead of every row of every card
  const rowKey = (cardId: string, itemId: string) => `${cardId}\n${itemId}`;
  const focusedThreadKey = createMemo(() => {
    const thread = getFocusedThread();
    return thread ? rowKey(focusedCardId()!, thread.gmail_thread_id) : null;
  });
  const isFocusedThreadKey = createSelector(focusedThreadKey);
  function isThreadFocused(cardId: string, threadId: string): boolean {
    return isFocusedThreadKey(rowKey(cardId, threadId));
  }

  // Get flattened list of calendar events for a card
  function getCardEventsFlat(cardId: string): GoogleCalendarEvent[] {
    return getCalendarEventGroups(cardId).flatMap(g => g.events);
  }

  const focusedEventKey = createMemo(() => {
    const event = getFocusedEvent();
    return event ? rowKey(focusedCardId()!, event.id) : null;
  });
  const isFocusedEventKey = createSelector(focusedEventKey);
  function isEventFocused(cardId: string, eventId: string): boolean {
    return isFocusedEventKey(rowKey(cardId, eventId));
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
      focusedCard?.scrollIntoView({ behavior: smoothScroll(), block: 'nearest', inline: 'center' });
      const focused = document.querySelector('.thread.focused, .calendar-event-item.focused');
      focused?.scrollIntoView({ behavior: smoothScroll(), block: 'nearest', inline: 'nearest' });
    });
  }

  // Focus a card and the item at `index` in it (-1 focuses the card only).
  // The row takes keyboard focus too, so Tab and j/k agree.
  function focusCardItem(cardId: string, index: number) {
    setFocusedCardId(cardId);
    const calendar = isCalendarCard(cardId);
    setFocusedEventIndex(calendar ? index : -1);
    setFocusedThreadIndex(calendar ? -1 : index);
    scrollFocusedIntoView();
    const card = `.card[data-id="${CSS.escape(cardId)}"]`;
    const row = document.querySelector<HTMLElement>(`${card} .thread.focused, ${card} .calendar-event-item.focused`);
    if (row && document.activeElement !== row) row.focus({ preventScroll: true });
  }

  // Roving tab stop: one row per card, the focused one or else the first
  const tabStopKeys = createMemo(() => {
    const keys = new Set<string>();
    for (const card of cards()) {
      if (collapsedCards[card.id]) continue;
      const items = isCalendarCard(card.id)
        ? getCardEventsFlat(card.id).map(ev => ev.id)
        : getCardThreadsFlat(card.id).map(t => t.gmail_thread_id);
      const focused = card.id === focusedCardId()
        ? items[isCalendarCard(card.id) ? focusedEventIndex() : focusedThreadIndex()]
        : undefined;
      const stop = focused ?? items[0];
      if (stop) keys.add(rowKey(card.id, stop));
    }
    return keys;
  });
  const rowTabIndex = (cardId: string, itemId: string) => (tabStopKeys().has(rowKey(cardId, itemId)) ? 0 : -1);

  // A row focused by Tab or a click becomes the j/k focus
  function onRowFocus(cardId: string, itemId: string) {
    const ids = isCalendarCard(cardId)
      ? getCardEventsFlat(cardId).map(ev => ev.id)
      : getCardThreadsFlat(cardId).map(t => t.gmail_thread_id);
    const index = ids.indexOf(itemId);
    if (index === -1) return;
    if (focusedCardId() === cardId && (isCalendarCard(cardId) ? focusedEventIndex() : focusedThreadIndex()) === index) return;
    focusCardItem(cardId, index);
  }

  // The row a thread or event view was opened from, for focus to go back to
  let openedFromRow: ItemFocus | null = null;
  function rememberOpenedRow(cardId: string, itemId: string) {
    const ids = isCalendarCard(cardId)
      ? getCardEventsFlat(cardId).map(ev => ev.id)
      : getCardThreadsFlat(cardId).map(t => t.gmail_thread_id);
    const index = ids.indexOf(itemId);
    openedFromRow = index === -1 ? null : { cardId, index };
  }
  // Back to that row, or the one now in its place when it left the card
  function restoreOpenedRowFocus() {
    const from = openedFromRow;
    openedFromRow = null;
    if (!from || !cards().some(c => c.id === from.cardId)) return;
    const count = (isCalendarCard(from.cardId) ? getCardEventsFlat(from.cardId) : getCardThreadsFlat(from.cardId)).length;
    if (count > 0) focusCardItem(from.cardId, Math.min(from.index, count - 1));
  }

  // When * was pressed, for a following a to select all
  let selectAllKeyAt = 0;
  const SELECT_ALL_WINDOW_MS = 1500;

  // Global keyboard shortcuts
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    // The dialog answers its own keys; nothing may act behind it
    if (confirmOpen()) return;
    const isTyping = isTypingTarget(e.target);

    // Cmd/Ctrl+F to open filter (works even when typing)
    if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      openSearch();
      return;
    }

    // Cmd/Ctrl+Enter to save event (works even when typing)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && creatingEvent() && eventForm().summary.trim() && !eventForm().saving) {
      e.preventDefault();
      handleCreateEvent();
      return;
    }

    // Skip other shortcuts if typing in an input
    if (isTyping) {
      return;
    }

    if (e.key === 'Escape' && authLoading()) {
      e.preventDefault();
      cancelSignIn();
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
    if (hasCommandModifier(e)) {
      return;
    }

    // z undoes what the toast offers to undo, even with overlays open
    if (e.key === 'z' && toasts.hasUndo()) {
      e.preventDefault();
      toasts.undo();
      return;
    }

    // ThreadView/EventView own the keyboard while open; without this, keys
    // like a/s/d also hit the focused thread *behind* the overlay
    // The new-event form over a thread is handled below like any overlay
    if ((activeThreadId() || activeEvent()) && !creatingEvent()) {
      return;
    }

    // Same for modals and panels over the cards; Escape still closes them
    const overlayOpen = settingsOpen() || shortcutsHelpOpen() || queryHelpOpen() || creatingEvent() || batchReplyOpen() || showPresetSelection();
    if (overlayOpen && e.key !== 'Escape') {
      return;
    }

    // / to open filter
    if (e.key === '/') {
      e.preventDefault();
      openSearch();
      return;
    }

    // p keeps the search the focused card shows
    if (e.key === 'p' && isSearchCard(focusedCardId())) {
      e.preventDefault();
      keepSearch();
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
      openNewEventForm();
      return;
    }

    // c to compose new email
    if (e.key === 'c') {
      e.preventDefault();
      if (!composing() || closingCompose()) startCompose({});
      return;
    }

    if (e.key === 'Escape') {
      const focused = focusedCardId();
      const target = escapeTarget({
        filter: showGlobalFilter(),
        accountChooser: accountChooserOpen(),
        colorPicker: colorPickerOpen() || editColorPickerOpen(),
        batchReply: batchReplyOpen(),
        compose: composing() && !closingCompose(),
        cardEditor: !!editingCardId(),
        settings: settingsOpen(),
        actionConfigMenu: !!actionConfigMenu(),
        selection: !!focused && !!(selectedThreads()[focused]?.size || selectedEvents()[focused]?.size),
        cardFocus: !!focused,
      });
      switch (target) {
        case "filter": closeSearch(); break;
        case "accountChooser": setAccountChooserOpen(false); break;
        case "colorPicker": setColorPickerOpen(false); setEditColorPickerOpen(false); break;
        case "batchReply": dismissBatchReply(); break;
        case "compose": closeCompose(); break;
        case "cardEditor": setEditingCardId(null); break;
        case "settings": setSettingsOpen(false); break;
        case "actionConfigMenu": setActionConfigMenu(null); break;
        case "selection":
          setSelectedThreads({ ...selectedThreads(), [focused!]: new Set() });
          setSelectedEvents({ ...selectedEvents(), [focused!]: new Set() });
          break;
        case "cardFocus": setFocusedCardId(null); setFocusedThreadIndex(-1); setFocusedEventIndex(-1); break;
      }
      return;
    }

    // Card navigation - h/l/ArrowLeft/ArrowRight for left/right between cards
    if (e.key === 'h' || e.key === 'l' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cardIds = boardCards().filter(c => !collapsedCards[c.id]).map(c => c.id);
      const move = nextCardFocus(cardIds, focusedCardId(), e.key === 'l' || e.key === 'ArrowRight', addingCard());
      if (!move) return;
      if (move.addingCard && !addingCard()) {
        setNewCardColor(null);
        setNewCardAccountId(null);
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
      const visible = boardCards().filter(c => !collapsedCards[c.id]).map(c => ({
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

    const cardId = focusedCardId();
    const threadCardId = cardId && !isCalendarCard(cardId) ? cardId : null;

    // * then a selects every thread in the focused card
    const selectAllArmed = selectAllKeyAt !== 0 && Date.now() - selectAllKeyAt < SELECT_ALL_WINDOW_MS;
    selectAllKeyAt = 0;
    if (e.key === '*') {
      e.preventDefault();
      selectAllKeyAt = Date.now();
      return;
    }
    if (selectAllArmed && e.key === 'a' && threadCardId) {
      e.preventDefault();
      setSelectedThreads({ ...selectedThreads(), [threadCardId]: new Set(getCardThreadsFlat(threadCardId).map(t => t.gmail_thread_id)) });
      return;
    }

    if ((e.key === 'J' || e.key === 'K') && threadCardId) {
      e.preventDefault();
      const ids = getCardThreadsFlat(threadCardId).map(t => t.gmail_thread_id);
      const next = extendSelection(ids, selectedThreads()[threadCardId] ?? new Set(), focusedThreadIndex(), e.key === 'J');
      setSelectedThreads({ ...selectedThreads(), [threadCardId]: next.selected });
      focusCardItem(threadCardId, next.index);
      return;
    }

    // With threads selected, the keys the bulk wheel shows act on all of them
    const selection = threadCardId ? selectedThreads()[threadCardId] : undefined;
    if (threadCardId && selection && selection.size > 0) {
      if (e.key === 'r') {
        e.preventDefault();
        startBatchReply(threadCardId, keyTargets(selection, null));
        return;
      }
      const action = bulkActionForKey(e.key);
      if (action) {
        e.preventDefault();
        handleThreadAction(action, keyTargets(selection, null), threadCardId);
        setSelectedThreads({ ...selectedThreads(), [threadCardId]: new Set() });
        return;
      }
    }

    // Quick actions on focused thread
    const thread = getFocusedThread();
    if (thread && cardId) {
      const invite = thread.calendar_event;
      // Only an invite still open to an answer takes one: not a past or cancelled one
      const answerable = !!invite && invite.method === "REQUEST" && !!invite.uid && !inviteIsOver(invite, threadOwner(thread.gmail_thread_id, cardId));
      const answer = answerable ? rsvpForKey(e) : null;
      if (answer) {
        e.preventDefault();
        const owner = threadOwner(thread.gmail_thread_id, cardId);
        if (inviteRsvp(owner, invite!.uid) !== answer) handleRsvp(owner, thread.gmail_thread_id, invite!.uid, answer);
        return;
      }
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
      const can = eventActions(event, eventOwner(event, cardId)?.email ?? '');
      const answer = can.rsvp ? rsvpForKey(e) : null;
      if (answer) {
        e.preventDefault();
        if (event.response_status !== answer) answerListedEvent(event, answer, cardId);
        return;
      }
      if (e.key === 'r' && (can.reply || can.emailGuests)) {
        e.preventDefault();
        openEventQuickReply(event.id);
        return;
      }
      if (e.key === 'x') {
        e.preventDefault();
        toggleEventSelection(cardId, event.id);
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
    // email must never navigate the app's own page.
    const link = target.closest('a') as HTMLAnchorElement | null;
    if (link && link.href && !e.defaultPrevented) {
      const inEmail = !!link.closest('.message-body');
      if (link.protocol === 'mailto:') {
        e.preventDefault();
        openMailto(parseMailto(link.href));
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

  // The account new emails, cards and events are made in. Every account's
  // cards stay on the board.
  function chooseDefaultAccount(account: Account) {
    setSelectedAccount(account);
    safeSetItem("defaultAccountId", account.id);
  }

  // Post-OAuth, for every new sign-in: restore the account's cards from
  // iCloud. A board still empty after that offers the preset picker; one
  // with other accounts' cards says what the new account brought.
  async function restoreLayoutAfterAuth(account: Account) {
    const first = !selectedAccount();
    upsertAccount(account);
    if (first) chooseDefaultAccount(account);

    let synced = false;
    try {
      synced = await pullLayoutWithRetry(pullFromICloud);
    } catch (e) {
      console.warn("iCloud pull failed:", e);
    }

    const board = await loadBoard();
    if (!board) return;
    startBackgroundSync(account.id);

    const count = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
    if (board.length === 0) {
      openPresetPicker();
    } else if (first) {
      if (synced) showToast(`Restored ${count(board.length)} from iCloud`, { label: "Choose a different layout", run: openPresetPicker });
    } else {
      // loadBoard leaves cards it already shows alone
      for (const card of board) {
        if (card.account_id === ALL_ACCOUNTS && !collapsedCards[card.id]) refetchCard(card);
      }
      const restored = board.filter(c => c.account_id === account.id).length;
      if (restored > 0) {
        showToast(`Restored ${count(restored)} for ${account.email}`);
        return;
      }
      const from = selectedAccount();
      const copies = from && from.id !== account.id ? copyableCards(board, from.id, account.id) : [];
      showToast(`Added ${account.email}`, [
        ...(copies.length > 0 ? [{ label: `Copy ${from!.email}'s cards`, run: () => addCards(copies) }] : []),
        { label: "Add a card", run: () => openAddCard(account.id) },
      ]);
    }
  }

  // Appends cards made from specs, each in the account it names
  async function addCards(specs: CardSpec[]) {
    const created: Card[] = [];
    try {
      for (const spec of specs) {
        created.push(await createCard(spec.account_id!, spec.name, spec.query, spec.color, spec.group_by, spec.card_type));
      }
    } catch (e) {
      setFailure("Couldn't create the cards", e);
    }
    setCards([...cards(), ...created]);
    created.forEach(card => loadCardThreads(card.id));
  }

  function openPresetPicker() {
    if (!selectedAccount()) return;
    setShowPresetSelection(true);
  }

  // Sign in with Google through the browser, then hand the account to
  // afterAuth. Uses the stored OAuth client unless Settings just configured
  // one; without either, sends the user to Settings.
  async function signInWithGoogle(afterAuth: (account: Account) => Promise<unknown>, { configured = false } = {}) {
    let storedCreds: Awaited<ReturnType<typeof getStoredCredentials>> = null;
    if (!configured) {
      try {
        storedCreds = await getStoredCredentials();
      } catch (e) {
        console.error("Couldn't read the saved Google credentials:", e);
        setErrorState(storedCredentialsFailure(e));
        return;
      }
    }
    if (!configured && !storedCreds) {
      setStoredClientId(null);
      // Signed out, the auth screen now walks through setup
      if (accounts().length > 0) {
        setGoogleFormOpen(true);
        setSettingsOpen(true);
      }
      return;
    }

    setAuthPhase("browser");
    setAuthLoading(true);
    setError(null);
    oauthCancelled = false;
    try {
      if (storedCreds) {
        await configureAuth({
          client_id: storedCreds.client_id,
          client_secret: storedCreds.client_secret,
        });
      }
      if (oauthCancelled) return;
      const account = await runOAuthFlow();
      setAuthPhase("setup");
      await afterAuth(account);
    } catch (e) {
      if (!oauthCancelled) {
        setSignInFailed(true);
        setFailure("Couldn't sign in", e);
      }
    } finally {
      setAuthLoading(false);
    }
  }

  // Waiting on Google in the browser, then loading the signed-in account
  const [authPhase, setAuthPhase] = createSignal<"browser" | "setup">("browser");
  function reopenSignInPage() {
    reopenOAuthPage().catch(e => setFailure("Couldn't open the sign-in page", e));
  }

  let oauthCancelled = false;
  function cancelSignIn() {
    oauthCancelled = true;
    cancelOAuthFlow().catch(e => console.warn("Failed to cancel sign-in:", e));
  }

  function handleSignIn() {
    return signInWithGoogle(restoreLayoutAfterAuth);
  }

  function handleAddAccount() {
    return signInWithGoogle(async account => {
      setSettingsOpen(false);
      await restoreLayoutAfterAuth(account);
    });
  }

  // Swap the board's cards for new ones, made in the account each spec
  // names or else the default account. The replaced layout is kept on this
  // Mac, so Settings can bring it back. Resolves to whether the swap went
  // through.
  let replacingLayout = false;
  async function replaceLayout(specs: (CardSpec & { collapsed?: boolean })[]): Promise<boolean> {
    const account = selectedAccount();
    if (!account || replacingLayout) return false;
    replacingLayout = true;
    try {
      const current = cards();
      if (current.length > 0) {
        saveLayoutSnapshot(account.email, cardSpecs(current), Date.now());
        setLayoutSnapshotVersion(v => v + 1);
        const results = await Promise.allSettled(current.map(card => deleteCard(card.id)));
        // Cards that failed to delete still exist; keep showing them rather
        // than piling new cards on top
        const remaining = current.filter((_, i) => results[i].status === "rejected");
        forgetCardState(current.filter((_, i) => results[i].status === "fulfilled").map(c => c.id));
        setCards(remaining);
        const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        if (failure) {
          setFailure("Couldn't replace the layout", failure.reason);
          return false;
        }
      }

      const newCards: Card[] = [];
      const collapsed: Record<string, boolean> = {};
      const signedIn = accounts().map(a => a.id);
      try {
        for (const spec of specs) {
          const owner = specAccountId(spec, signedIn, account.id);
          const created = await createCard(owner, spec.name, spec.query, spec.color, spec.group_by, spec.card_type);
          newCards.push(created);
          collapsed[created.id] = spec.collapsed ?? false;
        }
      } catch (e) {
        setFailure("Couldn't create the cards", e);
        // Nothing was created: stay on the picker so the user can retry
        if (newCards.length === 0) return false;
      }

      // Show whatever was created, even if a later card failed: the created
      // ones are already stored, and hiding them invites duplicates on retry
      setCards(newCards);
      saveCollapsedState(collapsed);
      newCards.forEach(card => { if (!collapsed[card.id]) loadCardThreads(card.id); });
      return true;
    } finally {
      replacingLayout = false;
    }
  }

  async function applyPreset(presetKey: string) {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    const specs = preset.cards.map(c => ({
      name: c.name, query: c.query, color: c.color || null, group_by: "date" as const, card_type: cardTypeForQuery(c.query), collapsed: c.collapsed,
    }));
    if (await replaceLayout(specs)) setShowPresetSelection(false);
  }

  const previousLayout = () => {
    layoutSnapshotVersion();
    if (!settingsOpen()) return null;
    const account = selectedAccount();
    return account ? loadLayoutSnapshot(account.email, Date.now()) : null;
  };

  async function restorePreviousLayout() {
    const snapshot = previousLayout();
    if (!snapshot) return;
    setSettingsOpen(false);
    await replaceLayout(snapshot.cards);
  }

  // Save a new OAuth client, then sign in with it: the current account
  // only, or the first one from the setup screen
  async function handleSaveSettings() {
    const id = clientId().trim();
    const secret = clientSecret().trim();
    if (!credentialsValid(id, secret)) return;

    try {
      // configureAuth stores credentials securely on the backend
      await configureAuth({ client_id: id, client_secret: secret });
    } catch (e) {
      setFailure("Couldn't save the credentials", e);
      return;
    }
    setStoredClientId(id);
    setClientId("");
    setClientSecret("");
    setGoogleFormOpen(false);
    setSettingsOpen(false);
    await signInWithGoogle(selectedAccount() ? resumeAccountAfterAuth : restoreLayoutAfterAuth, { configured: true });
  }

  async function saveSignature(account: Account, text: string) {
    const signature = text.trim() ? text : null;
    try {
      await updateAccountSignature(account.id, signature);
      const updated = { ...account, signature };
      setAccounts(accounts().map(a => (a.id === account.id ? updated : a)));
      if (selectedAccount()?.id === account.id) setSelectedAccount(updated);
    } catch (e) {
      setFailure("Couldn't save the signature", e);
    }
  }

  // Undo toasts of an action in a single account, which signing out of it
  // closes
  const accountToastTag = (accountId: string) => `account:${accountId}`;

  // Signs out of the default account: its cards and drafts go, and its mail
  // leaves the all-inboxes cards. The next account becomes the default.
  async function handleSignOut() {
    const account = selectedAccount();
    if (!account) return;
    if (!(await askConfirm({
      title: `Sign out of ${account.email}?`,
      message: "Its cards and the drafts saved on this computer are removed. Your email stays in Gmail.",
      confirmLabel: "Sign out",
      tone: "danger",
    }))) return;
    if (selectedAccount()?.id !== account.id) return;

    try {
      await deleteAccount(account.id);
      closeAccountViews();
      const remaining = accounts().filter(a => a.id !== account.id);
      setAccounts(remaining);
      // The backend keeps the all-inboxes cards while another account remains
      const gone = cards().filter(c => c.account_id === account.id || (remaining.length === 0 && c.account_id === ALL_ACCOUNTS));
      setCards(cards().filter(c => !gone.includes(c)));
      forgetCardState(gone.map(c => c.id));
      dropAccountFromCards(account.id);
      batch(() => {
        setLabelsByAccount(produce(s => { delete s[account.id]; }));
        setCalendarsByAccount(produce(s => { delete s[account.id]; }));
        setContactsByAccount(produce(s => { delete s[account.id]; }));
      });
      if (expiredAccountId() === account.id) setExpiredAccountId(null);
      removeAccountDrafts(account.id);
      toasts.dismissTag(accountToastTag(account.id));
      const next = remaining[0];
      if (next) {
        chooseDefaultAccount(next);
        for (const card of cards()) {
          if (card.account_id === ALL_ACCOUNTS && !collapsedCards[card.id]) refetchCard(card);
        }
      } else {
        setSelectedAccount(null);
        safeRemoveItem("defaultAccountId");
      }
    } catch (e) {
      setFailure("Couldn't sign out", e);
    }
  }

  // Takes a signed-out account's threads and events out of the all-inboxes
  // cards, and out of their saved caches
  function dropAccountFromCards(accountId: string) {
    batch(() => {
      for (const card of cards()) {
        if (card.account_id !== ALL_ACCOUNTS) continue;
        const groups = cardThreads[card.id];
        if (groups) {
          const kept = groups
            .map(g => ({ ...g, threads: g.threads.filter(t => threadAccountId(t, card) !== accountId) }))
            .filter(g => g.threads.length > 0);
          setCardThreads(card.id, reconcile(kept, { key: "gmail_thread_id" }));
          saveCardCache(card.id, kept, cardPageTokens[card.id] || null).catch(e => console.warn("Failed to update thread cache:", e));
        }
        const events = cardCalendarEvents[card.id];
        if (events) {
          const kept = events.filter(ev => eventAccountId(ev, card) !== accountId);
          setCardCalendarEvents(card.id, reconcile(kept, { key: "id" }));
          saveCachedCardEvents(card.id, kept).catch(e => console.warn("Failed to update event cache:", e));
        }
      }
    });
  }

  function refetchCard(card: Card) {
    if (card.card_type === "calendar") refreshCalendarCard(card.id).catch(() => {});
    else fetchAndCacheThreads(card.id);
  }

  function openSearch() {
    setShowGlobalFilter(true);
    setTimeout(() => filterInputRef?.focus(), 0);
  }

  // Only the bare board opens its flower: cards, the trailing slot and the
  // empty board's own buttons keep their clicks and menus
  function openBoardFlower(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".card, .board-slot, .empty-board, button, a, input, textarea, [contenteditable]")) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    setBoardFlowerAt({ x: e.clientX, y: e.clientY });
    retireBoardHint();
  }

  // One account is searched as itself, so a kept search is that account's card
  const searchScope = () => { const all = accounts(); return all.length === 1 ? all[0].id : ALL_ACCOUNTS; };

  function saveRecentSearches(recent: string[]) {
    setRecentSearches(recent);
    try { localStorage.setItem("recentSearches", JSON.stringify(recent)); } catch { /* the list is a convenience */ }
  }

  function runSearch(query = globalFilter()) {
    const q = query.trim();
    if (!q) return;
    setGlobalFilter(q);
    forgetCardState([SEARCH_CARD_ID]);
    setCardHasMore(SEARCH_CARD_ID, false);
    setCardErrors(SEARCH_CARD_ID, null);
    setSearchCard(searchCardFor(q, searchScope()));
    setCollapsedCards(SEARCH_CARD_ID, false);
    saveRecentSearches(rememberSearch(recentSearches(), q));
    filterInputRef?.blur();
    setFocusedCardId(SEARCH_CARD_ID);
    setFocusedThreadIndex(0);
    setFocusedEventIndex(0);
    loadCardThreads(SEARCH_CARD_ID, false, true);
  }

  function closeSearch() {
    setShowGlobalFilter(false);
    setGlobalFilter("");
    if (!searchCard()) return;
    forgetCardState([SEARCH_CARD_ID]);
    setSearchCard(null);
  }

  // Keeps the search as a card named after its query, carrying over what it
  // already found
  async function keepSearch() {
    const q = (searchCard()?.query ?? globalFilter()).trim();
    if (!q) return;
    const found = searchCard()?.query === q;
    try {
      const card = await createCard(searchCard()?.account_id ?? searchScope(), keptCardName(q), q, null, "date", cardTypeForQuery(q));
      batch(() => {
        setCards([...cards(), card]);
        setCollapsedCards(card.id, false);
        if (found) {
          if (cardThreads[SEARCH_CARD_ID]) setCardThreads(card.id, cardThreads[SEARCH_CARD_ID]);
          if (cardCalendarEvents[SEARCH_CARD_ID]) setCardCalendarEvents(card.id, cardCalendarEvents[SEARCH_CARD_ID]);
          setCardPageTokens(card.id, cardPageTokens[SEARCH_CARD_ID] ?? null);
          setCardHasMore(card.id, !!cardHasMore[SEARCH_CARD_ID]);
          setLastSyncTimes(card.id, lastSyncTimes[SEARCH_CARD_ID] ?? Date.now());
        }
        closeSearch();
      });
      if (cardThreads[card.id]) saveCardCache(card.id, cardThreads[card.id], cardPageTokens[card.id] ?? null).catch(() => {});
      else if (!cardCalendarEvents[card.id]) loadCardThreads(card.id);
      showToast(`Kept “${card.name}”`, { label: "Rename", run: () => startEditCard(card) });
    } catch (e) {
      setFailure("Couldn't keep the search", e);
    }
  }

  // Opens the new-card form, making the card in `accountId` (the default
  // account when not given)
  function openAddCard(accountId: string | null = null) {
    setNewCardColor(null);
    setNewCardAccountId(accountId);
    setQueryPreviewThreads([]);
    setQueryPreviewCalendarEvents([]);
    setQueryPreviewLoading(false);
    setAddingCard(true);
  }

  async function handleAddCard() {
    const accountId = newCardAccountId() ?? selectedAccount()?.id;
    if (!accountId || !newCardName() || !newCardQuery()) return;

    try {
      const query = newCardQuery();
      const cardType = cardTypeForQuery(query);

      const card = await createCard(accountId, newCardName(), query, newCardColor() || null, newCardGroupBy(), cardType);
      setCards([...cards(), card]);
      setCollapsedCards(card.id, false);
      setNewCardName("");
      setNewCardQuery("");
      setNewCardColor(null);
      setNewCardGroupBy("date");
      setNewCardAccountId(null);
      setAddingCard(false);
      // Fetch threads/events for the new card
      loadCardThreads(card.id);
    } catch (e) {
      setFailure("Couldn't add the card", e);
    }
  }

  async function addStarterCard(starter: { name: string; query: string }) {
    const account = selectedAccount();
    if (!account) return;
    try {
      const card = await createCard(account.id, starter.name, starter.query, null, "date", cardTypeForQuery(starter.query));
      setCards([...cards(), card]);
      setCollapsedCards(card.id, false);
      loadCardThreads(card.id);
    } catch (e) {
      setFailure("Couldn't add the card", e);
    }
  }

  function cancelAddCard() {
    setClosingAddCard(true);
    setTimeout(() => {
      setNewCardName("");
      setNewCardQuery("");
      setNewCardColor(null);
      setNewCardGroupBy("date");
      setNewCardAccountId(null);
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
      suggestContacts: (query: string) => suggestContacts(query),
      get body() { return composeBody(); },
      setBody: setComposeBody,
      get attachments() { return composeAttachments(); },
      onRemoveAttachment: removeAttachment,
      onFileSelect: handleFileSelect,
      onAddFiles: addComposeFiles,
      get error() { return composeEmailError(); },
      get draftSaving() { return drafts.saving(); },
      get draftSaved() { return drafts.saved(); },
      onSend: handleSendEmail,
      onClose: target.onClose,
      onInput: handleComposeInput,
      get focusBody() { return focusComposeBody(); },
      get fromEmail() { return composeFromEmail(); },
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
    const key = composeDraftKey;
    const accountId = composeAccount()?.id;
    const fields = composeDraftFields();
    const storedHere = safeGetItem(key) !== null;
    const keep = hasDraftContent(fields) && (storedHere || composeEdited);
    // Without a local copy Gmail must get the latest text, typed or not
    let synced: Promise<boolean> | null = null;
    if (keep && !storedHere) {
      cancelDraftSave();
      if (accountId) synced = drafts.save(key, accountId, fields);
    } else {
      flushDraftSave();
    }
    // Drafts keep text only; attachments stay one Reopen away
    const attachmentNames = fields.attachmentNames?.join(", ");
    const reopen = reopenComposeAction(key, fields);
    setClosingCompose(true);
    if (!keep) {
      drafts.clear(key, accountId);
      if (attachmentNames) showToast(`Closed an email with ${attachmentNames}`, reopen);
    } else {
      markDraftClosed(key);
      drafts.detach();
      const offerDiscard = (message: string) => {
        if (attachmentNames) {
          showToast(`${message} without ${attachmentNames}`, reopen);
          return;
        }
        toasts.show({
          message,
          action: [{ ...reopen, label: "Open" }, {
            label: "Discard",
            run: () => {
              // A reply opened again since continues this draft
              if (composing() && !closingCompose() && composeDraftKey === key) return;
              if (accountId) drafts.discard(key, accountId);
            },
          }],
          tag: discardDraftTag(key),
        });
      };
      if (storedHere) {
        offerDiscard("Draft saved");
      } else {
        (synced ?? Promise.resolve(false)).then(inGmail => {
          if (inGmail) offerDiscard("Draft saved in Gmail");
          else showToast("Couldn't save the draft", reopen);
        });
      }
    }
    closeComposeTimeout = window.setTimeout(resetCompose, 200);
  }

  // Puts a closed compose back as it was, attachments included
  function reopenComposeAction(key: string, fields: DraftFields) {
    const init = {
      ...fields,
      isHtml: composeIsHtml(),
      reply: replyingToThread() ?? undefined,
      forward: forwardingThread() ?? undefined,
      replyEvent: replyingToEvent() ?? undefined,
      forwardEvent: forwardingEvent() ?? undefined,
      signature: false,
      accountId: composeAccount()?.id,
      draftKey: key,
      attachments: composeAttachments(),
    };
    return { label: "Reopen", run: () => startCompose(init) };
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
    // Defaults to the default account
    accountId?: string;
    // Continue this saved draft instead of looking for one
    draftKey?: string;
    attachments?: SendAttachment[];
  }) {
    // One panel at a time: a new event steps aside, keeping what was typed in it
    if (creatingEvent() && !eventForm().editing) setCreatingEvent(false);
    if (composing() || closingCompose()) resetCompose();
    const accountId = init.accountId ?? selectedAccount()?.id;
    composeOpeningAccountId = accountId;
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
    // A draft being continued is the user's own text
    composeEdited = !!(init.draftKey || saved);
    const continued = init.draftKey || saved ? drafts.load(composeDraftKey) : null;
    toasts.dismissTag(discardDraftTag(composeDraftKey));
    const lostAttachments = init.attachments ? [] : continued?.attachmentNames ?? [];
    if (lostAttachments.length > 0) showToast(`Attach again: ${lostAttachments.join(", ")}`);
    const fields = saved?.draft ?? init;
    batch(() => {
      setComposeAttachments(init.attachments ?? []);
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
      setComposeBody(saved || init.signature === false ? body : withSignature(body, accountById(accountId)?.signature));
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
    const files = Array.from(input.files);
    input.value = ''; // Reset input so same file can be selected again
    await addComposeFiles(files);
  }

  async function addComposeFiles(files: File[]) {
    const { attachments, skipped } = await readFilesAsAttachments(files);
    if (skipped.length > 0) {
      setComposeEmailError(`Skipped: ${skipped.join(', ')}`);
    }
    if (attachments.length > 0) {
      setComposeAttachments([...composeAttachments(), ...attachments]);
    }
  }

  function removeAttachment(index: number) {
    setComposeAttachments(composeAttachments().filter((_, i) => i !== index));
  }

  async function handleCreateEvent(scope: RecurrenceScope = "this") {
    const account = eventFormAccount();
    if (!account) return;

    const form = eventForm();

    if (!form.summary.trim()) {
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
      const attendeesList = eventAttendees(form.attendees);

      const eventInput: EventInput = {
        summary: form.summary,
        description: form.description || null,
        location: form.location || null,
        startTime: times.start,
        endTime: times.end,
        allDay: form.allDay,
        attendees: attendeesList.length > 0 ? attendeesList : null,
        recurrence: form.recurrence ? [form.recurrence] : null,
        addMeet: form.addMeet,
      };

      if (editing) {
        // Update existing event
        const updated = await updateCalendarEvent(account.id, editing.calendarId, editing.id, eventInput, scope);
        // The occurrence shown may no longer exist once its series changed
        if (scope !== "this" && activeEvent()?.id === editing.id) closeEvent();
        // Sync the open EventView and the card's copy immediately; the
        // background refetch below lands later
        setActiveEvent(ev => (ev && ev.id === updated.id ? updated : ev));
        updateEventInCards(updated.id, () => updated);
      } else {
        const calendarId = newEventCalendarId();
        await createCalendarEvent(account.id, calendarId, eventInput);
        if (calendarId) rememberCalendar(account.id, calendarId);
      }

      setCreatingEvent(false);
      setEventForm(defaultEventForm());

      // Refresh the calendar cards showing the account
      cards().forEach(card => {
        if (isCalendarCard(card.id) && cardCoversAccount(card, account.id)) {
          fetchAndCacheCalendarEvents(card.id, card.query);
        }
      });

      showToast(editing ? "Event updated" : "Event created");

    } catch (e) {
      const failure = editing ? "Couldn't update the event" : "Couldn't create the event";
      console.error(`${failure}:`, e);
      setEventForm(f => ({ ...f, error: failureMessage(failure, e).message }));
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
      forward: forwardingThread() ? { ...forwardingThread()! } : undefined,
      isHtml: composeIsHtml(),
    };

    // Saved locally as being sent, so a quit during the undo window leaves
    // it as a draft that the next start points out
    cancelDraftSave();
    drafts.saveLocal(composeDraftKey, composeDraftFields());
    markDraftSending(composeDraftKey, account.id);
    pending.draft = { key: composeDraftKey, gmailDraftId: drafts.gmailDraftId() ?? undefined };
    sendingDraftKeys.add(composeDraftKey);
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
      forward: pending.forward,
      signature: false,
      accountId: pending.accountId,
      draftKey: pending.draft?.key,
      attachments: pending.attachments,
    });
    setComposeAccount(accounts().find(a => a.id === pending.accountId) ?? null);
  }

  // An email still marked as being sent was waiting out the undo window
  // when Posta quit
  function offerUnsentDraft(known: Account[]) {
    const unsent = findUnsentDrafts().find(u => known.some(a => a.id === u.draft.accountId));
    if (!unsent) return;
    const { key, draft } = unsent;
    showToast("An email wasn't sent before Posta quit", {
      label: "Open",
      run: () => {
        markDraftSending(key, null);
        startCompose({
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          reply: draft.threadId ? { threadId: draft.threadId, messageId: draft.replyMessageId } : undefined,
          forward: draft.forwardThreadId ? { threadId: draft.forwardThreadId, subject: draft.subject, body: draft.body } : undefined,
          signature: false,
          accountId: draft.accountId,
          draftKey: key,
        });
        setComposeAccount(accounts().find(a => a.id === draft.accountId) ?? null);
      },
    });
  }

  function undoSend() {
    for (const pending of undoableSend.undoAll()) {
      putBackSend(pending, `"${pending.subject || "(no subject)"}" wasn't sent`);
    }
  }

  function openMailto(mailto: MailtoData) {
    openComposeUnlessBusy(`New email to ${mailto.to || "(no recipient)"}`, () => startCompose(mailto));
  }

  async function handleQuickReply() {
    const threadId = quickReply().threadId;
    const cardId = quickReplyCardId();
    const account = threadOwner(threadId, cardId);
    const text = quickReply().text;
    if (!account || !threadId || !cardId || !text.trim()) return;

    // Get thread info for reply
    const threads = getCardThreadsFlat(cardId);
    const thread = threads.find(t => t.gmail_thread_id === threadId);
    if (!thread) return;

    const subject = addReplyPrefix(thread.subject);

    // The user may have moved on to another quick reply meanwhile
    const stillOpen = () => quickReply().threadId === threadId;
    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      // The thread list lacks Reply-To and who wrote last; the full thread has both
      const details = await getThreadDetails(account.id, threadId);
      const entry = batchReplyEntry(threadId, details.messages ?? [], account.email);
      if (!entry?.to) {
        showToast("No one else to reply to");
        return;
      }
      await replyToThread(account.id, threadId, entry.to, "", "", subject, text + signatureBlock(account.signature), entry.messageId, [], false);
      if (stillOpen()) {
        setQuickReply({ threadId: null, text: "", sending: false });
        setQuickReplyCardId(null);
      }
      showToast("Reply sent");
      fetchAndCacheThreads(cardId);
    } catch (e) {
      console.error("Failed to send reply:", e);
      setFailure("Couldn't send the reply", e);
    } finally {
      if (stillOpen()) setQuickReply(qr => ({ ...qr, sending: false }));
    }
  }

  async function handleEventQuickReply(event: GoogleCalendarEvent) {
    const account = eventOwner(event);
    const text = quickReply().text;
    if (!account || !text.trim()) return;
    const { to } = eventReplyRecipients(event, account.email);
    if (!to) {
      showToast("No one else to reply to");
      return;
    }

    const subject = addReplyPrefix(event.title);

    const stillOpen = () => quickReplyEventId() === event.id;
    setQuickReply(qr => ({ ...qr, sending: true }));
    try {
      await sendEmail(account.id, to, "", "", subject, text + signatureBlock(account.signature));
      if (stillOpen()) {
        setQuickReplyEventId(null);
        setQuickReply(qr => ({ ...qr, text: "", sending: false }));
      }
      showToast("Reply sent");
    } catch (e) {
      console.error("Failed to send reply:", e);
      setFailure("Couldn't send the reply", e);
    } finally {
      if (stillOpen()) setQuickReply(qr => ({ ...qr, sending: false }));
    }
  }

  async function handleQuickReaction(threadId: string, emoji: string) {
    const account = threadOwner(threadId, quickReplyCardId());
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
      showFailure("Couldn't send the reaction", e);
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
    let to = '';
    let cc = '';
    let body = thread.snippet;
    let previewOnly = false;
    const account = threadOwner(threadId, cardId);
    if (account) {
      try {
        const details = await getThreadDetails(account.id, threadId);
        const lastMsg = details.messages[details.messages.length - 1];
        if (lastMsg) {
          from = findHeader(lastMsg.payload?.headers, 'From') || from;
          date = findHeader(lastMsg.payload?.headers, 'Date') || '';
          to = findHeader(lastMsg.payload?.headers, 'To') || '';
          cc = findHeader(lastMsg.payload?.headers, 'Cc') || '';
          body = extractMessageText(lastMsg.payload, lastMsg.snippet);
        }
      } catch (e) {
        console.error("Failed to fetch thread for forward:", e);
        previewOnly = true;
        noteBackgroundError(account.id, e);
      }
    }
    const quotedBody = buildForwardBody({ from, date, subject: thread.subject, to, cc, body });

    startCompose({
      subject: fwdSubject,
      body: quotedBody,
      forward: { threadId, subject: fwdSubject, body: quotedBody },
      accountId: account?.id,
    });
    if (previewOnly) showToast("Couldn't load the whole email, so only its preview is quoted");
  }

  function handleReplyFromThread(to: string, cc: string, subject: string, quotedBody: string, messageId: string | undefined, isHtml: boolean) {
    const threadId = activeThreadId();
    if (!threadId) return;

    startCompose({ to, cc, subject, body: quotedBody, isHtml, reply: { threadId, messageId }, focusBody: true, accountId: activeThreadAccountId() ?? undefined });

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
    startCompose({ subject, body, forward: { threadId: activeThreadId() || '', subject, body }, accountId: activeThreadAccountId() ?? undefined });
  }

  async function unsubscribeFromList(method: UnsubscribeMethod, listName: string) {
    const account = activeThreadAccount();
    if (!account) return;
    try {
      const outcome = await runUnsubscribe(account.id, method, { sendEmail, postOneClick: unsubscribeOneClick, openUrl });
      showToast(outcome === "done" ? `Unsubscribed from ${listName}` : `Finish unsubscribing from ${listName} on its page`);
    } catch (e) {
      showFailure("Couldn't unsubscribe", e);
      throw e;
    }
  }

  // Label drawer functions
  const labelsFetching = new Set<string>();
  // refresh: reload the list even when it is loaded (labels made in Gmail
  // since), showing the loaded one meanwhile
  async function fetchAccountLabels(accountId: string | undefined, { refresh = false } = {}) {
    if (!accountId) return;
    const loaded = !!labelsByAccount[accountId]?.length;
    if (loaded && !refresh) return;
    if (labelsFetching.has(accountId)) return;

    labelsFetching.add(accountId);
    const shown = () => activeThreadAccountId() === accountId;
    if (shown()) {
      setLabelsLoading(!loaded);
      setLabelsFailed(false);
    }
    try {
      const labels = await listLabels(accountId);
      if (!accountById(accountId)) return;
      // Sort: user labels first (alphabetically), then system labels
      const sorted = labels.sort((a, b) => {
        if (a.label_type === 'user' && b.label_type !== 'user') return -1;
        if (a.label_type !== 'user' && b.label_type === 'user') return 1;
        return labelDisplayName(a).localeCompare(labelDisplayName(b));
      });
      setLabelsByAccount(accountId, sorted);
    } catch (e) {
      console.error("Failed to fetch labels:", e);
      if (shown() && !loaded) setLabelsFailed(true);
    } finally {
      labelsFetching.delete(accountId);
      if (shown()) setLabelsLoading(false);
    }
  }

  // The open thread's account's labels, for the label drawer
  const accountLabels = () => labelsByAccount[activeThreadAccountId() ?? ""] ?? [];
  const labelNamesByAccount = createMemo(() =>
    Object.fromEntries(Object.entries(labelsByAccount).map(([id, labels]) => [id, Object.fromEntries(labels.map(l => [l.id, l.name]))])));
  // A card's threads' label names, each from its own mailbox
  const cardLabelNames = (card: Card | undefined) => (thread: Thread, labelId: string) =>
    labelNamesByAccount()[threadAccountId(thread, card)]?.[labelId];
  const filteredLabels = createMemo(() => {
    const query = labelSearchQuery().toLowerCase();
    return query ? accountLabels().filter(l => labelDisplayName(l).toLowerCase().includes(query)) : accountLabels();
  });

  // "Group by label" shows label names, and a card query completes label:
  // from them; only the label lists carry them
  createEffect(() => {
    if (!selectedAccount()) return;
    const wanted = new Set<string>();
    for (const card of cards()) {
      if (card.group_by === "label") cardAccountIds(card, accounts()).forEach(id => wanted.add(id));
    }
    const scope = (editingCardId() !== null || addingCard()) ? formScope() : null;
    if (scope) cardAccountIds({ account_id: scope }, accounts()).forEach(id => wanted.add(id));
    untrack(() => wanted.forEach(id => fetchAccountLabels(id)));
  });

  // Calendar drawer functions (for events)
  async function fetchAvailableCalendars(accountId: string | undefined) {
    if (!accountId) return;
    if (calendarsByAccount[accountId]?.length) return; // Already cached
    if (calendarsLoading[accountId]) return;

    setCalendarsLoading(accountId, true);
    try {
      const calendars = await listCalendars(accountId);
      if (!accountById(accountId)) return;
      // Sort: primary first, then alphabetically
      const sorted = calendars.sort((a, b) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return a.name.localeCompare(b.name);
      });
      setCalendarsByAccount(accountId, sorted);
    } catch (e) {
      console.error("Failed to fetch calendars:", e);
      if (accountById(accountId)) showFailure("Couldn't load your calendars", e, () => { void fetchAvailableCalendars(accountId); });
    } finally {
      setCalendarsLoading(accountId, false);
    }
  }

  // An event can show in several calendar cards; change every copy, and each
  // card's saved cache, so none of them shows the old state until a refetch.
  // `update` returning null removes the event.
  function updateEventInCards(eventId: string, update: (ev: GoogleCalendarEvent) => GoogleCalendarEvent | null) {
    for (const [cId, events] of Object.entries(cardCalendarEvents)) {
      if (!events?.some(e => e.id === eventId)) continue;
      const next = events.flatMap(e => (e.id === eventId ? update(e) ?? [] : [e]));
      setCardCalendarEvents(cId, reconcile(next, { key: "id" }));
      saveCachedCardEvents(cId, next).catch(e => console.warn("Failed to update event cache:", e));
    }
  }

  function markEventRsvp(eventId: string, status: string, account: Account | null) {
    const email = account?.email ?? "";
    setActiveEvent(ev => (ev && ev.id === eventId ? withOwnResponse(ev, status, email) : ev));
    updateEventInCards(eventId, ev => withOwnResponse(ev, status, email));
  }

  // Events deleted in the app whose deletion waits out their Undo toast
  const heldEventDeletes = new Set<string>();

  function removeDeletedEvents(event: GoogleCalendarEvent, scope: RecurrenceScope) {
    if (scope === "this") {
      updateEventInCards(event.id, () => null);
      return;
    }
    for (const [cardId, events] of Object.entries(cardCalendarEvents)) {
      const kept = (events ?? []).filter(ev => !deletedByScope(ev, event, scope));
      if (kept.length === events?.length) continue;
      setCardCalendarEvents(cardId, reconcile(kept, { key: "id" }));
      saveCachedCardEvents(cardId, kept).catch(e => console.warn("Failed to update event cache:", e));
    }
  }

  // Deleting an event tells its guests, which can't be taken back, so that
  // asks first (unless the scope menu, which says so, already asked) and
  // happens at once, as does deleting several occurrences of a series;
  // deleting one event without guests waits out its toast
  async function deleteEvent(event: GoogleCalendarEvent, chosenScope?: RecurrenceScope, anchor?: ScopeAnchor, cardId?: string | null) {
    const account = eventOwner(event, cardId);
    if (!account) return;
    const actions = eventActions(event, account.email);
    if (!chosenScope && event.recurring_event_id) {
      const title = actions.role === "organizer" ? deletePrompt(actions) : "Delete repeating event";
      const asked = await askScope(title, anchor ?? null);
      if (!asked || !accountById(account.id)) return;
      chosenScope = asked;
    }
    const scope = chosenScope ?? "this";
    const { role, guestCount: guests } = actions;
    const notifiesGuests = role === "organizer";
    if (notifiesGuests || scope !== "this") {
      if (notifiesGuests && !chosenScope) {
        const confirmed = await askConfirm({
          title: `Delete and notify ${guests} guest${guests === 1 ? "" : "s"}?`,
          message: "Each guest gets an email saying the event was cancelled.",
          confirmLabel: "Delete event",
          tone: "danger",
        });
        if (!confirmed || !accountById(account.id)) return;
      }
      try {
        await deleteCalendarEvent(account.id, event.calendar_id, event.id, scope);
        removeDeletedEvents(event, scope);
        showToast("Event deleted");
        if (activeEvent()?.id === event.id) { closeEvent(); restoreOpenedRowFocus(); }
      } catch (e) {
        console.error('Failed to delete event:', e);
        showFailure("Couldn't delete the event", e);
      }
      return;
    }

    // Where the event was in each card, to put it back on Undo
    const places = Object.entries(cardCalendarEvents)
      .map(([cardId, events]) => ({ cardId, index: events?.findIndex(e => e.id === event.id) ?? -1 }))
      .filter(p => p.index !== -1);
    const putBack = () => {
      heldEventDeletes.delete(event.id);
      if (!accountById(account.id)) return;
      for (const { cardId, index } of places) {
        const events = cardCalendarEvents[cardId];
        if (!events || events.some(e => e.id === event.id)) continue;
        const next = [...events];
        next.splice(Math.min(index, next.length), 0, event);
        setCardCalendarEvents(cardId, reconcile(next, { key: "id" }));
        saveCachedCardEvents(cardId, next).catch(e => console.warn("Failed to update event cache:", e));
      }
    };
    heldEventDeletes.add(event.id);
    updateEventInCards(event.id, () => null);
    if (activeEvent()?.id === event.id) { closeEvent(); restoreOpenedRowFocus(); }
    toasts.show({
      message: inAccount(`Deleted “${event.title || "(No title)"}”`, [account.email], accounts().length),
      tag: accountToastTag(account.id),
      undo: putBack,
      onExpire: async () => {
        try {
          await deleteCalendarEvent(account.id, event.calendar_id, event.id);
          heldEventDeletes.delete(event.id);
        } catch (e) {
          console.error('Failed to delete event:', e);
          putBack();
          showFailure("Couldn't delete the event", e);
        }
      },
    });
  }

  async function handleMoveEventToCalendar(destinationCalendarId: string) {
    const event = activeEvent();
    const account = activeEventAccount();
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
        if (isCalendarCard(card.id) && cardCoversAccount(card, account.id)) {
          fetchAndCacheCalendarEvents(card.id, card.query);
        }
      });

      // Find the destination calendar name
      const destCal = calendarsFor(account.id).find(c => c.id === destinationCalendarId);
      const where = destCal?.name || 'calendar';
      showToast(event.recurring_event_id ? `Moved all its events to ${where}` : `Moved to ${where}`);
      setCalendarDrawerOpen(false);
    } catch (e) {
      console.error("Failed to move event:", e);
      showFailure("Couldn't move the event", e);
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
    const account = activeThreadAccount();
    const cardId = activeThreadCardId();
    if (!thread || !account) return;

    // Archive, delete and spam move on to another thread; the card's order
    // is taken before the optimistic update removes this one
    const leavesView = ['archive', 'trash', 'spam'].includes(action);
    const order = cardId ? cardThreadOrder(cardId) : [];

    await handleThreadAction(action, [thread.id], cardId || '', { accountId: account.id });
    if (activeThreadId() !== thread.id) return;

    if (leavesView) {
      const next = cardId ? afterRemoval(order, thread.id, loadAfterArchive()) : null;
      if (next && cardId && cardThreadOrder(cardId).includes(next)) openThread(next, cardId);
      else {
        closeThreadView();
        restoreOpenedRowFocus();
      }
    } else {
      await refreshActiveThread(account.id, thread.id);
    }
  }

  function cardThreadOrder(cardId: string): string[] {
    return getDisplayGroups(cardId).flatMap(g => g.threads.map(t => t.gmail_thread_id));
  }

  const activeThreadPosition = createMemo(() => {
    const cardId = activeThreadCardId();
    const threadId = activeThreadId();
    return cardId && threadId ? threadPosition(cardThreadOrder(cardId), threadId) : null;
  });

  function stepActiveThread(direction: 1 | -1) {
    const cardId = activeThreadCardId();
    const threadId = activeThreadId();
    if (!cardId || !threadId) return;
    const next = stepThread(cardThreadOrder(cardId), threadId, direction);
    if (next) openThread(next, cardId);
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
    const account = activeThreadAccount();
    if (!thread || !account) return;

    const addLabels = isAdding ? [labelId] : [];
    const removeLabels = isAdding ? [] : [labelId];

    try {
      await modifyThreads(account.id, [thread.id], addLabels, removeLabels);
      await refreshActiveThread(account.id, thread.id);
      toasts.show({
        message: inAccount(`${isAdding ? 'Added' : 'Removed'} the label “${labelName}”`, [account.email], accounts().length),
        tag: accountToastTag(account.id),
        undo: async () => {
          try {
            await modifyThreads(account.id, [thread.id], removeLabels, addLabels);
            if (activeThreadId() === thread.id) await refreshActiveThread(account.id, thread.id);
          } catch (e) {
            console.error("Failed to undo label change:", e);
            setFailure("Couldn't undo", e);
          }
        },
      });
    } catch (e) {
      console.error("Failed to modify labels:", e);
      setFailure(`Couldn't ${isAdding ? 'add' : 'remove'} the label “${labelName}”`, e);
    }
  }

  // Bumped on every open and close so a slow load can't fill a batch that
  // was closed or reopened for other threads
  let batchReplyRequest = 0;
  async function startBatchReply(cardId: string, threadIds: string[]) {
    if (threadIds.length === 0) return;

    const request = ++batchReplyRequest;
    setBatchReplyLoading(true);
    setBatchReplyError(null);
    setBatchReplyCidData({});
    setBatchReplyOpen(true);
    setBatchReplyCardId(cardId);
    setBatchReplyMessages({});

    try {
      const results = await Promise.allSettled(threadIds.map(async (threadId): Promise<BatchReplyThread | null> => {
        const account = threadOwner(threadId, cardId);
        if (!account) throw new Error("The account of this email is no longer signed in");
        const entry = batchReplyEntry(threadId, (await getThreadDetails(account.id, threadId)).messages ?? [], account.email);
        return entry && { ...entry, accountId: account.id };
      }));
      if (request !== batchReplyRequest) return;

      const threads = results
        .filter((r): r is PromiseFulfilledResult<BatchReplyThread | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((t): t is BatchReplyThread => t !== null);
      setBatchReplyThreads(threads);
      for (const t of threads) if (t.accountId) fetchBatchReplyCidImages(t.accountId, t, request);

      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length === 0) return;
      console.error("Batch reply couldn't load threads:", failures.map(f => f.reason));
      const failedAccount = threadOwner(threadIds[results.indexOf(failures[0])], cardId);
      if (failedAccount) noteBackgroundError(failedAccount.id, failures[0].reason);
      if (failures.length === results.length) {
        setBatchReplyError({ message: batchReplyLoadErrorMessage(failures[0].reason), threadIds });
      } else {
        showToast(`Couldn't load ${failures.length} of ${results.length} emails`);
      }
    } finally {
      if (request === batchReplyRequest) setBatchReplyLoading(false);
    }
  }

  async function fetchBatchReplyCidImages(accountId: string, thread: BatchReplyThread, request: number) {
    const refs = cidImagesToFetch({ id: thread.threadId, messages: [{ id: thread.messageId, threadId: thread.threadId, payload: { mimeType: "", parts: thread.parts } }] });
    if (refs.length === 0) return;
    const data = await fetchCidImages(refs, ({ messageId, attachmentId, cid }) =>
      cidImageCache.getOrLoad(`${accountId}:${messageId}:${cid}`, () => downloadAttachmentApi(accountId, messageId, attachmentId)));
    if (request === batchReplyRequest && Object.keys(data).length > 0) {
      setBatchReplyCidData(prev => ({ ...prev, [thread.threadId]: data }));
    }
  }

  function closeBatchReply() {
    batchReplyRequest++;
    setBatchReplyCidData({});
    setBatchReplyLoading(false);
    setBatchReplyError(null);
    setBatchReplyOpen(false);
    setBatchReplyCardId(null);
    setBatchReplyThreads([]);
    setBatchReplyMessages({});
    setBatchReplyAttachments({});
  }

  function unsentBatchReplies(): string | null {
    const unsent = Object.values(batchReplyMessages()).filter(m => m.trim()).length;
    return unsent === 0 ? null : `${unsent} unsent repl${unsent === 1 ? "y" : "ies"}`;
  }

  // Closing by hand throws away typed replies, so ask first
  async function confirmDiscardBatchReplies(): Promise<boolean> {
    const unsent = unsentBatchReplies();
    return !unsent || askConfirm({ title: `Discard ${unsent}?`, message: "What you typed is lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" });
  }

  async function dismissBatchReply() {
    const request = batchReplyRequest;
    if (await confirmDiscardBatchReplies() && request === batchReplyRequest) closeBatchReply();
  }

  function updateBatchReplyMessage(threadId: string, message: string) {
    setBatchReplyMessages({ ...batchReplyMessages(), [threadId]: message });
  }

  async function handleBatchReplyFileSelect(threadId: string, e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files);
    input.value = '';
    await addBatchReplyFiles(threadId, files);
  }

  async function addBatchReplyFiles(threadId: string, files: File[]) {
    const { attachments, skipped } = await readFilesAsAttachments(files);
    if (skipped.length > 0) {
      showToast(`Skipped: ${skipped.join(', ')}`);
    }
    if (attachments.length > 0) {
      const current = batchReplyAttachments()[threadId] || [];
      setBatchReplyAttachments({ ...batchReplyAttachments(), [threadId]: [...current, ...attachments] });
    }
  }

  function removeBatchReplyAttachment(threadId: string, index: number) {
    const current = batchReplyAttachments()[threadId] || [];
    setBatchReplyAttachments({
      ...batchReplyAttachments(),
      [threadId]: current.filter((_, i) => i !== index)
    });
  }

  // Drops a thread from the panel; returns whether any are left
  function removeBatchReplyThread(threadId: string): boolean {
    const without = <T,>(record: Record<string, T>) => {
      const rest = { ...record };
      delete rest[threadId];
      return rest;
    };
    batch(() => {
      setBatchReplyThreads(batchReplyThreads().filter(t => t.threadId !== threadId));
      setBatchReplyMessages(without(batchReplyMessages()));
      setBatchReplyAttachments(without(batchReplyAttachments()));
    });
    return batchReplyThreads().length > 0;
  }

  function discardBatchReplyThread(threadId: string) {
    if (!removeBatchReplyThread(threadId)) closeBatchReply();
  }

  // What a batch reply queued to send was written as, to put it back in the
  // batch if it is undone or fails
  interface BatchReplyOrigin {
    thread: BatchReplyThread;
    message: string;
    attachments: SendAttachment[];
    cardId: string | null;
  }
  const batchReplyOrigins = new WeakMap<PendingSend, BatchReplyOrigin>();

  function restoreBatchReply(origin: BatchReplyOrigin) {
    const threadId = origin.thread.threadId;
    batch(() => {
      if (!batchReplyOpen()) {
        closeBatchReply();
        setBatchReplyOpen(true);
        setBatchReplyCardId(origin.cardId);
      }
      if (!batchReplyThreads().some(t => t.threadId === threadId)) {
        setBatchReplyThreads([...batchReplyThreads(), origin.thread]);
      }
      setBatchReplyMessages({ ...batchReplyMessages(), [threadId]: origin.message });
      setBatchReplyAttachments({ ...batchReplyAttachments(), [threadId]: origin.attachments });
    });
  }

  // Queues the reply behind the undo window, or hands it to `queue`; resolves
  // false if it can't be sent. `quiet` leaves saying so to Send All, which
  // reports every failure at once.
  async function sendBatchReply(threadId: string, { quiet = false, queue = undoableSend.queue } = {}): Promise<boolean> {
    const thread = batchReplyThreads().find(t => t.threadId === threadId);
    const account = accountById(thread?.accountId);
    const message = batchReplyMessages()[threadId];
    const attachments = batchReplyAttachments()[threadId] || [];

    if (!account || !thread || !message?.trim()) return true;
    if (!thread.to) {
      if (!quiet) showToast(`No one to reply to in "${thread.subject}"`);
      return false;
    }

    const cardId = batchReplyCardId();
    const pending: PendingSend = {
      accountId: account.id,
      to: thread.to,
      cc: "",
      bcc: "",
      subject: addReplyPrefix(thread.subject),
      body: message + signatureBlock(account.signature),
      attachments,
      reply: { threadId, messageId: thread.messageId },
      isHtml: false,
    };
    batchReplyOrigins.set(pending, { thread, message, attachments, cardId });
    queue(pending);
    if (!removeBatchReplyThread(threadId)) {
      closeBatchReply();
      if (cardId) setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
    }
    return true;
  }

  async function sendAllBatchReplies() {
    const messages = batchReplyMessages();
    const toSend = batchReplyThreads().filter(t => messages[t.threadId]?.trim());
    const queued: PendingSend[] = [];
    const sent = await Promise.all(toSend.map(thread => sendBatchReply(thread.threadId, { quiet: true, queue: p => queued.push(p) })));
    undoableSend.queueAll(queued);
    const failed = sent.filter(ok => !ok).length;
    if (failed > 0) showToast(`Couldn't send ${failed} of ${toSend.length} replies; they're still here to try again`);
  }

  function saveCollapsedState(collapsed: Record<string, boolean>) {
    // The store only holds this account's cards; keep other accounts' entries
    const stored = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
    for (const id of Object.keys(collapsedCards)) delete stored[id];
    setCollapsedCards(reconcile(collapsed));
    safeSetJSON("collapsedCards", { ...stored, ...collapsed });
  }

  function startEditCard(card: Card, e?: MouseEvent) {
    e?.stopPropagation();
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
    editCardStart = editStartOf(card);
    setEditCardAccountId(card.account_id);
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

    // The editor's fields already follow pulled changes the user hasn't
    // overridden (followPulledCardInEditor)
    const newQuery = editCardQuery();
    // The backend clears the cache of a card moved to another account
    const queryChanged = card.query !== newQuery || card.account_id !== editCardAccountId();

    try {
      const updatedCard: Card = {
        ...card,
        account_id: editCardAccountId(),
        name: editCardName(),
        query: newQuery,
        color: editCardColor() || null,
        card_type: cardTypeForQuery(newQuery),
        group_by: editCardGroupBy(),
      };
      await updateCard(updatedCard);
      setCards(cards().map(c => c.id === cardId ? updatedCard : c));
      setEditingCardId(null);

      // If query changed, clear cache and refresh
      if (queryChanged) {
        delete knownCardCache[cardId];
        await clearCardCache(cardId);
        setCardThreads(produce(s => { delete s[cardId]; }));
        setCardPageTokens(produce(s => { delete s[cardId]; }));
        setCardCalendarEvents(produce(s => { delete s[cardId]; }));
        // Force refresh since we just cleared the cache
        loadCardThreads(cardId, false, true);
      }
    } catch (e) {
      setFailure("Couldn't save the card", e);
    }
  }

  // The open editor shows a pulled change to any field the user hasn't touched
  function followPulledCardInEditor() {
    const card = cards().find(c => c.id === editingCardId());
    const start = editCardStart;
    if (!card || !start) return;
    batch(() => {
      if (editCardName() === start.name) setEditCardName(card.name);
      if (editCardQuery() === start.query) setEditCardQuery(card.query);
      if ((editCardColor() || null) === (start.color || null)) setEditCardColor((card.color as CardColor) || null);
      if (editCardGroupBy() === start.group_by) setEditCardGroupBy(card.group_by || "date");
      if (editCardAccountId() === start.account_id) setEditCardAccountId(card.account_id);
    });
    editCardStart = editStartOf(card);
  }

  function cancelEditCard() {
    setEditingCardId(null);
    setEditCardName("");
    setEditCardQuery("");
  }

  // What the app holds for cards that no longer exist. Their threads would
  // otherwise still count toward the dock badge and be written back to the
  // cache by thread actions.
  function forgetCardState(cardIds: string[]) {
    if (cardIds.length === 0) return;
    for (const id of cardIds) delete knownCardCache[id];
    batch(() => {
      setCardThreads(produce(s => { for (const id of cardIds) delete s[id]; }));
      setCardPageTokens(produce(s => { for (const id of cardIds) delete s[id]; }));
      setCardCalendarEvents(produce(s => { for (const id of cardIds) delete s[id]; }));
      const editing = editingCardId();
      if (editing && cardIds.includes(editing)) setEditingCardId(null);
      const focused = focusedCardId();
      if (focused && cardIds.includes(focused)) {
        setFocusedCardId(null);
        setFocusedThreadIndex(-1);
        setFocusedEventIndex(-1);
      }
      const remainingCollapsed = { ...collapsedCards };
      for (const id of cardIds) delete remainingCollapsed[id];
      saveCollapsedState(remainingCollapsed);
    });
  }

  // Cards deleted in the app whose deletion waits out their Undo toast
  const heldCardDeletes = new Set<string>();

  // The card goes at once; it is deleted for good (and from iCloud) only
  // once its toast goes without Undo
  function handleDeleteCard(cardId: string) {
    const index = cards().findIndex(c => c.id === cardId);
    if (index === -1) return;
    const deleted = cards()[index];
    const name = deleted.name || "Untitled";
    const wasCollapsed = !!collapsedCards[cardId];
    const putBack = () => {
      heldCardDeletes.delete(cardId);
      // Signing out of its account took it off the board meanwhile
      const signedOut = deleted.account_id === ALL_ACCOUNTS ? accounts().length === 0 : !accountById(deleted.account_id);
      if (signedOut || cards().some(c => c.id === cardId)) return;
      const next = [...cards()];
      next.splice(Math.min(index, next.length), 0, deleted);
      setCards(next);
      saveCollapsedState({ ...collapsedCards, [cardId]: wasCollapsed });
      if (!wasCollapsed) loadCardThreads(cardId);
    };
    heldCardDeletes.add(cardId);
    setCards(cards().filter(c => c.id !== cardId));
    forgetCardState([cardId]);
    toasts.show({
      message: `Deleted the card “${name}”`,
      undo: putBack,
      onExpire: async () => {
        try {
          await deleteCard(cardId);
          heldCardDeletes.delete(cardId);
        } catch (err) {
          console.error("Failed to delete card:", err);
          putBack();
          showFailure(`Couldn't delete the card “${name}”`, err);
        }
      },
    });
  }

  // Collapsed cards a history reset skipped; their threads are refetched on expanding
  const cardsMissingFullSync = new Set<string>();
  async function toggleCardCollapse(cardId: string) {
    const isCollapsed = collapsedCards[cardId];
    const newCollapsed = { ...collapsedCards, [cardId]: !isCollapsed };
    saveCollapsedState(newCollapsed);

    if (!isCollapsed) return;
    const missedFullSync = cardsMissingFullSync.delete(cardId);
    if (!cardThreads[cardId]) loadCardThreads(cardId);
    else if (missedFullSync) fetchAndCacheThreads(cardId);
  }


  // Show the board's cards: every account's, with their collapsed state, and
  // load what the expanded ones show and don't hold yet. Cards already shown
  // keep what they show. Returns null when a later load superseded this one.
  let boardLoad = 0;
  async function loadBoard(): Promise<Card[] | null> {
    const load = ++boardLoad;
    const cardList = (await getCards()).filter(c => !heldCardDeletes.has(c.id));
    if (load !== boardLoad || !selectedAccount()) return null;
    const listed = new Set(cardList.map(c => c.id));
    forgetCardState(cards().map(c => c.id).filter(id => !listed.has(id)));
    setCards(reuseUnchanged(cards(), cardList));

    const savedCollapsed = safeGetJSON<Record<string, boolean>>("collapsedCards", {});
    const collapsed: Record<string, boolean> = {};
    cardList.forEach(c => { collapsed[c.id] = collapsedCards[c.id] ?? savedCollapsed[c.id] ?? false; });
    setCollapsedCards(reconcile(collapsed));

    for (const card of cardList) {
      if (!collapsed[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id]) loadCardThreads(card.id);
    }
    return cardList;
  }

  function closeLabelDrawer() {
    setLabelDrawerOpen(false);
    setLabelSearchQuery("");
  }

  function closeThreadView() {
    setActiveThreadId(null);
    setActiveThreadCardId(null);
    setFocusedMessageIndex(0);
    closeLabelDrawer();
    setCidAttachmentData({});
  }

  // Views of threads and events, which signing out may have taken away.
  // Compose stays open: it remembers the account it was opened in.
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

  // What each card's thread cache was last read or written as, and when. A
  // refresh that brings back the same groups (inline images and all) skips
  // sending them across again, but not for long: the cache's time is what
  // "Last synced" shows at the next start. Kept as a fingerprint: a card's
  // groups carry inline thumbnails and can run to megabytes.
  const knownCardCache: Record<string, { snapshot: string; at: number }> = {};
  const CACHE_REWRITE_MS = 5 * 60 * 1000;
  const cacheSnapshot = (groups: ThreadGroup[], pageToken: string | null) => fingerprint(JSON.stringify([groups, pageToken]));

  function saveCardCache(cardId: string, groups: ThreadGroup[], pageToken: string | null): Promise<void> {
    if (isSearchCard(cardId)) return Promise.resolve();
    const snapshot = cacheSnapshot(groups, pageToken);
    const known = knownCardCache[cardId];
    const now = Date.now();
    if (known?.snapshot === snapshot && now - known.at < CACHE_REWRITE_MS) return Promise.resolve();
    knownCardCache[cardId] = { snapshot, at: now };
    return saveCachedCardThreads(cardId, groups, pageToken).catch(e => {
      delete knownCardCache[cardId];
      throw e;
    });
  }

  // What a card's fetch was made for: its account (or all of them) and query
  const fetchedFor = (card: Card | undefined) => card ? `${card.account_id}\n${card.query}` : undefined;

  // The card was edited or deleted since a fetch for `fetched` started
  function cardQueryChanged(cardId: string, fetched: string | undefined): boolean {
    return fetchedFor(cardById(cardId)) !== fetched;
  }

  async function loadCardThreads(cardId: string, append = false, forceRefresh = false) {
    if (!selectedAccount()) return;

    // Check if this is a calendar card
    const card = cardById(cardId);

    // A response for a query or account the card no longer has must not
    // write its threads into the store (dock badge, autocomplete)
    const fetched = fetchedFor(card);
    const stale = () => cardQueryChanged(cardId, fetched);
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
      if (!append && !forceRefresh && !isSearchCard(cardId)) {
        const cached = await getCachedCardThreads(cardId);
        if (stale()) return;
        if (cached && cached.groups.length > 0) {
          knownCardCache[cardId] = { snapshot: cacheSnapshot(cached.groups, cached.next_page_token), at: cached.cached_at * 1000 };
          // Show cached data immediately
          setCardThreads(cardId, reconcile(cached.groups, { key: "gmail_thread_id" }));
          setCardPageTokens(cardId, cached.next_page_token);
          setCardHasMore(cardId, !!cached.next_page_token);
          // cached_at is in seconds (Unix timestamp), convert to milliseconds
          setLastSyncTimes(cardId, cached.cached_at * 1000);
          setLoadingThreads(cardId, false);

          // Fetch fresh data in background (don't await)
          fetchAndCacheThreads(cardId);
          return;
        }
      }

      const pageToken = append ? cardPageTokens[cardId] : null;
      const result = card && isSearchCard(cardId)
        ? await fetchQueryThreads(card.account_id, card.query, pageToken)
        : await fetchThreadsPaginated(cardId, pageToken);
      if (stale()) return;

      if (append) {
        // Merge new threads into existing groups
        const existingGroups = cardThreads[cardId] || [];
        const mergedGroups = mergeThreadGroups(existingGroups, result.groups);
        setCardThreads(cardId, mergedGroups);
        // Save merged groups to cache
        await saveCardCache(cardId, mergedGroups, result.next_page_token);
      } else {
        setCardThreads(cardId, reconcile(result.groups, { key: "gmail_thread_id" }));
        // Save to cache
        await saveCardCache(cardId, result.groups, result.next_page_token);
      }

      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
      setOffline(false);
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
    const card = cardById(cardId);
    if (!card) return;
    const fetched = fetchedFor(card);
    const stale = () => cardQueryChanged(cardId, fetched);

    // Prevent concurrent loads (unless force refresh)
    if (!forceRefresh && loadingThreads[cardId]) return;

    setLoadingThreads(cardId, true);
    setCardErrors(cardId, null);

    try {
      // For initial load (not force refresh), try cache first
      if (!forceRefresh && !isSearchCard(cardId)) {
        const cached = await getCachedCardEvents(cardId);
        if (stale()) return;
        if (cached && cached.events.length > 0) {
          // Show cached data immediately
          setCardCalendarEvents(cardId, reconcile(cached.events, { key: "id" }));
          // cached_at is in seconds
          setLastSyncTimes(cardId, cached.cached_at * 1000);
          setLoadingThreads(cardId, false);

          // Fetch fresh data in background
          fetchAndCacheCalendarEvents(cardId, card.query);
          return;
        }
      }

      // No cache or forced refresh - fetch and wait
      await fetchAndCacheCalendarEvents(cardId, card.query);
    } catch (e) {
      if (stale()) return;
      console.error("loadCalendarEvents error:", e);
      handleCardLoadError(cardId, e);
    } finally {
      setLoadingThreads(cardId, false);
    }
  }

  // The account a card's failed fetch was about: the one an all-inboxes
  // error names, else the card's own
  function failedAccountId(card: Card | undefined, e: unknown): string | null {
    const named = accountFromError(e, accounts());
    if (named) return named.id;
    return card && card.account_id !== ALL_ACCOUNTS ? card.account_id : null;
  }

  function handleCardLoadError(cardId: string, e: unknown) {
    const errorMsg = String(e);
    if (!isSessionExpiredError(errorMsg)) {
      if (isOfflineError(errorMsg)) setOffline(true);
      setCardErrors(cardId, cardLoadErrorMessage(errorMsg, isCalendarCard(cardId)));
      setSyncErrors(cardId, errorMsg);
      return;
    }
    setCardErrors(cardId, "Session expired");
    const accountId = failedAccountId(cardById(cardId), e);
    if (accountId) markSessionExpired(accountId);
  }

  // The account and its cards stay: signing in again with the same email
  // reuses the account id, so the layout comes back as it was
  function markSessionExpired(accountId: string) {
    setExpiredAccountId(accountId);
  }

  // Background syncs keep showing cached mail; an expired session must still
  // surface, or the cards silently go stale
  function noteBackgroundError(accountId: string | null, e: unknown) {
    if (isOfflineError(e)) setOffline(true);
    if (accountId && isSessionExpiredError(String(e)) && accountById(accountId)) markSessionExpired(accountId);
  }

  // Signed in again: refetch what the account's cards show
  async function resumeAccountAfterAuth(account: Account) {
    setExpiredAccountId(null);
    upsertAccount(account);
    if (!selectedAccount()) chooseDefaultAccount(account);
    const board = await loadBoard();
    if (!board) return;
    startBackgroundSync(account.id);
    for (const card of board) {
      if (cardCoversAccount(card, account.id) && !collapsedCards[card.id]) loadCardThreads(card.id, false, true);
    }
  }

  // Asks Google again for everything the board couldn't load or refresh
  async function retryConnection() {
    if (reconnecting()) return;
    setReconnecting(true);
    try {
      const failed = cards().filter(c => !collapsedCards[c.id] && (cardErrors[c.id] || syncErrors[c.id]));
      await Promise.all([performIncrementalSync(), ...failed.map(c => loadCardThreads(c.id, false, true))]);
    } finally {
      setReconnecting(false);
    }
  }
  const goOffline = () => setOffline(true);

  const boardStatus = createMemo(() => {
    if (!selectedAccount()) return null;
    const synced = cards().map(c => lastSyncTimes[c.id]).filter((t): t is number => !!t);
    return connectionStatus(
      {
        expiredEmail: accountById(expiredAccountId())?.email ?? null,
        offline: offline(),
        reconnecting: reconnecting(),
        lastSyncedAt: synced.length > 0 ? Math.max(...synced) : null,
      },
      t => formatClock(new Date(t)),
    );
  });

  function handleReauth() {
    return signInWithGoogle(resumeAccountAfterAuth);
  }

  async function fetchAndCacheCalendarEvents(cardId: string, query: string) {
    const card = cardById(cardId);
    if (!card) return;
    const fetched = fetchedFor(card);
    try {
      const events = (await fetchCalendarEvents(card.account_id, query)).filter(ev => !heldEventDeletes.has(ev.id));
      if (cardQueryChanged(cardId, fetched)) return;
      setCardCalendarEvents(cardId, reconcile(events, { key: "id" }));
      if (!isSearchCard(cardId)) await saveCachedCardEvents(cardId, events);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
      setOffline(false);
    } catch (e) {
      console.error("Failed to fetch calendar events:", e);
      setSyncErrors(cardId, String(e));
      // If foreground load failed, rethrow to be caught by loadCalendarEvents
      if (loadingThreads[cardId]) {
        throw e;
      }
      noteBackgroundError(failedAccountId(card, e), e);
    }
  }

  // Calendar cards have no change feed, so every sync tick refetches the
  // expanded ones. Overlapping refreshes of a card for the same account and
  // query share one follow-up fetch.
  const refreshCalendarCardFor = coalesceByKey((key: string) => {
    const [cardId, , query] = JSON.parse(key) as [string, string, string];
    return fetchAndCacheCalendarEvents(cardId, query);
  });
  function refreshCalendarCard(cardId: string) {
    const card = cardById(cardId);
    if (!card) return Promise.resolve();
    return refreshCalendarCardFor(JSON.stringify([card.id, card.account_id, card.query]));
  }
  function refreshCalendarCards() {
    for (const card of cards()) {
      if (card.card_type !== "calendar") continue;
      if (collapsedCards[card.id] || loadingThreads[card.id]) continue;
      refreshCalendarCard(card.id).catch(() => {});
    }
  }

  // Background refresh of a card's first page (no loading state shown).
  // Overlapping requests for a card, for the same account and query, share
  // one follow-up fetch instead of downloading it concurrently.
  const refreshCardThreads = coalesceByKey((key: string) => {
    const [cardId] = JSON.parse(key) as [string, string];
    return refreshCardThreadsNow(cardId);
  });
  function fetchAndCacheThreads(cardId: string) {
    // Skip for calendar cards (they don't use thread caching)
    if (isCalendarCard(cardId)) return Promise.resolve();
    return refreshCardThreads(JSON.stringify([cardId, fetchedFor(cardById(cardId))]));
  }

  async function refreshCardThreadsNow(cardId: string) {

    // Capture pagination state so a page-1 fetch that resolves after the
    // user paginated doesn't wipe appended pages or rewind the page token
    const tokenBeforeFetch = cardPageTokens[cardId] ?? null;
    const card = cardById(cardId);
    const fetched = fetchedFor(card);
    try {
      const result = await fetchThreadsPaginated(cardId, null);
      if (cardQueryChanged(cardId, fetched)) return;
      // Skip update if a recent action happened (prevents overwriting optimistic updates)
      const recent = lastAction();
      if (recent && Date.now() - recent.timestamp < 3000) {
        // Don't touch UI state; also skip the cache write when the action
        // touched this card — this fetch may predate the server-side modify,
        // and caching its groups would resurrect the pre-action state
        if (recent.cardIds.includes(cardId) || recent.cardId === cardId) return;
        await saveCardCache(cardId, result.groups, result.next_page_token);
        return;
      }
      if ((cardPageTokens[cardId] ?? null) !== tokenBeforeFetch || loadingMore[cardId]) {
        // Card paginated while this fetch was in flight; refresh the
        // page-1 cache but leave UI state alone
        await saveCardCache(cardId, result.groups, result.next_page_token);
        return;
      }
      setCardThreads(cardId, reconcile(result.groups, { key: "gmail_thread_id" }));
      setCardPageTokens(cardId, result.next_page_token);
      setCardHasMore(cardId, result.has_more);
      await saveCardCache(cardId, result.groups, result.next_page_token);
      setLastSyncTimes(cardId, Date.now());
      setSyncErrors(cardId, null);
      setOffline(false);
    } catch (e) {
      // Background refresh failed - set sync error but keep cached data shown
      setSyncErrors(cardId, String(e));
      noteBackgroundError(failedAccountId(card, e), e);
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
    if (colorIndex !== null) {
      safeSetItem("bgColorIndex", String(colorIndex));
    } else {
      safeRemoveItem("bgColorIndex");
    }
  }

  // Each card's grouped and filtered threads and events, recomputed only
  // when what they are built from changes. Rows ask for their card's groups
  // on every focus, hover and keystroke.
  const cardGroupMemos = createMemo(mapArray(() => cards().map(c => c.id), cardId => {
    const groups = createMemo(() => computeDisplayGroups(cardId));
    return {
      cardId,
      threads: createMemo(() => withNowFor(cardId, groups())),
      events: createMemo(() => computeCalendarEventGroups(cardId)),
    };
  }));
  const cardGroupsById = createMemo(() => new Map(cardGroupMemos().map(m => [m.cardId, m])));

  function getDisplayGroups(cardId: string): ThreadGroup[] {
    return cardGroupsById().get(cardId)?.threads() ?? withNowFor(cardId, computeDisplayGroups(cardId));
  }

  // Meetings about to start or running, pulled above the card's groups
  function withNowFor(cardId: string, groups: ThreadGroup[]): ThreadGroup[] {
    const card = cardById(cardId);
    const now = minuteNow();
    return withNowSection(groups, (t: Thread) =>
      isHappeningNow(t.calendar_event, inviteRsvp(accountById(threadAccountId(t, card)), t.calendar_event?.uid ?? null), now));
  }

  function getCalendarEventGroups(cardId: string): CalendarEventGroup[] {
    return cardGroupsById().get(cardId)?.events() ?? computeCalendarEventGroups(cardId);
  }

  function computeDisplayGroups(cardId: string): ThreadGroup[] {
    const threads = isPreviewingQuery(cardId) ? queryPreviewThreads() : cardThreads[cardId];
    if (!threads) return [];
    const groupBy = getGroupByForCard(cardId);
    let groups = regroupThreads(threads, groupBy, cardLabelNames(cardById(cardId)));

    // Apply global filter
    const filter = globalFilter().toLowerCase().trim();
    if (filter && filterHides() && !isSearchCard(cardId)) {
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

  // A today or tomorrow card's free stretches in its own day's group; none
  // while the board's filter hides rows, which would open false gaps
  function calendarGutters(cardId: string, group: CalendarEventGroup): Gutter[] {
    const query = isPreviewingQuery(cardId) ? editCardQuery() : cardById(cardId)?.query ?? "";
    const now = minuteNow();
    const day = gutterDay(query, new Date(now));
    if (!day || group.label !== formatDayLabel(day, new Date(today()))) return [];
    if (globalFilter().trim() && filterHides() && !isSearchCard(cardId)) return [];
    return dayGutters(group.events, day, now);
  }

  function computeCalendarEventGroups(cardId: string): CalendarEventGroup[] {
    const events = isPreviewingQuery(cardId) ? queryPreviewCalendarEvents() : cardCalendarEvents[cardId];
    if (!events) return [];
    const groupBy = getGroupByForCard(cardId);
    let groups = groupCalendarEvents(events, groupBy, new Date(today()));

    // Apply global filter
    const filter = globalFilter().toLowerCase().trim();
    if (filter && filterHides() && !isSearchCard(cardId)) {
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
    accountId: string,
    messageId: string,
    attachmentId: string | undefined,
    filename: string,
    mimeType: string,
    inlineData?: string | null
  ) {
    showToast(`Opening ${filename}...`);
    try {
      await openAttachmentApi(
        accountId,
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
          run: () => downloadAttachment(accountId, messageId, attachmentId, filename, mimeType, inlineData),
        });
        return;
      }
      setFailure(`Couldn't open ${filename}`, e);
    }
  }

  // The attachments the lightbox steps through, all of one account's mail
  const [attachmentPreview, setAttachmentPreview] = createSignal<{ accountId: string; items: PreviewAttachment[]; index: number } | null>(null);

  // Images and PDFs open in the lightbox, with the row's others to step through
  function openCardAttachment(accountId: string, attachments: Attachment[], attachment: Attachment) {
    const previewable = attachments.filter(a => isPreviewable(a.mime_type));
    const index = previewable.indexOf(attachment);
    if (index === -1) {
      openAttachment(accountId, attachment.message_id, attachment.attachment_id, attachment.filename, attachment.mime_type, attachment.inline_data);
      return;
    }
    const items = previewable.map(a => ({
      messageId: a.message_id, attachmentId: a.attachment_id, filename: a.filename, mimeType: a.mime_type, size: a.size, inlineData: a.inline_data,
    }));
    setAttachmentPreview({ accountId, items, index });
  }

  async function loadPreviewData(item: PreviewAttachment): Promise<string> {
    const accountId = attachmentPreview()?.accountId;
    if (!accountId) throw new Error("No account selected");
    return downloadAttachmentApi(accountId, item.messageId, item.attachmentId);
  }

  async function downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string | undefined,
    filename: string,
    mimeType: string,
    inlineData?: string | null
  ) {
    showToast(`Downloading ${filename}...`);
    try {
      const savedPath = await saveAttachmentApi(
        accountId,
        messageId,
        attachmentId || null,
        filename,
        mimeType || null,
        inlineData || null
      );
      showToast(`Saved to ${savedPath}`);
    } catch (e) {
      console.error('Failed to download attachment:', e);
      setFailure(`Couldn't save ${filename}`, e);
    }
  }

  // Close menus when clicking outside
  function handleAppClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.color-picker') && !target.closest('.bg-color-picker')) {
      setColorPickerOpen(false);
      setEditColorPickerOpen(false);
    }
    if (!target.closest('.thread')) {
      setActionsWheelOpen(false);
      setHoveredThread(null);
    }
    if (!target.closest('.calendar-event-item')) {
      setEventActionsWheelOpen(false);
      setHoveredEvent(null);
    }
    if (!target.closest('.quick-reply-box') && !quickReply().text.trim()) {
      setQuickReply(qr => ({ ...qr, threadId: null }));
      setQuickReplyEventId(null);
    }
    if (!target.closest('.action-config-menu')) {
      setActionConfigMenu(null);
    }
  }

  // The user labels of the accounts the card form's card shows, for its query
  const userLabelNames = createMemo(() => {
    const scope = formScope();
    const ids = scope ? cardAccountIds({ account_id: scope }, accounts()) : [];
    const names = ids.flatMap(id => (labelsByAccount[id] ?? []).filter(l => l.label_type === "user").map(l => l.name));
    return [...new Set(names)];
  });

  function suggestQuery(query: string, caret: number): QuerySuggestion[] {
    return querySuggestions(query, rankedContacts(), userLabelNames(), caret);
  }

  async function openThread(threadId: string, cardId: string) {
    const account = threadOwner(threadId, cardId);
    if (!account) {
      console.error("The thread's account is not signed in");
      return;
    }

    rememberOpenedRow(cardId, threadId);
    setActiveThreadAccountId(account.id);
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
      const gmailDraft = draftToOpen(details);
      if (gmailDraft && !gmailDraft.replyTo) {
        setThreadLoading(false);
        closeThreadView();
        continueGmailDraft(account.id, threadId, gmailDraft);
        return;
      }
      setActiveThread(details);
      if (gmailDraft) continueGmailDraft(account.id, threadId, gmailDraft);
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

  // Continue a thread's Gmail draft in compose: a new email in the compose
  // panel, a reply in the open thread
  async function continueGmailDraft(accountId: string, threadId: string, draft: DraftToOpen) {
    const { init, missingAttachments } = await prepareDraftCompose(accountId, threadId, draft, {
      listThreadDrafts,
      download: (messageId, attachmentId) => downloadAttachmentApi(accountId, messageId, attachmentId),
    }, Date.now());
    if (activeThreadId() !== (draft.replyTo ? threadId : null) || !accountById(accountId)) return;
    openComposeUnlessBusy(`Draft: ${init.subject || "(no subject)"}`, () => {
      startCompose({ ...init, accountId, signature: false, focusBody: true });
      if (missingAttachments.length > 0) showToast(`Attach again: ${missingAttachments.join(", ")}`);
    });
  }

  async function discardDraftRow(threadId: string, cardId: string) {
    const account = threadOwner(threadId, cardId);
    if (!account) return;
    try {
      await discardThreadDrafts(account.id, threadId, { listThreadDrafts, deleteDraft });
    } catch (e) {
      showFailure("Couldn't discard the draft", e);
      return;
    }
    if (!accountById(account.id)) return;
    const updated: Record<string, ThreadGroup[]> = { ...cardThreads };
    for (const card of cards()) {
      if (updated[card.id] && cardCoversAccount(card, account.id)) updated[card.id] = withDraftsDiscarded(updated[card.id], threadId, card.query);
    }
    setCardThreads(reconcile(updated, { key: "gmail_thread_id" }));
  }

  // Fetch CID image attachments for inline display; reopening a thread
  // reuses what was downloaded
  const cidImageCache = createLruCache<string>(60);
  async function fetchCidAttachments(accountId: string, thread: FullThread) {
    const refs = cidImagesToFetch(thread);
    if (refs.length === 0) return;
    // Keyed by content id: Gmail may give the same part a new attachment id
    // on every fetch
    const data = await fetchCidImages(refs, ({ messageId, attachmentId, cid }) =>
      cidImageCache.getOrLoad(`${accountId}:${messageId}:${cid}`, () => downloadAttachmentApi(accountId, messageId, attachmentId)));
    if (Object.keys(data).length > 0 && activeThreadId() === thread.id) {
      setCidAttachmentData(prev => ({ ...prev, ...data }));
    }
  }

  function openEvent(event: GoogleCalendarEvent, cardId: string) {
    rememberOpenedRow(cardId, event.id);
    setActiveEventAccountId(eventOwner(event, cardId)?.id ?? null);
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
    if (eventForm().editing && !creatingEvent()) setEventForm(defaultEventForm());
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
      showFailure("Couldn't save the Gemini API key", e);
    }
  }

  let settingsSidebarRef: HTMLDivElement | undefined;
  // The closed panel stays in the DOM to slide in; inert keeps it out of
  // the tab order meanwhile
  createEffect(on(settingsOpen, (open, wasOpen) => {
    settingsSidebarRef?.toggleAttribute("inert", !open);
    if (open && wasOpen === false) settingsSidebarRef?.querySelector<HTMLElement>(".close-btn")?.focus();
  }));

  const [icloudStatus, setICloudStatus] = createSignal<ICloudSyncStatus | null>(null);
  createEffect(on(settingsOpen, open => {
    if (!open) return;
    getICloudSyncStatus().then(setICloudStatus, e => {
      console.warn("iCloud sync status unavailable:", e);
      setICloudStatus(null);
    });
  }));
  // Nothing in a build without iCloud: there is nothing to turn on
  const icloudStatusText = (status: ICloudSyncStatus) => {
    if (!status.available) return null;
    if (status.last_error) return `Not working: ${status.last_error}`;
    if (!status.last_synced_at) return "Not synced yet";
    return `Synced ${formatSyncTime(status.last_synced_at, currentTime())}`;
  };

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

  function showToast(message: string, action?: ToastAction | ToastAction[]) {
    toasts.show({ message, action });
  }

  async function undoThreadAction(action: UndoableAction) {
    if (lastAction() === action) setLastAction(null);
    try {
      // An account signed out of since has nothing left to undo
      const reversals = action.reversals.filter(r => accountById(r.accountId));
      await Promise.all(reversals.map(r => modifyThreads(r.accountId, r.threadIds, r.add, r.remove)));
      // Refresh every card the optimistic update touched, not just the
      // one the action originated from
      const cardsToRefresh = action.cardIds.length > 0 ? action.cardIds : [action.cardId];
      for (const cId of cardsToRefresh) {
        if (cardById(cId)) fetchAndCacheThreads(cId);
      }
    } catch (e) {
      console.error("Failed to undo action", e);
      setFailure("Couldn't undo", e);
    }
  }

  // silent: a change the user didn't ask for directly (marking a thread
  // read on open) gets no undo toast. `accountId` names the threads' account
  // when the card may no longer list them (the open thread).
  async function handleThreadAction(action: string, threadIds: string[], cardId: string, { silent = false, accountId }: { silent?: boolean; accountId?: string } = {}) {
    const byAccount = accountId
      ? new Map([[accountId, threadIds]])
      : threadIdsByAccount(cardThreads[cardId] ?? [], threadIds, cardById(cardId) ?? { account_id: "" });
    const owners = [...byAccount.keys()].map(accountById);
    if (owners.length === 0 || owners.some(a => !a)) return;
    const ownerOf = new Map([...byAccount].flatMap(([acc, ids]) => ids.map(id => [id, acc] as const)));
    // Thread ids are only unique within an account: a card's thread is one
    // of these when it has the id and comes from the account acted in
    const isTarget = (t: Thread, card: Card) => ownerOf.get(t.gmail_thread_id) === threadAccountId(t, card);

    const { add: addLabels, remove: removeLabels } = labelChangeFor(action);

    // Optimistic Update - update ALL cards that contain these threads.
    // Snapshot the affected cards first so the update can be rolled back
    // if the API call fails.
    const updatedCardThreads: Record<string, ThreadGroup[]> = {};
    const snapshot: Record<string, ThreadGroup[]> = {};
    const affectedCardIds: string[] = [];
    const labelsBefore = new Map<string, Map<string, Pick<Thread, "labels" | "unread_count">>>();

    for (const card of cards()) {
      const groups = cardThreads[card.id];
      if (!groups) continue;
      const ids = [...new Set(groups.flatMap(g => g.threads).filter(t => isTarget(t, card)).map(t => t.gmail_thread_id))];
      if (ids.length === 0) continue;
      snapshot[card.id] = structuredClone(unwrap(groups));
      affectedCardIds.push(card.id);
      for (const t of snapshot[card.id].flatMap(g => g.threads)) {
        if (!isTarget(t, card)) continue;
        const acc = ownerOf.get(t.gmail_thread_id)!;
        if (!labelsBefore.has(acc)) labelsBefore.set(acc, new Map());
        labelsBefore.get(acc)!.set(t.gmail_thread_id, t);
      }
      updatedCardThreads[card.id] = applyThreadAction(groups, ids, action, actionRemovesFromCard(action, card.query));
    }

    batch(() => {
      for (const [cId, groups] of Object.entries(updatedCardThreads)) {
        setCardThreads(cId, reconcile(groups, { key: "gmail_thread_id" }));
      }
    });
    if (!silent) setActionsWheelOpen(false);

    // Clear selection after bulk action
    if (threadIds.length > 1) {
      setSelectedThreads({ ...selectedThreads(), [cardId]: new Set() });
    }

    const results = await Promise.allSettled([...byAccount].map(([acc, ids]) => modifyThreads(acc, ids, addLabels, removeLabels)));
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      console.error("Failed to modify threads", failure.reason);
      // Roll back the optimistic update; the cache was never written. When
      // some accounts took the change, refetching shows what the server has.
      setCardThreads(produce(s => {
        for (const cId of affectedCardIds) {
          if (cardById(cId)) s[cId] = snapshot[cId];
        }
      }));
      if (results.some(r => r.status === "fulfilled")) {
        for (const cId of affectedCardIds) if (cardById(cId)) fetchAndCacheThreads(cId);
      }
      setFailure(actionFailureLabel(action, threadIds.length), failure.reason);
      return;
    }

    // Persist the optimistic changes only after the server accepted them
    for (const cId of affectedCardIds) {
      saveCardCache(cId, updatedCardThreads[cId], cardPageTokens[cId] || null)
        .catch(e => console.warn("Failed to update thread cache:", e));
    }
    if (silent) return;
    const change = { add: addLabels, remove: removeLabels };
    const done: UndoableAction = {
      action,
      threadIds,
      cardId,
      cardIds: affectedCardIds,
      reversals: [...byAccount].flatMap(([acc, ids]) => undoLabelChanges(acc, ids, change, labelsBefore.get(acc) ?? new Map())),
      timestamp: Date.now()
    };
    setLastAction(done);
    const emails = owners.map(a => a!.email);
    toasts.show({
      message: inAccount(actionLabel(action, threadIds.length), emails, accounts().length),
      tag: owners.length === 1 ? accountToastTag(owners[0]!.id) : undefined,
      undo: () => undoThreadAction(done),
    });
  }

  function toggleThreadSelection(cardId: string, threadId: string, e?: MouseEvent) {
    // Show actions on the selected thread
    setHoveredThread(rowKey(cardId, threadId));
    setActionsWheelOpen(true);
    const ids = getDisplayGroups(cardId).flatMap(g => g.threads.map(t => t.gmail_thread_id));
    const next = nextSelection(ids, selectedThreads()[cardId] ?? new Set(), lastSelectedThread()[cardId] ?? null, threadId, !!e?.shiftKey);
    setSelectedThreads({ ...selectedThreads(), [cardId]: next.selected });
    setLastSelectedThread({ ...lastSelectedThread(), [cardId]: next.pivot });
    // The selection keys act on the focused card's selection
    onRowFocus(cardId, threadId);
  }

  function toggleEventSelection(cardId: string, eventId: string, e?: MouseEvent) {
    // Show actions on the selected event
    setHoveredEvent(rowKey(cardId, eventId));
    setEventActionsWheelOpen(true);
    const ids = getCalendarEventGroups(cardId).flatMap(g => g.events.map(ev => ev.id));
    const next = nextSelection(ids, selectedEvents()[cardId] ?? new Set(), lastSelectedEvent()[cardId] ?? null, eventId, !!e?.shiftKey);
    setSelectedEvents({ ...selectedEvents(), [cardId]: next.selected });
    setLastSelectedEvent({ ...lastSelectedEvent(), [cardId]: next.pivot });
    onRowFocus(cardId, eventId);
  }

  // Ranking reads every loaded thread; only rank while something shows
  // contacts, so mail changes don't re-sort them in the background
  const contactsWanted = () => composeFabHovered() || (composing() && !closingCompose()) || addingCard() || editingCardId() !== null
    || creatingEvent() || !!eventForm().editing;
  const guestSuggestions = (query: string) => matchContacts(rankedContacts(), query, 8);
  const rankedContacts = createMemo(() => contactsWanted() ? rankContacts(
    googleContacts(),
    Object.values(cardThreads).flatMap(groups => groups.flatMap(g => g.threads)),
    accounts().map(a => a.email),
    Date.now(),
  ) : []);
  // Kept while the suggestions fade out after the pointer leaves
  const fabSuggestions = createMemo<RecentContact[]>(shown => composeFabHovered() ? rankedContacts().slice(0, 3) : shown, []);
  // The default account's threads and events, read only while New Event is hovered
  const eventFabSuggestions = createMemo<EventSuggestion[]>(shown => {
    if (!eventFabHovered()) return shown;
    const accountId = selectedAccount()?.id;
    const threads = cards().flatMap(card => (cardThreads[card.id] ?? [])
      .flatMap(g => g.threads)
      .filter(t => threadAccountId(t, card) === accountId));
    const events = cards().flatMap(card => (cardCalendarEvents[card.id] ?? [])
      .filter(e => eventAccountId(e, card) === accountId));
    return rankEventSuggestions(threads, events, accounts().map(a => a.email), Date.now()).slice(0, 2);
  }, []);

  const suggestContacts = (query: string) => matchContacts(rankedContacts(), query, 8);
  const sidePanelBesideView = () => panelBesideView({
    placement: composeShownIn(),
    creatingEvent: creatingEvent(),
    viewOpen: !!activeThreadId() || !!activeEvent(),
  });

  // The opened invite's day, for the strip above the email: answered or not,
  // while the event is still ahead
  const openedInvite = () => {
    const invite = activeListedThread()?.calendar_event;
    const account = activeThreadAccount();
    if (!invite || !account || invite.all_day) return null;
    const state = inviteState(invite, inviteRsvp(account, invite.uid), minuteNow());
    return state === "past" || state === "cancelled" ? null : { invite, account };
  };
  createEffect(() => {
    const opened = openedInvite();
    if (opened) inviteDayLookups.request(opened.account.id, inviteEnd(opened.invite));
  });
  const openedInviteStrip = createMemo(() => {
    const opened = openedInvite();
    if (!opened) return null;
    const { invite, account } = opened;
    const known = inviteDays[account.id];
    if (!known || known.until < inviteEnd(invite)) return null;
    const slot = { start: invite.start_time, end: inviteEnd(invite) };
    return stripLayout(slot, dayOtherEvents(known.events, { ...slot, uid: invite.uid }), minuteNow());
  });

  return (
    <div
      class="app"
      classList={{ "side-panel-open": sidePanelBesideView() }}
      onClick={handleAppClick}
    >
      {/* Drag region for frameless window */}
      <div class="drag-region" data-tauri-drag-region></div>

      <ConnectionStatusBar status={boardStatus()} onRetry={retryConnection} onSignIn={handleReauth} />
      <PostmarkDefs />

      {/* Search bar: typing narrows the loaded cards, Enter searches Gmail */}
      <div class={`global-filter-bar ${showGlobalFilter() ? 'visible' : ''}`}>
        <div class="global-filter-container">
          <Show when={showGlobalFilter()}>
            <QueryField
              query={globalFilter()}
              setQuery={setGlobalFilter}
              suggest={suggestQuery}
              contacts={rankedContacts()}
              labelNames={userLabelNames()}
              onSave={keepSearch}
              onCancel={closeSearch}
              onSubmit={() => runSearch()}
              placeholder="Search mail and events…"
              inputRef={(el) => { filterInputRef = el; }}
              onActive={(insert) => { insertIntoQueryField = insert; }}
            />
          </Show>
          <Show
            when={searchShown()}
            fallback={<KeyHint keys="↵" class="global-filter-hint" title="Enter searches, ⌘Enter keeps it as a card, Escape closes" />}
          >
            <button type="button" class="btn btn-primary btn-sm global-filter-keep" onClick={keepSearch} title="Keep as a card (⌘Enter)">
              <CheckIcon size="meta" />
              Keep as card
            </button>
          </Show>
        </div>
        <Show when={showGlobalFilter() && !globalFilter().trim() && recentSearches().length > 0}>
          <div class="recent-searches" aria-label="Recent searches">
            <For each={recentSearches()}>
              {(query) => (
                <div class="recent-search-row">
                  <button type="button" class="recent-search" onMouseDown={(e) => e.preventDefault()} onClick={() => runSearch(query)}>
                    <SearchIcon size="meta" />
                    <span>{query}</span>
                  </button>
                  <button
                    type="button"
                    class="recent-search-forget"
                    aria-label={`Forget ${query}`}
                    title="Forget this search"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => saveRecentSearches(forgetSearch(recentSearches(), query))}
                  >
                    <CloseIcon size="meta" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* The account, in the title bar across from the window controls */}
      <Show when={selectedAccount()}>
        <div class="titlebar-account" data-board>
          <Show when={selectedAccount()}>
            <div class="account-chooser-container">
              <button
                class="toolbar-avatar"
                onClick={(e) => { e.stopPropagation(); setAccountChooserOpen(!accountChooserOpen()); }}
                title={selectedAccount()?.email || "Account"}
                aria-haspopup="menu"
                aria-expanded={accountChooserOpen()}
              >
                <Avatar email={selectedAccount()?.email || ""} picture={selectedAccount()?.picture} size="fill" />
              </button>
              <Show when={accountChooserOpen()}>
                <div class="account-chooser-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div class="account-chooser-header">Accounts</div>
                  <div class="account-chooser-list">
                    <For each={accounts()}>
                      {(account) => (
                        <button
                          class={`account-chooser-item ${account.id === selectedAccount()?.id ? 'active' : ''}`}
                          title="New emails, cards and events use the checked account"
                          aria-pressed={account.id === selectedAccount()?.id}
                          onClick={() => {
                            setAccountChooserOpen(false);
                            chooseDefaultAccount(account);
                          }}
                        >
                          <Avatar email={account.email} picture={account.picture} size="md" />
                          <span class="account-chooser-email">{account.email}</span>
                          {account.id === selectedAccount()?.id && (
                            <span class="account-chooser-check"><CheckIcon /></span>
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
      </Show>

      {/* Until the board's flower is found, how to open it */}
      <Show when={selectedAccount() && boardHintShown() && cards().length > 0}>
        <p class="board-hint">
          Double-click the board for a new email, event, color or search
          <button type="button" class="board-hint-dismiss" onClick={retireBoardHint}>Got it</button>
        </p>
      </Show>

      <Show when={boardFlowerAt()}>
        {(at) => (
          <BoardFlower
            at={at()}
            colors={BOARD_COLORS.map(color => ({ hue: color.hue, label: color.name }))}
            value={boardHue() ?? null}
            onCompose={() => { if (!composing() || closingCompose()) startCompose({}); }}
            onEvent={() => openNewEventForm()}
            onSearch={openSearch}
            onColor={(hue) => selectBgColor(hue === null ? null : BOARD_COLORS.findIndex(color => color.hue === hue))}
            onPreview={(hue) => {
              const shown = hue === undefined ? boardHue() : hue;
              if (shown) document.documentElement.dataset.boardHue = shown;
              else delete document.documentElement.dataset.boardHue;
            }}
            onClose={() => setBoardFlowerAt(null)}
          />
        )}
      </Show>

      {/* Error banner */}
      <Show when={error()}>
        <div class="auth-error" role="alert">
          {error()!.message}
          <Show when={error()!.details}>
            {(details) => (
              <details class="error-details">
                <summary>Details</summary>
                <span>{details()}</span>
              </details>
            )}
          </Show>
          <button class="btn" onClick={() => setError(null)} aria-label="Dismiss error"><CloseIcon /></button>
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
        <AuthScreen
          hasClient={storedClientId() === undefined ? undefined : storedClientId() !== null}
          clientId={clientId()}
          clientSecret={clientSecret()}
          onClientId={setClientId}
          onClientSecret={setClientSecret}
          onSignIn={handleSignIn}
          onSaveAndSignIn={handleSaveSettings}
          showPortHint={signInFailed()}
        />
      </Show>

      {/* Auth loading */}
      <Show when={authLoading()}>
        <div class="auth-screen">
          <div class="auth-spinner"></div>
          <Show when={authPhase() === "browser"} fallback={<p>Setting up your cards…</p>}>
            <p>Finish signing in with Google in your browser. Posta will pick up automatically.</p>
            <div class="auth-wait-actions">
              <button class="btn btn-ghost" onClick={cancelSignIn}>Cancel</button>
              <button class="btn btn-ghost" onClick={reopenSignInPage}>Open sign-in page again</button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Deck */}
      <Show when={!loading() && selectedAccount()}>
        <DragDropProvider onDragStart={onDragStart} onDragEnd={onDragEnd as any} collisionDetector={mostIntersecting}>
          <DragDropSensors />
          <div
            class={`deck ${resizing() ? 'resizing' : ''} ${boardStatus() ? 'has-status' : ''}`}
            data-board
            onDblClick={openBoardFlower}
            onContextMenu={openBoardFlower}
          >
            {/* The board's first column: a + that grows, over the cards, into what
                can be started, where the compose and event panels then open */}
            <Show when={!addingCard()}>
              <div
                class="board-slot-anchor"
                classList={{ "covered": (composeShownIn() === "panel" && !closingCompose()) || (creatingEvent() && !eventForm().closing) }}
              >
              <div
                class="board-slot"
                classList={{ "open": slotOpen() }}
                onMouseEnter={openSlot}
                onMouseLeave={() => { slotCloseTimeout = window.setTimeout(() => setSlotOpen(false), 250); }}
                onFocusIn={openSlot}
                onFocusOut={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSlotOpen(false);
                }}
              >
                <button
                  ref={slotButton}
                  class="board-slot-plus"
                  aria-label="New"
                  aria-haspopup="menu"
                  aria-expanded={slotOpen()}
                  title="New search, email or event"
                  onClick={openSearch}
                >
                  <PlusIcon size="tool" />
                </button>
                <BoardSlotWheel
                  open={slotOpen()}
                  onEscape={() => { setSlotOpen(false); slotButton?.focus(); }}
                  petals={[
                    { id: "search", label: "New search", caption: "Search", hint: "/", icon: SearchIcon, onSelect: () => { setSlotOpen(false); openSearch(); } },
                    {
                      id: "email", label: "Compose new email", caption: "Email", hint: "C", icon: ComposeIcon,
                      onSelect: () => { setSlotOpen(false); if (!composing() || closingCompose()) startCompose({}); },
                      list: {
                        label: "Write to",
                        entries: fabSuggestions().map(contact => {
                          const [local, domain] = contact.email.split("@");
                          const title = contact.name || local;
                          return {
                            id: contact.email,
                            label: `New email to ${contact.name || contact.email}`,
                            title,
                            detail: domain,
                            initial: title.charAt(0).toUpperCase(),
                            onSelect: () => { setSlotOpen(false); startCompose({ to: contact.email, focusBody: true }); },
                          };
                        }),
                      },
                    },
                    {
                      id: "event", label: "Create new calendar event", caption: "Event", hint: "E", icon: CalendarIcon,
                      onSelect: () => { setSlotOpen(false); openNewEventForm(); },
                      list: {
                        label: "Plan again",
                        entries: eventFabSuggestions().map(suggestion => {
                          const guests = guestList(suggestion.names);
                          const detail = suggestion.kind === "thread"
                            ? `with ${guests}`
                            : `again with ${guests} · ${formatShortDate(new Date(suggestion.at), undefined, { weekday: true })}`;
                          return {
                            id: suggestion.key,
                            label: `New event: ${suggestion.summary}, ${detail}`,
                            title: suggestion.summary,
                            detail: suggestion.kind === "thread" ? guests : `${guests} · ${formatShortDate(new Date(suggestion.at), undefined, { weekday: true })}`,
                            icon: suggestion.kind === "thread" ? MailIcon : RepeatIcon,
                            onSelect: () => { setSlotOpen(false); openNewEventForm({ summary: suggestion.summary, attendees: suggestion.attendees }); },
                          };
                        }),
                      },
                    },
                  ]}
                />
              </div>
              </div>
            </Show>
            <SortableProvider ids={cardIds()}>
              <For each={boardCards()}>
                {(card) => {
                  const sortable = createSortable(card.id);
                  createEffect(() => {
                    if (isPreviewingQuery(card.id)) return;
                    const rows = effectiveCardType(card) === "calendar" ? getCalendarEventGroups(card.id) : getDisplayGroups(card.id);
                    if (rows.length > 0) postmarks.sawContent(card.id, card.query);
                  });
                  const syncStatus = () => cardSyncStatus({ lastSyncedAt: lastSyncTimes[card.id], now: currentTime(), syncError: syncErrors[card.id], offline: offline(), expired: cardExpired(card) });
                  const namesAccount = () => boardMixesScopes(cards(), accounts());
                  const refreshLabel = () => [`Refresh ${card.name}`, syncStatus().summary].filter(Boolean).join(", ");
                  return (
                    <div
                      ref={sortable.ref}
                      class="card-wrapper"
                      style={{
                        transform: sortable.transform ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)` : undefined,
                      }}
                    >
                      <div
                        class={`card ${isSearchCard(card.id) ? 'search' : ''} ${collapsedCards[card.id] ? 'collapsed' : ''} ${editingCardId() === card.id ? 'editing' : ''} ${(offline() || cardExpired(card)) && (cardThreads[card.id] || cardCalendarEvents[card.id]) ? 'stale' : ''}`}
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
                            dirty={editCardDirty()}
                            setQueryHelpOpen={setQueryHelpOpen}
                            suggestQuery={suggestQuery}
                            contacts={rankedContacts()}
                            labelNames={userLabelNames()}
                            debounceQueryPreview={debounceQueryPreview}
                            onQueryFieldActive={(insert) => { insertIntoQueryField = insert; }}
                            accounts={accounts()}
                            accountId={editCardAccountId()}
                            setAccountId={(id) => { setEditCardAccountId(id); if (editCardQuery().trim()) debounceQueryPreview(editCardQuery()); }}
                          />
                        </Show>
                        <Show when={editingCardId() !== card.id}>
                          <div
                            class="card-header"
                            classList={{ "has-problem": !!syncStatus().problem }}
                            onClick={() => { if (!wasDragging && !isSearchCard(card.id)) toggleCardCollapse(card.id); }}
                            {...(isSearchCard(card.id) ? {} : sortable.dragActivators)}
                          >
                            <button
                              class="card-title-btn"
                              aria-label={cardTitleLabel({ name: card.name, accountId: card.account_id, accounts: accounts(), shown: namesAccount(), problem: syncStatus().problem, collapsed: !!collapsedCards[card.id], unread: getCardUnreadCount(card.id) })}
                              aria-expanded={!collapsedCards[card.id]}
                            >
                              <Show when={collapsedCards[card.id] && getCardUnreadCount(card.id) > 0}>
                                <span class="card-unread-badge" aria-hidden="true">{getCardUnreadCount(card.id)}</span>
                              </Show>
                              <span class="card-title-chevron" aria-hidden="true"><ChevronIcon size="ui" /></span>
                              <span class="card-title">{card.name}</span>
                              <CardAccountQualifier accountId={card.account_id} accounts={accounts()} shown={namesAccount()} problem={syncStatus().problem} />
                            </button>
                            <Show when={!collapsedCards[card.id] && getCardUnreadCount(card.id) > 0}>
                              <span class="card-unread-badge">{getCardUnreadCount(card.id)}</span>
                            </Show>
                            <Show when={isSearchCard(card.id)}>
                              <div class="card-actions">
                                <button class="icon-btn" onClick={(e) => { e.stopPropagation(); keepSearch(); }} title="Keep as a card (P)" aria-label="Keep as a card">
                                  <CheckIcon size="tool" />
                                </button>
                                <button class="icon-btn" onClick={(e) => { e.stopPropagation(); closeSearch(); }} title="Close search (Esc)" aria-label="Close search">
                                  <CloseIcon size="tool" />
                                </button>
                              </div>
                            </Show>
                            <div class="card-actions" hidden={isSearchCard(card.id)}>
                              <button
                                class={`icon-btn card-refresh ${loadingThreads[card.id] || loadingMore[card.id] ? 'spinning' : ''} `}
                                onClick={(e) => refreshCard(card.id, e)}
                                disabled={loadingThreads[card.id]}
                                title={refreshLabel()}
                                aria-label={refreshLabel()}
                              >
                                <RefreshIcon size="tool" />
                              </button>
                              <button
                                class="icon-btn"
                                onClick={(e) => startEditCard(card, e)}
                                title="Edit query"
                                aria-label={`Edit ${card.name}`}
                              >
                                <SearchIcon size="tool" />
                              </button>
                            </div>
                          </div>
                        </Show>
                        <div
                          class="card-body"
                          ref={(el) => onCleanup(watchScrollFade(el))}
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
                            <CardSkeleton />
                          </Show>
                          <Show when={isPreviewingQuery(card.id) && queryPreviewLoading()}>
                            <StatusLine kind="loading">Searching...</StatusLine>
                          </Show>
                          <Show when={isPreviewingQuery(card.id) && !queryPreviewLoading() && queryPreviewError()}>
                            <StatusLine kind="error">{queryPreviewError()}</StatusLine>
                          </Show>
                          <Show when={!loadingThreads[card.id] && cardErrors[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id] && cardWaitingMessage(cardErrors[card.id]!, syncErrors[card.id], cardExpired(card))}>
                            {(waiting) => <div class="card-waiting">{waiting()}</div>}
                          </Show>
                          <Show when={!loadingThreads[card.id] && cardErrors[card.id] && !cardThreads[card.id] && !cardCalendarEvents[card.id] && !cardWaitingMessage(cardErrors[card.id]!, syncErrors[card.id], cardExpired(card))}>
                            <div class="card-error">
                              <span class="error-icon"><WarningIcon /></span>
                              <span class="error-text">{cardErrors[card.id]}</span>
                              <Show
                                when={needsSignInAgain(cardErrors[card.id] ?? "")}
                                fallback={<button class="retry-btn" onClick={(e) => refreshCard(card.id, e)}>Try again</button>}
                              >
                                <button class="retry-btn" onClick={handleReauth}>Sign in again</button>
                              </Show>
                            </div>
                          </Show>

                          {/* Calendar card: show calendar events */}
                          <Show when={effectiveCardType(card) === "calendar" && (isPreviewingQuery(card.id) || cardCalendarEvents[card.id])}>
                            <Show when={getCalendarEventGroups(card.id).length === 0 && !(isPreviewingQuery(card.id) && (queryPreviewLoading() || queryPreviewError()))}>
                              <CardEmpty cardId={card.id} name={card.name} query={isPreviewingQuery(card.id) ? editCardQuery() : card.query} kind="calendar" noMatch={noMatchFor(card.id)} ledger={postmarks} />
                            </Show>
                            <Index each={getCalendarEventGroups(card.id)}>
                              {(group) => {
                                const gutters = createMemo(() => calendarGutters(card.id, group()));
                                const gutterAbove = (index: number) => gutters().find(g => g.beforeIndex === index);
                                return (
                                <>
                                  <div class="date-header">{group().label}</div>
                                  <For each={group().events}>
                                    {(event, index) => (
                                      <>
                                      <Show when={gutterAbove(index())}>
                                        {(gutter) => <CalendarGutter gutter={gutter()} now={minuteNow()} />}
                                      </Show>
                                      <div
                                        class={`calendar-event-item ${fadedBySearch(card.id, event.id) ? "faded" : ""} ${event.response_status === "declined" ? "declined" : ""} ${selectedEvents()[card.id]?.has(event.id) ? "selected" : ""} ${isEventFocused(card.id, event.id) ? "focused" : ""} ${isQuickReplyEvent(event.id) ? "replying" : ""}`}
                                        onClick={() => openEvent(event, card.id)}
                                        onMouseEnter={(e) => showEventHoverActions(card.id, event.id, e)}
                                        onMouseLeave={(e) => hideEventHoverActions(card.id, event.id, e)}
                                        tabindex={rowTabIndex(card.id, event.id)}
                                        onFocus={() => onRowFocus(card.id, event.id)}
                                      >
                                        <EventRowLines
                                          event={event}
                                          time={getSmartEventTime(event, currentTime())}
                                          showResponse={eventActions(event, eventOwner(event, card.id)?.email ?? '').rsvp}
                                        >
                                          <Show when={event.hangout_link && !meetingOver(event, minuteNow())}>
                                            <button
                                              class="calendar-join-btn"
                                              onClick={(e) => { e.stopPropagation(); event.hangout_link && openUrl(event.hangout_link); }}
                                            >
                                              Join meeting
                                            </button>
                                          </Show>
                                        </EventRowLines>
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
                                          <Show when={(isHoveredEvent(rowKey(card.id, event.id)) && eventActionsWheelOpen()) || (isEventFocused(card.id, event.id) && inputMode() === "keyboard")}>
                                            <ActionsWheel
                                              cardId={card.id}
                                              event={event}
                                              selectedCount={selectedEvents()[card.id]?.has(event.id) ? (selectedEvents()[card.id]?.size || 0) : 0}
                                              open={true}
                                              onClose={() => setEventActionsWheelOpen(false)}
                                              selectedAccount={() => eventOwner(event, card.id)}
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
                                              onDeleteEvent={(ev, anchor) => deleteEvent(ev, undefined, anchor, card.id)}
                                              onRsvped={(eventId, status) => markEventRsvp(eventId, status, eventOwner(event, card.id))}
                                              showToast={showToast}
                                              showFailure={showFailure}
                                            />
                                          </Show>
                                        </div>
                                      </div>
                                      {/* Event Quick Reply */}
                                      <Show when={isQuickReplyEvent(event.id)}>
                                        <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                          <ComposeTextarea
                                            class="quick-reply-input"
                                            placeholder={`Reply to ${eventReplyRecipients(event, eventOwner(event, card.id)?.email ?? '').to || 'organizer'}...`}
                                            value={quickReply().text}
                                            onChange={(val: string) => setQuickReply(qr => ({ ...qr, text: val }))}
                                            onSend={() => handleEventQuickReply(event)}
                                            onCancel={() => { setQuickReplyEventId(null); setQuickReply(qr => ({ ...qr, text: "" })); }}
                                            disabled={quickReply().sending}
                                            autofocus
                                          />
                                          <FormFooter>
                                            <CancelButton onClick={() => { setQuickReplyEventId(null); setQuickReply(qr => ({ ...qr, text: "" })); }} />
                                            <SubmitButton label="Send" busy={quickReply().sending} busyLabel="Sending..." disabled={!quickReply().text.trim()} onClick={() => handleEventQuickReply(event)} />
                                          </FormFooter>
                                        </div>
                                      </Show>
                                      </>
                                    )}
                                  </For>
                                  <Show when={gutterAbove(group().events.length)}>
                                    {(gutter) => <CalendarGutter gutter={gutter()} now={minuteNow()} />}
                                  </Show>
                                </>
                                );
                              }}
                            </Index>
                          </Show>

                          {/* Email card: show threads */}
                          <Show when={effectiveCardType(card) !== "calendar" && (isPreviewingQuery(card.id) || cardThreads[card.id])}>
                            <Show when={getDisplayGroups(card.id).length === 0 && !(isPreviewingQuery(card.id) && (queryPreviewLoading() || queryPreviewError()))}>
                              <CardEmpty cardId={card.id} name={card.name} query={isPreviewingQuery(card.id) ? editCardQuery() : card.query} kind="mail" noMatch={noMatchFor(card.id)} ledger={postmarks} />
                            </Show>
                            <Index each={getDisplayGroups(card.id)}>
                              {(group) => (
                                <>
                                  <Show when={isNowGroup(group())} fallback={<div class="date-header">{threadGroupLabel(group().label)}</div>}>
                                    <div class="date-header invite-now-header"><span class="invite-live-dot" aria-hidden="true" />Now</div>
                                  </Show>
                                  <For each={group().threads}>
                                    {(thread) => {
                                      // An event that is over needs no answer
                                      const owner = () => accountById(threadAccountId(thread, card));
                                      createEffect(() => {
                                        const invite = thread.calendar_event;
                                        const account = owner();
                                        if (!account || invite?.method !== "REQUEST" || !invite.uid) return;
                                        if ((invite.end_time ?? invite.start_time) < Date.now()) return;
                                        rsvpLookups.request(account.id, invite.uid);
                                        if (invite.all_day || inviteState(invite, inviteRsvp(account, invite.uid), minuteNow()) !== "unanswered") return;
                                        inviteDayLookups.request(account.id, inviteEnd(invite));
                                      });
                                      const live = () => isNowGroup(group());
                                      const inviteStrip = createMemo(() => {
                                        const invite = thread.calendar_event;
                                        const known = inviteDays[owner()?.id ?? ""];
                                        if (!invite || invite.all_day || !known || known.until < inviteEnd(invite)) return null;
                                        const slot = { start: invite.start_time, end: inviteEnd(invite) };
                                        return stripLayout(slot, dayOtherEvents(known.events, { ...slot, uid: invite.uid }), minuteNow());
                                      });
                                      const inviteLabel = () => {
                                        const invite = thread.calendar_event;
                                        if (!invite) return "";
                                        const rsvp = inviteRsvp(owner(), invite.uid);
                                        const clashes = inviteState(invite, rsvp, minuteNow()) === "unanswered" ? inviteStrip()?.clashes : undefined;
                                        return `. ${inviteSummary(invite, new Date(minuteNow()), { rsvp, clashes })}`;
                                      };
                                      return (
                                      <>
                                        <div
                                          class={`thread ${fadedBySearch(card.id, thread.gmail_thread_id) ? 'faded' : ''} ${thread.unread_count > 0 ? 'unread' : ''} ${selectedThreads()[card.id]?.has(thread.gmail_thread_id) ? 'selected' : ''} ${isThreadFocused(card.id, thread.gmail_thread_id) ? 'focused' : ''} ${isQuickReplyThread(thread.gmail_thread_id) ? 'replying' : ''}${thread.calendar_event ? ' invite' : ''}${live() ? ' live' : ''}${inviteIsOver(thread.calendar_event, owner()) ? ' invite-over' : ''}`}
                                          onMouseEnter={(e) => showThreadHoverActions(card.id, thread.gmail_thread_id, e)}
                                          onMouseLeave={(e) => hideThreadHoverActions(card.id, thread.gmail_thread_id, e)}
                                          onClick={(e) => {
                                            // The answer button is a control of its own, not a way into the thread
                                            if ((e.target as Element).closest(".invite-answer")) return;
                                            openThread(thread.gmail_thread_id, card.id);
                                          }}
                                          role="article"
                                          aria-label={`${thread.unread_count > 0 ? 'Unread: ' : ''}${thread.subject} from ${thread.participants.slice(0, 2).map(personName).join(', ')}${inviteLabel()}`}
                                          tabindex={rowTabIndex(card.id, thread.gmail_thread_id)}
                                          onFocus={() => onRowFocus(card.id, thread.gmail_thread_id)}
                                        >
                                          {(() => {
                                            const attachments = () => visibleAttachments(thread.attachments ?? [], { hideCalendar: !!thread.calendar_event });
                                            return (
                                              <ThreadRowLines
                                                thread={thread}
                                                ownEmails={accounts().map(a => a.email)}
                                                time={threadTime(thread.last_message_date, group().label)}
                                                subject={thread.calendar_event ? inviteTitle(thread.subject) : undefined}
                                                attachmentsShown={attachments().length > 0}
                                                beforeTime={
                                                  <Show when={isDraftThread(thread)}>
                                                    <button
                                                      class="thread-draft-discard"
                                                      aria-label="Discard draft"
                                                      onClick={(e) => { e.stopPropagation(); discardDraftRow(thread.gmail_thread_id, card.id); }}
                                                      on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                                                    >Discard</button>
                                                  </Show>
                                                }
                                                invite={thread.calendar_event ? (
                                                  <InviteRowLines
                                                    invite={thread.calendar_event}
                                                    rsvp={inviteRsvp(owner(), thread.calendar_event.uid)}
                                                    now={minuteNow()}
                                                    disabled={rsvpLoading[thread.gmail_thread_id]}
                                                    showKeys={isThreadFocused(card.id, thread.gmail_thread_id)}
                                                    strip={inviteStrip()}
                                                    live={live()}
                                                    onAnswer={(status) => handleRsvp(owner(), thread.gmail_thread_id, thread.calendar_event!.uid, status)}
                                                  />
                                                ) : undefined}
                                                attachments={
                                                  <Show when={attachments().length > 0}>
                                                    <AttachmentList
                                                      attachments={attachments()}
                                                      onOpen={(attachment) => openCardAttachment(owner()?.id ?? "", attachments(), attachment)}
                                                      onMenu={(attachment) => showAttachmentContextMenu({ accountId: owner()?.id ?? "", messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data })}
                                                      loadPreview={(attachment) => thumbnails.preview(owner()?.id ?? "", attachment.message_id, attachment.attachment_id)}
                                                    />
                                                  </Show>
                                                }
                                              />
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
                                            <Show when={(isHoveredThread(rowKey(card.id, thread.gmail_thread_id)) && actionsWheelOpen()) || (isThreadFocused(card.id, thread.gmail_thread_id) && inputMode() === "keyboard")}>
                                              <ActionsWheel
                                                cardId={card.id}
                                                threadId={thread.gmail_thread_id}
                                                thread={thread}
                                                selectedCount={selectedThreads()[card.id]?.has(thread.gmail_thread_id) ? (selectedThreads()[card.id]?.size || 0) : 0}
                                                open={true}
                                                onClose={() => setActionsWheelOpen(false)}
                                                selectedAccount={owner}
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
                                                showFailure={showFailure}
                                              />
                                            </Show>
                                          </div>
                                        </div>
                                        <Show when={isQuickReplyThread(thread.gmail_thread_id)}>
                                          <div class="quick-reply-box" onClick={(e) => e.stopPropagation()}>
                                            <Show when={lastLetterLine(thread.last_message_date ? new Date(thread.last_message_date) : null, new Date())}>
                                              {(line) => <p class="compose-last-letter">{line()}</p>}
                                            </Show>
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
                                            <FormFooter
                                              leading={
                                                <ReactionButton
                                                  onSelect={(emoji) => handleQuickReaction(thread.gmail_thread_id, emoji)}
                                                  sending={quickReactionSending()}
                                                />
                                              }
                                            >
                                              <CancelButton onClick={() => setQuickReply({ threadId: null, text: "", sending: false })} />
                                              <SubmitButton label="Send" busy={quickReply().sending} busyLabel="Sending..." disabled={!quickReply().text.trim()} onClick={handleQuickReply} />
                                            </FormFooter>
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
                              <StatusLine kind="loading">Loading more...</StatusLine>
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
                    suggestQuery={suggestQuery}
                    contacts={rankedContacts()}
                    labelNames={userLabelNames()}
                    debounceQueryPreview={debounceQueryPreview}
                    onQueryFieldActive={(insert) => { insertIntoQueryField = insert; }}
                    accounts={accounts()}
                    accountId={newCardAccountId() ?? selectedAccount()?.id}
                    setAccountId={(id) => { setNewCardAccountId(id); if (newCardQuery().trim()) debounceQueryPreview(newCardQuery()); }}
                  />
                  {/* Query preview for new card */}
                  <div class="card-body">
                    <Show when={queryPreviewLoading()}>
                      <StatusLine kind="loading">Searching...</StatusLine>
                    </Show>
                    <Show when={!queryPreviewLoading() && queryPreviewError()}>
                      <StatusLine kind="error">{queryPreviewError()}</StatusLine>
                    </Show>
                    {/* Calendar events preview */}
                    <Show when={!queryPreviewLoading() && cardTypeForQuery(newCardQuery()) === "calendar"}>
                      <Show when={queryPreviewCalendarEvents().length === 0 && !queryPreviewError()}>
                        <StatusLine kind="empty">No events</StatusLine>
                      </Show>
                      <For each={groupCalendarEvents(queryPreviewCalendarEvents().slice(0, NEW_CARD_PREVIEW_EVENTS), newCardGroupBy())}>
                        {(group) => (
                          <>
                            <div class="date-header">{group.label}</div>
                            <For each={group.events}>
                              {(event) => (
                                <div class={`calendar-event-item ${event.response_status === "declined" ? "declined" : ""}`}>
                                  <EventRowLines event={event} time={getSmartEventTime(event, currentTime())} showResponse />
                                </div>
                              )}
                            </For>
                          </>
                        )}
                      </For>
                      <Show when={queryPreviewCalendarEvents().length > NEW_CARD_PREVIEW_EVENTS}>
                        <StatusLine kind="empty">+{queryPreviewCalendarEvents().length - NEW_CARD_PREVIEW_EVENTS} more</StatusLine>
                      </Show>
                    </Show>
                    {/* Email threads preview */}
                    <Show when={!queryPreviewLoading() && !queryPreviewError() && queryPreviewThreads().length === 0 && newCardQuery().trim() && cardTypeForQuery(newCardQuery()) !== "calendar"}>
                      <StatusLine kind="empty">No matches</StatusLine>
                    </Show>
                    <Show when={!queryPreviewLoading() && queryPreviewThreads().length > 0}>
                      <For each={regroupThreads(queryPreviewThreads(), newCardGroupBy(), cardLabelNames(undefined))}>
                        {(group) => (
                          <>
                            <div class="date-header">{group.label}</div>
                            <For each={group.threads}>
                              {(thread) => (
                                <div class="thread" classList={{ "unread": thread.unread_count > 0 }}>
                                  <ThreadRowLines
                                    thread={thread}
                                    ownEmails={accounts().map(a => a.email)}
                                    time={threadTime(thread.last_message_date, group.label)}
                                    attachmentsShown={visibleAttachments(thread.attachments ?? [], { hideCalendar: !!thread.calendar_event }).length > 0}
                                    attachments={
                                      <Show when={(thread.attachments ?? []).length > 0}>
                                        <AttachmentList
                                          attachments={visibleAttachments(thread.attachments ?? [], { hideCalendar: !!thread.calendar_event })}
                                          onOpen={(attachment) => openCardAttachment(thread.account_id, visibleAttachments(thread.attachments ?? [], { hideCalendar: !!thread.calendar_event }), attachment)}
                                          onMenu={(attachment) => showAttachmentContextMenu({ accountId: thread.account_id, messageId: attachment.message_id, attachmentId: attachment.attachment_id, filename: attachment.filename, mimeType: attachment.mime_type, inlineData: attachment.inline_data })}
                                          loadPreview={(attachment) => thumbnails.preview(thread.account_id, attachment.message_id, attachment.attachment_id)}
                                        />
                                      </Show>
                                    }
                                  />
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

            <Show when={cards().length === 0 && !addingCard() && !authLoading() && !showPresetSelection()}>
              <EmptyBoard
                onAddCard={addStarterCard}
                onBrowsePresets={openPresetPicker}
                onSearchOperators={() => setQueryHelpOpen(true)}
              />
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
            setTo={(v) => { setComposeTo(v); setComposeEmailError(null); }}
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
            onAddFiles={addComposeFiles}
            fileInputId="compose-file-input"
            error={composeEmailError()}
            draftSaving={drafts.saving()}
            draftSaved={drafts.saved()}
            onSend={handleSendEmail}
            onClose={closeCompose}
            onInput={handleComposeInput}
            focusBody={focusComposeBody()}
            suggestContacts={suggestContacts}
            fromAccounts={composeIsReply() ? undefined : accounts()}
            fromAccountId={composeAccount()?.id}
            setFromAccountId={changeComposeAccount}
            fromEmail={composeIsReply() ? composeFromEmail() : undefined}
            lastLetter={replyingToThread() ? lastLetterLine(threadLastDate(replyingToThread()!.threadId), new Date()) : null}
          />
        </div>
      </Show>

      {/* Create Event Panel */}
      <Show when={creatingEvent()}>
        <CreateEventForm
          closing={eventForm().closing}
          onClose={dismissEventForm}
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
          calendars={calendarsFor(eventFormAccount()?.id)}
          calendarId={newEventCalendarId()}
          accountEmail={eventFormAccount()?.email}
          dayBusy={eventFormDayBusy()}
          now={minuteNow()}
          guestSuggestions={guestSuggestions}
          addMeet={eventForm().addMeet}
          setAddMeet={(v: boolean) => setEventForm(f => ({ ...f, addMeet: v }))}
          setCalendarId={(id: string) => setEventForm(f => ({ ...f, calendarId: id }))}
          saving={eventForm().saving}
          onSave={handleCreateEvent}
          error={eventForm().error}
        />
      </Show>

      {/* Preset selection modal */}
      <Show when={showPresetSelection()}>
        <PresetPicker
          presets={PRESETS}
          onPick={applyPreset}
          onDismiss={() => setShowPresetSelection(false)}
        />
      </Show>

      {/* Thread View Overlay */}
      <Show when={activeThreadId()}>
        <ThreadView
          thread={activeThread()}
          geminiKeySaved={geminiKeySaved()}
          onOpenSmartReplySettings={() => { setSmartRepliesOpen(true); setSettingsOpen(true); }}
          accountId={activeThreadAccountId() || ''}
          currentUserEmail={activeThreadAccount()?.email}
          onError={showFailure}
          loading={threadLoading()}
          error={threadError()}
          onRetry={() => {
            const threadId = activeThreadId();
            const cardId = activeThreadCardId();
            if (threadId && cardId) openThread(threadId, cardId);
          }}
          card={activeThreadCardId() ? (() => {
            const c = cards().find(c => c.id === activeThreadCardId());
            return c ? { name: c.name, color: (c.color as CardColor) || null } : null;
          })() : null}
          onClose={() => { if (composeShownIn() === "thread") closeCompose(); closeThreadView(); restoreOpenedRowFocus(); }}
          focusedMessageIndex={focusedMessageIndex()}
          onFocusChange={setFocusedMessageIndex}
          onOpenAttachment={(messageId, attachmentId, filename, mimeType, inlineData) => openAttachment(activeThreadAccountId() ?? "", messageId, attachmentId, filename, mimeType, inlineData)}
          onDownloadAttachment={(messageId, attachmentId, filename, mimeType, inlineData) => downloadAttachment(activeThreadAccountId() ?? "", messageId, attachmentId, filename, mimeType, inlineData)}
          onShowAttachmentMenu={(att) => showAttachmentContextMenu({ ...att, accountId: activeThreadAccountId() ?? "" })}
          onPreviewAttachments={(items, index) => setAttachmentPreview({ accountId: activeThreadAccountId() ?? "", items, index })}
          onReply={handleReplyFromThread}
          onForward={handleForwardFromThread}
          onUnsubscribe={unsubscribeFromList}
          position={activeThreadPosition()}
          onStepThread={stepActiveThread}
          onAction={handleThreadViewAction}
          onOpenLabels={() => { fetchAccountLabels(activeThreadAccountId() ?? undefined, { refresh: true }); setLabelDrawerOpen(true); }}
          keysPaused={creatingEvent()}
          onCreateEvent={() => {
            const messages = activeThread()?.messages ?? [];
            const people = messages
              .flatMap(m => m.payload?.headers ?? [])
              .filter(h => /^(from|to|cc)$/i.test(h.name))
              .flatMap(h => splitEmailList(h.value));
            const subject = activeListedThread()?.subject ?? findHeader(messages[0]?.payload?.headers, 'Subject') ?? '';
            openNewEventForm(eventFromThread(subject, people, activeThreadAccount()?.email ?? ''));
          }}
          labelDrawerOpen={labelDrawerOpen()}
          onCloseLabelDrawer={closeLabelDrawer}
          isStarred={isThreadStarred()}
          isRead={isThreadRead()}
          isImportant={isThreadImportant()}
          isInInbox={isThreadInInbox()}
          labelCount={getThreadUserLabelCount()}
          // Inline compose props
          inlineCompose={composeShownIn() === "thread" ? threadInlineCompose : null}
          threadAttachments={activeListedThread()?.attachments}
          loadAttachmentPreview={(attachment) => thumbnails.preview(activeThreadAccount()?.id ?? "", attachment.message_id, attachment.attachment_id)}
          invite={(() => {
            const listed = activeListedThread();
            const event = listed?.calendar_event;
            if (!listed || !event) return null;
            return {
              event,
              rsvp: inviteRsvp(activeThreadAccount(), event.uid),
              onAnswer: (status: RsvpStatus) => handleRsvp(activeThreadAccount(), listed.gmail_thread_id, event.uid, status),
              disabled: !!rsvpLoading[listed.gmail_thread_id],
              strip: openedInviteStrip(),
            };
          })()}
          cidAttachmentData={cidAttachmentData()}
        />

        {/* Label Drawer */}
        <Show when={labelDrawerOpen()}>
          <Sheet
            title="Labels"
            placement="side"
            class="label-drawer"
            onClose={closeLabelDrawer}
            closesFromInputs
            initialFocus={(el) => el.querySelector<HTMLElement>(".label-drawer-search input")}
          >
            <div class="label-drawer-search">
              <input
                type="text"
                placeholder="Search labels..."
                value={labelSearchQuery()}
                onInput={(e) => setLabelSearchQuery(e.currentTarget.value)}
                autofocus
              />
            </div>

            <div class="label-drawer-body">
              <Show when={labelsLoading()}>
                <StatusLine kind="loading">Loading labels...</StatusLine>
              </Show>

              <Show when={!labelsLoading()}>
                <For each={filteredLabels()}>
                  {(label) => {
                    const isApplied = () => getCurrentThreadLabels().includes(label.id);
                    const isSystem = () => label.label_type !== 'user';

                    return (
                      <label class={`label-item ${isSystem() ? 'system-label' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isApplied()}
                          onChange={() => handleToggleLabel(label.id, labelDisplayName(label), !isApplied())}
                        />
                        <span class="label-name">{labelDisplayName(label)}</span>
                        <Show when={isSystem()}>
                          <span class="label-badge">System</span>
                        </Show>
                      </label>
                    );
                  }}
                </For>

                <Show when={labelsFailed()}>
                  <StatusLine kind="error">
                    Couldn't load labels.{" "}
                    <button class="retry-btn" onClick={() => fetchAccountLabels(activeThreadAccountId() ?? undefined)}>Try again</button>
                  </StatusLine>
                </Show>
                <Show when={!labelsLoading() && !labelsFailed() && filteredLabels().length === 0}>
                  <StatusLine kind="empty">No labels found</StatusLine>
                </Show>
              </Show>
            </div>

          </Sheet>
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
          onClose={() => { closeEvent(); restoreOpenedRowFocus(); }}
          onRsvp={(status) => { const event = activeEvent(); if (event) answerListedEvent(event, status, activeEventCardId()); }}
          onReplyOrganizer={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = addReplyPrefix(event.title);
            const { to } = eventReplyRecipients(event, activeEventAccount()?.email ?? '');
            startCompose({ to, subject, focusBody: true, replyEvent: { eventId: event.id }, accountId: activeEventAccountId() ?? undefined });
          }}
          onReplyAll={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = addReplyPrefix(event.title);
            const { to, cc } = eventReplyRecipients(event, activeEventAccount()?.email ?? '', true);
            startCompose({ to, cc, subject, focusBody: true, replyEvent: { eventId: event.id }, accountId: activeEventAccountId() ?? undefined });
          }}
          onForward={() => {
            const event = activeEvent();
            if (!event) return;
            const subject = addForwardPrefix(event.title);
            const body = `---------- Forwarded event ----------\n` +
              `Title: ${event.title}\n` +
              `When: ${formatWhen(new Date(event.start_time), new Date())}\n` +
              (event.location ? `Where: ${event.location}\n` : '') +
              (event.organizer ? `Organizer: ${event.organizer}\n` : '') +
              (event.description ? `\n${event.description}` : '');
            startCompose({ subject, body, focusBody: true, forwardEvent: { eventId: event.id }, accountId: activeEventAccountId() ?? undefined });
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
              addMeet: false,
              editing: { id: event.id, calendarId: event.calendar_id, accountId: activeEventAccountId() ?? "" },
            }));
          }}
          onDelete={(scope) => { const event = activeEvent(); if (event) deleteEvent(event, scope, undefined, activeEventCardId()); }}
          onOpenCalendars={() => { fetchAvailableCalendars(activeEventAccountId() ?? undefined); setCalendarDrawerOpen(true); }}
          calendarDrawerOpen={calendarDrawerOpen()}
          onCloseCalendarDrawer={() => setCalendarDrawerOpen(false)}
          accountEmail={activeEventAccount()?.email ?? ""}
          nameForEmail={(email) => nameInThreads(email, Object.values(cardThreads).flatMap(groups => groups.flatMap(g => g.threads)))}
          calendars={calendarsFor(activeEventAccountId() ?? undefined)}
          calendarsLoading={!!calendarsLoading[activeEventAccountId() ?? ""]}
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
            askScope: !!activeEvent()!.recurring_event_id,
            guestSuggestions,
            addMeet: eventForm().addMeet,
            setAddMeet: (v: boolean) => setEventForm(f => ({ ...f, addMeet: v })),
            hasMeet: !!activeEvent()!.hangout_link,
            saving: eventForm().saving,
            onSave: handleCreateEvent,
            onClose: () => setEventForm(defaultEventForm()),
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
              <CloseButton onClick={dismissBatchReply} />
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
              <StatusLine kind="loading" size="block">
                <div class="loading-spinner"></div>
                Loading threads...
              </StatusLine>
            </Show>
            <Show when={!batchReplyLoading() && batchReplyError()}>
              {(failed) => (
                <StatusLine kind="error" size="block">
                  {failed().message}{" "}
                  <button class="retry-btn" onClick={() => startBatchReply(batchReplyCardId() ?? "", failed().threadIds)}>Try again</button>
                </StatusLine>
              )}
            </Show>
            <Show when={!batchReplyLoading() && !batchReplyError() && batchReplyThreads().length === 0}>
              <StatusLine kind="empty" size="block">No threads to reply to</StatusLine>
            </Show>
            <div class="messages-list">
              <For each={batchReplyThreads()}>
                {(thread) => (
                  <div class={`message-row with-compose ${inlineResizing() ? 'resizing' : ''}`}>
                    <div class="message-card">
                      <div class="message-header">
                        <MessageSender from={thread.from} />
                        <div class="message-header-actions">
                          <div class="message-date">{thread.date}</div>
                        </div>
                      </div>
                      <div class="batch-reply-subject">{thread.subject}</div>
                      <MessageBody
                        body={thread.body}
                        msgId={thread.messageId}
                        msgPayloadParts={thread.parts}
                        cidAttachmentData={batchReplyCidData()[thread.threadId]}
                        forward={isForwardSubject(thread.subject)}
                      />
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
                        onAddFiles={(files) => addBatchReplyFiles(thread.threadId, files)}
                        fileInputId={`batch-reply-file-input-${thread.threadId}`}
                        onSend={() => sendBatchReply(thread.threadId)}
                        onClose={dismissBatchReply}
                        onSkip={() => discardBatchReplyThread(thread.threadId)}
                        canSend={!!batchReplyMessages()[thread.threadId]?.trim()}
                        focusBody={batchReplyThreads()[0]?.threadId === thread.threadId}
                        lastLetter={lastLetterLine(thread.lastDate, new Date())}
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={queryHelpOpen()}>
        <QueryHelpSheet onClose={() => setQueryHelpOpen(false)} onInsert={(text) => insertIntoQueryField?.(text)} />
      </Show>

      {/* Settings sidebar */}
      <div class={`settings-overlay ${settingsOpen() ? 'open' : ''}`} onClick={() => setSettingsOpen(false)} aria-hidden="true"></div>
      <div
        ref={settingsSidebarRef}
        class={`settings-sidebar ${settingsOpen() ? 'open' : ''}`}
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        aria-hidden={settingsOpen() ? undefined : "true"}
      >
        <div class="panel-header settings-header" data-size="sheet">
          <h2 class="sheet-title">Settings</h2>
          <button class="close-btn" onClick={() => setSettingsOpen(false)} title="Close (Esc)" aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div class="settings-body">
          <Show when={selectedAccount()}>
            {(account) => (
              <SettingsGroup name={account().email} hint="The signature is added to everything you send from this account.">
                <SettingsRow label={<span class="settings-account"><Avatar email={account().email} size="xs" /><span class="settings-account-email">{account().email}</span></span>}>
                  <button class="settings-btn" onClick={handleSignOut}>Sign out</button>
                </SettingsRow>
                <SettingsRow label="Signature" for="settings-signature" stacked>
                  <textarea
                    id="settings-signature"
                    aria-label="Signature"
                    rows={3}
                    placeholder="None"
                    value={account().signature ?? ""}
                    onChange={(e) => saveSignature(account(), e.currentTarget.value)}
                  />
                </SettingsRow>
                <SettingsRow label="Layout">
                  <button class="settings-btn" aria-label="Choose a different layout" onClick={() => { setSettingsOpen(false); openPresetPicker(); }}>
                    Choose…
                  </button>
                </SettingsRow>
                <Show when={previousLayout()}>
                  {(snapshot) => (
                    <SettingsRow
                      label={<>Previous layout <span class="settings-row-meta">{snapshot().cards.length} card{snapshot().cards.length === 1 ? "" : "s"} · replaced {formatSyncTime(snapshot().savedAt, currentTime())}</span></>}
                    >
                      <button class="settings-btn" aria-label="Restore previous layout" onClick={restorePreviousLayout}>Restore</button>
                    </SettingsRow>
                  )}
                </Show>
              </SettingsGroup>
            )}
          </Show>
          <AfterArchiveSetting />
          <SmartRepliesSettings
            open={smartRepliesOpen()}
            onToggle={() => setSmartRepliesOpen(!smartRepliesOpen())}
            keySaved={geminiKeySaved()}
            draft={geminiKeyDraft()}
            onDraft={setGeminiKeyDraft}
            onSave={saveGeminiApiKey}
          />
          <SettingsGroup heading="Advanced">
            <Show
              when={storedClientId()}
              fallback={<SettingsRow label="Google client"><span class="settings-row-meta">Not set up</span></SettingsRow>}
            >
              <SettingsRow label="Google client">
                <span class="settings-row-meta">Connected <CheckIcon size="meta" /></span>
                <button class="settings-btn" aria-label="Change credentials" aria-expanded={googleFormOpen()} onClick={() => setGoogleFormOpen(!googleFormOpen())}>
                  Change…
                </button>
              </SettingsRow>
            </Show>
            <Show when={storedClientId() ? googleFormOpen() : accounts().length > 0}>
              <div class="settings-row stacked">
                <GoogleCredentialsForm
                  idPrefix="settings"
                  clientId={clientId()}
                  clientSecret={clientSecret()}
                  onClientId={setClientId}
                  onClientSecret={setClientSecret}
                  onSubmit={handleSaveSettings}
                  onEscape={() => setSettingsOpen(false)}
                  showPortHint={signInFailed()}
                />
                <button
                  class="btn btn-primary"
                  onClick={handleSaveSettings}
                  disabled={!credentialsValid(clientId(), clientSecret())}
                >
                  Save and sign in <KeyHint keys="↵" />
                </button>
              </div>
            </Show>
            <Show when={icloudStatus() && icloudStatusText(icloudStatus()!)}>
              {(text) => (
                <SettingsRow label="iCloud sync">
                  <span class="settings-row-meta" classList={{ danger: !!icloudStatus()?.last_error }}>{text()}</span>
                </SettingsRow>
              )}
            </Show>
          </SettingsGroup>
        </div>
      </div>

      {/* Keyboard shortcuts help modal */}
      <Show when={shortcutsHelpOpen()}>
        <Sheet
          title="Keyboard Shortcuts"
          placement="center"
          class="shortcuts-modal"
          onClose={() => setShortcutsHelpOpen(false)}
          initialFocus={(el) => el.querySelector<HTMLElement>(".shortcuts-body")}
        >
          <div class="shortcuts-body" tabindex="0">
            <div class="shortcuts-section">
              <h3>Navigation</h3>
              <div class="shortcut-row"><KeyHint keys="j" look="key" /> <span>Next thread</span></div>
              <div class="shortcut-row"><KeyHint keys="k" look="key" /> <span>Previous thread</span></div>
              <div class="shortcut-row"><KeyHint keys="h" look="key" /> <span>Previous card</span></div>
              <div class="shortcut-row"><KeyHint keys="l" look="key" /> <span>Next card</span></div>
              <div class="shortcut-row"><KeyHint keys="Enter" look="key" /> <span>Open thread or event</span></div>
              <div class="shortcut-row"><KeyHint keys="Escape" look="key" /> <span>Close / Go back</span></div>
              <div class="shortcut-row"><KeyHint keys="/" look="key" /> <span>Search</span></div>
              <div class="shortcut-row"><KeyHint keys="⌘F" look="key" /> <span>Search</span></div>
              <div class="shortcut-row"><KeyHint keys="p" look="key" /> <span>Keep the search as a card</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Actions</h3>
              <div class="shortcut-row"><KeyHint keys="a" look="key" /> <span>Archive thread</span></div>
              <div class="shortcut-row"><KeyHint keys="s" look="key" /> <span>Star thread</span></div>
              <div class="shortcut-row"><KeyHint keys="d" look="key" /> <span>Delete thread</span></div>
              <div class="shortcut-row"><KeyHint keys="#" look="key" /> <span>Delete thread</span></div>
              <div class="shortcut-row"><KeyHint keys="r" look="key" /> <span>Reply to thread</span></div>
              <div class="shortcut-row"><KeyHint keys="f" look="key" /> <span>Forward thread</span></div>
              <div class="shortcut-row"><KeyHint keys="u" look="key" /> <span>Toggle read</span></div>
              <div class="shortcut-row"><KeyHint keys="i" look="key" /> <span>Toggle important</span></div>
              <div class="shortcut-row"><KeyHint keys="!" look="key" /> <span>Report spam</span></div>
              <div class="shortcut-row"><KeyHint keys="y ⇧M n" look="key" /> <span>Answer a focused invite: Going, Maybe, Not going</span></div>
              <div class="shortcut-row"><KeyHint keys="z" look="key" /> <span>Undo last action</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Open thread</h3>
              <div class="shortcut-row"><KeyHint keys="j" look="key" /> <span>Next message</span></div>
              <div class="shortcut-row"><KeyHint keys="k" look="key" /> <span>Previous message</span></div>
              <div class="shortcut-row"><KeyHint keys="]" look="key" /> <span>Next thread in the card (or ⇧J)</span></div>
              <div class="shortcut-row"><KeyHint keys="[" look="key" /> <span>Previous thread in the card (or ⇧K)</span></div>
              <div class="shortcut-row"><KeyHint keys="r" look="key" /> <span>Reply to message</span></div>
              <div class="shortcut-row"><KeyHint keys="⇧R" look="key" /> <span>Reply all</span></div>
              <div class="shortcut-row"><KeyHint keys="f" look="key" /> <span>Forward message</span></div>
              <div class="shortcut-row"><KeyHint keys="l" look="key" /> <span>Labels</span></div>
              <div class="shortcut-row"><KeyHint keys="e" look="key" /> <span>Create event from thread</span></div>
              <div class="shortcut-row"><KeyHint keys="a" look="key" /> <span>Archive</span></div>
              <div class="shortcut-row"><KeyHint keys="s" look="key" /> <span>Star</span></div>
              <div class="shortcut-row"><KeyHint keys="u" look="key" /> <span>Toggle read</span></div>
              <div class="shortcut-row"><KeyHint keys="i" look="key" /> <span>Toggle important</span></div>
              <div class="shortcut-row"><KeyHint keys="!" look="key" /> <span>Report spam</span></div>
              <div class="shortcut-row"><KeyHint keys="d" look="key" /> <span>Delete</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Open event</h3>
              <div class="shortcut-row"><KeyHint keys="r" look="key" /> <span>Reply to organizer</span></div>
              <div class="shortcut-row"><KeyHint keys="⇧R" look="key" /> <span>Reply all</span></div>
              <div class="shortcut-row"><KeyHint keys="f" look="key" /> <span>Forward</span></div>
              <div class="shortcut-row"><KeyHint keys="v" look="key" /> <span>Join meeting</span></div>
              <div class="shortcut-row"><KeyHint keys="o" look="key" /> <span>Open in Google Calendar</span></div>
              <div class="shortcut-row"><KeyHint keys="m" look="key" /> <span>Move to calendar</span></div>
              <div class="shortcut-row"><KeyHint keys="y" look="key" /> <span>Going</span></div>
              <div class="shortcut-row"><KeyHint keys="⇧M" look="key" /> <span>Maybe</span></div>
              <div class="shortcut-row"><KeyHint keys="n" look="key" /> <span>Not going</span></div>
              <div class="shortcut-row"><KeyHint keys="e" look="key" /> <span>Edit</span></div>
              <div class="shortcut-row"><KeyHint keys="d" look="key" /> <span>Delete</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Compose</h3>
              <div class="shortcut-row"><KeyHint keys="c" look="key" /> <span>New email</span></div>
              <div class="shortcut-row"><KeyHint keys="e" look="key" /> <span>New event</span></div>
              <div class="shortcut-row"><KeyHint keys="⌘Enter" look="key" /> <span>Send email</span></div>
              <div class="shortcut-row"><KeyHint keys="Escape" look="key" /> <span>Close compose</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Selection</h3>
              <div class="shortcut-row"><KeyHint keys="x" look="key" /> <span>Select thread or event</span></div>
              <div class="shortcut-row"><KeyHint keys="⇧J" look="key" /> <span>Extend selection down</span></div>
              <div class="shortcut-row"><KeyHint keys="⇧K" look="key" /> <span>Extend selection up</span></div>
              <div class="shortcut-row"><KeyHint keys="*a" look="key" /> <span>Select all in card</span></div>
              <div class="shortcut-row"><KeyHint keys="a s u i d !" look="key" /> <span>Act on the selection</span></div>
              <div class="shortcut-row"><KeyHint keys="r" look="key" /> <span>Batch reply to the selection</span></div>
              <div class="shortcut-row"><KeyHint keys="Escape" look="key" /> <span>Clear selection</span></div>
            </div>
            <div class="shortcuts-section">
              <h3>Help</h3>
              <div class="shortcut-row"><KeyHint keys="?" look="key" /> <span>Show this help</span></div>
            </div>
          </div>
        </Sheet>
      </Show>

      {/* Action config context menu */}
      <Show when={actionConfigMenu()}>
        {(() => {
          const isEvent = actionConfigMenu()?.isEvent;
          const order = isEvent ? eventActionOrder() : actionOrder();
          const settings = isEvent ? eventActionSettings() : actionSettings();
          const handlers = isEvent ? eventActionHandlers : threadActionHandlers;
          const labels: Record<string, string> = isEvent
            ? { quickReply: 'Reply', joinMeeting: 'Join Meeting', openCalendar: 'Open in Calendar', rsvpYes: 'Going', rsvpNo: 'Not going', delete: 'Delete' }
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

      <Toasts toasts={toasts} othersShowing={undoableSend.toastVisible()}>
        {/* Send Toast with Undo */}
        <Show when={undoableSend.toastVisible()}>
          <ToastFrame
            message={`${inAccount("Sending message", [accountById(undoableSend.pending()?.accountId)?.email ?? ""].filter(Boolean), accounts().length, "from")}...`}
            closing={undoableSend.toastClosing()}
            percent={undoableSend.progress()}
          >
            <Show when={undoableSend.pending()}>
              <button class="toast-undo-btn" onClick={undoSend}>Undo</button>
            </Show>
          </ToastFrame>
        </Show>
      </Toasts>

      <ConfirmDialog />
      <ScopePrompt />
      <Show when={attachmentPreview()}>
        {(preview) => (
          <AttachmentLightbox
            items={preview().items}
            index={preview().index}
            onIndexChange={(index) => setAttachmentPreview({ ...preview(), index })}
            onClose={() => setAttachmentPreview(null)}
            loadData={loadPreviewData}
            onDownload={(item) => downloadAttachment(preview().accountId, item.messageId, item.attachmentId, item.filename, item.mimeType, item.inlineData)}
            onOpenExternally={(item) => openAttachment(preview().accountId, item.messageId, item.attachmentId, item.filename, item.mimeType, item.inlineData)}
          />
        )}
      </Show>
    </div >
  );
}



export default App;
