// Tauri command bindings

import { invoke } from "@tauri-apps/api/core";

export interface Account {
  id: string;
  email: string;
  picture: string | null;
}

export interface Card {
  id: string;
  account_id: string;
  name: string;
  query: string;
  position: number;
  collapsed: boolean;
  color: string | null;
  group_by: string;
  card_type: string; // "email" or "calendar"
}

export interface AuthConfig {
  client_id: string;
  client_secret: string;
}


export interface Attachment {
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  inline_data: string | null; // Base64-encoded data for small images
}

export interface CalendarEvent {
  uid: string | null;
  title: string;
  start_time: number; // Unix timestamp in milliseconds
  end_time: number | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: string[];
  method: string | null; // REQUEST, REPLY, CANCEL
  status: string | null; // CONFIRMED, TENTATIVE, CANCELLED
  response_status: string | null; // accepted, tentative, declined, needsAction
}

export interface Thread {
  gmail_thread_id: string;
  account_id: string;
  subject: string;
  snippet: string;
  last_message_date: number; // Unix timestamp in milliseconds
  unread_count: number;
  labels: string[];
  participants: string[];
  has_attachment: boolean;
  attachments: Attachment[];
  calendar_event: CalendarEvent | null;
}

export interface ThreadGroup {
  label: string;
  threads: Thread[];
}

export interface SearchResult {
  groups: ThreadGroup[];
  next_page_token: string | null;
  has_more: boolean;
}

export async function initApp(): Promise<void> {
  return invoke("init_app");
}

export async function configureAuth(config: AuthConfig): Promise<void> {
  return invoke("configure_auth", { config });
}

export interface StoredCredentials {
  client_id: string;
  client_secret: string;
}

export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  return invoke("get_stored_credentials");
}

export async function runOAuthFlow(): Promise<Account> {
  return await invoke('run_oauth_flow');
}

export async function completeOAuthFlow(code: string, state: string | null): Promise<Account> {
  return invoke("complete_oauth_flow", { code, receivedState: state });
}

export async function getAccounts(): Promise<Account[]> {
  return invoke("get_accounts");
}

export async function deleteAccount(id: string): Promise<void> {
  return invoke("delete_account", { accountId: id });
}

export async function getCards(accountId: string): Promise<Card[]> {
  return invoke("get_cards", { accountId });
}

export async function createCard(
  accountId: string,
  name: string,
  query: string,
  color?: string | null,
  groupBy?: string,
  cardType?: string
): Promise<Card> {
  return invoke("create_card", { accountId, name, query, color, groupBy, cardType });
}

export async function updateCard(card: Card): Promise<void> {
  return invoke("update_card", { card });
}

export async function deleteCard(id: string): Promise<void> {
  return invoke("delete_card", { id });
}

export async function reorderCards(orders: [string, number][]): Promise<void> {
  return invoke("reorder_cards", { orders });
}

export async function fetchThreads(
  accountId: string,
  cardId: string
): Promise<ThreadGroup[]> {
  return invoke("fetch_threads", { accountId, cardId });
}

export async function fetchThreadsPaginated(
  accountId: string,
  cardId: string,
  pageToken?: string | null
): Promise<SearchResult> {
  return invoke("fetch_threads_paginated", { accountId, cardId, pageToken });
}

export interface IncrementalSyncResult {
  modified_threads: Thread[];
  deleted_thread_ids: string[];
  new_history_id: string;
  is_full_sync: boolean;
}

export async function syncThreadsIncremental(
  accountId: string
): Promise<IncrementalSyncResult> {
  return invoke("sync_threads_incremental", { accountId });
}

export async function searchThreadsPreview(
  accountId: string,
  query: string
): Promise<ThreadGroup[]> {
  return invoke("search_threads_preview", { accountId, query });
}
export async function modifyThreads(
  accountId: string,
  threadIds: string[],
  addLabels: string[],
  removeLabels: string[]
): Promise<void> {
  return invoke("modify_threads", {
    accountId,
    threadIds,
    addLabels,
    removeLabels,
  });
}

export interface Header {
  name: string;
  value: string;
}

export interface MessageBody {
  size?: number;
  data?: string;
}

export interface MessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: MessageBody;
  parts?: MessagePart[];
}

export interface MessagePayload {
  headers?: Header[];
  body?: MessageBody;
  parts?: MessagePart[];
  mimeType?: string;
}

export interface FullMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: MessagePayload;
}

export interface FullThread {
  id: string;
  historyId?: string;
  messages: FullMessage[];
}

export async function getThreadDetails(
  accountId: string,
  threadId: string
): Promise<FullThread> {
  return invoke("get_thread_details", { accountId, threadId });
}

export interface SendAttachment {
  filename: string;
  mime_type: string;
  data: string; // Base64-encoded file data
}

export async function sendEmail(
  accountId: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  body: string,
  attachments: SendAttachment[] = []
): Promise<void> {
  return invoke("send_email", { accountId, to, cc, bcc, subject, body, attachments });
}

export async function replyToThread(
  accountId: string,
  threadId: string,
  to: string,
  cc: string,
  bcc: string,
  subject: string,
  body: string,
  messageId?: string,
  attachments: SendAttachment[] = []
): Promise<void> {
  return invoke("reply_to_thread", { accountId, threadId, to, cc, bcc, subject, body, messageId, attachments });
}

// Cache operations

export interface CachedCardThreads {
  groups: ThreadGroup[];
  next_page_token: string | null;
  cached_at: number;
}

export async function getCachedCardThreads(cardId: string): Promise<CachedCardThreads | null> {
  return invoke("get_cached_card_threads", { cardId });
}

export async function saveCachedCardThreads(
  cardId: string,
  groups: ThreadGroup[],
  nextPageToken: string | null
): Promise<void> {
  return invoke("save_cached_card_threads", { cardId, groups, nextPageToken });
}

export async function clearCardCache(cardId: string): Promise<void> {
  return invoke("clear_card_cache", { cardId });
}

export interface CachedCardEvents {
  events: GoogleCalendarEvent[];
  cached_at: number;
}

export async function getCachedCardEvents(cardId: string): Promise<CachedCardEvents | null> {
  return invoke("get_cached_card_events", { cardId });
}

export async function saveCachedCardEvents(
  cardId: string,
  events: GoogleCalendarEvent[]
): Promise<void> {
  return invoke("save_cached_card_events", { cardId, events });
}

export async function downloadAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  return invoke("download_attachment", { accountId, messageId, attachmentId });
}

export async function openAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string | null,
  filename: string,
  mimeType: string | null,
  inlineData: string | null
): Promise<void> {
  return invoke("open_attachment", { accountId, messageId, attachmentId, filename, mimeType, inlineData });
}

// Gmail Labels

export interface GmailLabel {
  id: string;
  name: string;
  message_list_visibility: string | null;
  label_list_visibility: string | null;
  label_type: string | null;
}

export async function listLabels(accountId: string): Promise<GmailLabel[]> {
  return invoke("list_labels", { accountId });
}

export async function rsvpCalendarEvent(
  accountId: string,
  eventUid: string,
  status: "accepted" | "tentative" | "declined"
): Promise<void> {
  return invoke("rsvp_calendar_event", { accountId, eventUid, status });
}

export async function getCalendarRsvpStatus(
  accountId: string,
  eventUid: string
): Promise<string | null> {
  return invoke("get_calendar_rsvp_status", { accountId, eventUid });
}

// iCloud sync

export async function pullFromICloud(): Promise<boolean> {
  return invoke("pull_from_icloud");
}

export async function forceICloudSync(): Promise<void> {
  return invoke("force_icloud_sync");
}

// People API (Contacts)

export interface Contact {
  resource_name: string;
  display_name: string | null;
  email_addresses: string[];
  photo_url: string | null;
}

export async function fetchContacts(accountId: string): Promise<Contact[]> {
  return invoke("fetch_contacts", { accountId });
}

export async function searchContacts(accountId: string, query: string): Promise<Contact[]> {
  return invoke("search_contacts", { accountId, query });
}

// Google Calendar API

export interface GoogleCalendarEventAttendee {
  email: string;
  display_name: string | null;
  response_status: string | null;
  is_self: boolean;
  is_organizer: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: number; // Unix timestamp in milliseconds
  end_time: number | null;
  all_day: boolean;
  status: string; // confirmed, tentative, cancelled
  organizer: string | null;
  attendees: GoogleCalendarEventAttendee[];
  html_link: string | null;
  hangout_link: string | null;
  response_status: string | null; // accepted, declined, tentative, needsAction
}

export interface CalendarInfo {
  id: string;
  name: string;
  is_primary: boolean;
}

export async function listCalendars(accountId: string): Promise<CalendarInfo[]> {
  return invoke("list_calendars", { accountId });
}

export async function fetchCalendarEvents(
  accountId: string,
  query: string
): Promise<GoogleCalendarEvent[]> {
  return invoke("fetch_calendar_events", { accountId, query });
}

export async function createCalendarEvent(
  accountId: string,
  calendarId: string | null,
  summary: string,
  description: string | null,
  location: string | null,
  startTime: number,
  endTime: number,
  allDay: boolean,
  attendees: string[] | null,
  recurrence: string[] | null
): Promise<GoogleCalendarEvent> {
  return invoke("create_calendar_event", {
    accountId,
    calendarId,
    summary,
    description,
    location,
    startTime: Math.round(startTime),
    endTime: Math.round(endTime),
    allDay,
    attendees,
    recurrence,
  });
}

export async function moveCalendarEvent(
  accountId: string,
  sourceCalendarId: string,
  eventId: string,
  destinationCalendarId: string
): Promise<GoogleCalendarEvent> {
  return invoke("move_calendar_event", {
    accountId,
    sourceCalendarId,
    eventId,
    destinationCalendarId,
  });
}

export async function suggestReplies(
  accountId: string,
  threadId: string,
  projectId: string
): Promise<string[]> {
  return invoke("suggest_replies", { accountId, threadId, projectId });
}
