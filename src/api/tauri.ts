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
  return invoke("run_oauth_flow");
}

export async function getAccounts(): Promise<Account[]> {
  return invoke("get_accounts");
}

export async function deleteAccount(id: string): Promise<void> {
  return invoke("delete_account", { id });
}

export async function getCards(accountId: string): Promise<Card[]> {
  return invoke("get_cards", { accountId });
}

export async function createCard(
  accountId: string,
  name: string,
  query: string
): Promise<Card> {
  return invoke("create_card", { accountId, name, query });
}

export async function updateCard(card: Card): Promise<void> {
  return invoke("update_card", { card });
}

export async function deleteCard(id: string): Promise<void> {
  return invoke("delete_card", { id });
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

export async function downloadAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  return invoke("download_attachment", { accountId, messageId, attachmentId });
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
