import type { Account, Card, GoogleCalendarEvent, Thread, ThreadGroup } from "../api/tauri";

// A card's account_id is its scope: one local account, or this, for a card
// showing every signed-in account's mail or events
export const ALL_ACCOUNTS = "all";

export function cardCoversAccount(card: Pick<Card, "account_id">, accountId: string): boolean {
  return card.account_id === ALL_ACCOUNTS || card.account_id === accountId;
}

export function cardAccountIds(card: Pick<Card, "account_id">, accounts: Account[]): string[] {
  return card.account_id === ALL_ACCOUNTS ? accounts.map(a => a.id) : [card.account_id];
}

export function scopeLabel(card: Pick<Card, "account_id">, accounts: Account[]): string {
  if (card.account_id === ALL_ACCOUNTS) return "All inboxes";
  return accounts.find(a => a.id === card.account_id)?.email ?? "";
}

// The account a listed thread came from. Caches written before threads named
// their account say "", and belong to their card's account; "" when that
// can't tell either.
export function threadAccountId(thread: Pick<Thread, "account_id">, card: Pick<Card, "account_id"> | undefined): string {
  if (thread.account_id) return thread.account_id;
  return card && card.account_id !== ALL_ACCOUNTS ? card.account_id : "";
}

export function eventAccountId(event: Pick<GoogleCalendarEvent, "account_id">, card: Pick<Card, "account_id"> | undefined): string {
  return threadAccountId({ account_id: event.account_id ?? "" }, card);
}

// Thread ids are only unique within one mailbox
export function threadKey(thread: Pick<Thread, "account_id" | "gmail_thread_id">, card: Pick<Card, "account_id"> | undefined): string {
  return `${threadAccountId(thread, card)}:${thread.gmail_thread_id}`;
}

// `ids` of a card's threads, by the account each belongs to
export function threadIdsByAccount(groups: ThreadGroup[], ids: string[], card: Pick<Card, "account_id">): Map<string, string[]> {
  const owners = new Map<string, string>();
  for (const thread of groups.flatMap(g => g.threads)) {
    if (!owners.has(thread.gmail_thread_id)) owners.set(thread.gmail_thread_id, threadAccountId(thread, card));
  }
  const byAccount = new Map<string, string[]>();
  for (const id of ids) {
    const owner = owners.get(id) ?? threadAccountId({ account_id: "" }, card);
    const list = byAccount.get(owner) ?? [];
    if (!list.includes(id)) list.push(id);
    byAccount.set(owner, list);
  }
  return byAccount;
}

// The accounts some card shows, which a sync has to ask about
export function accountsToPoll(cards: Pick<Card, "account_id">[], accounts: Account[]): Account[] {
  return accounts.filter(a => cards.some(c => cardCoversAccount(c, a.id)));
}

// An all-inboxes fetch fails with the failing account's email first
export function accountFromError(error: unknown, accounts: Account[]): Account | null {
  const message = error instanceof Error ? error.message : String(error);
  return accounts.find(a => message.startsWith(`${a.email}: `)) ?? null;
}

// "Archived 1 thread in b@x.com"; with one account signed in there is no
// other it could be
export function inAccount(text: string, emails: string[], accountCount: number, preposition = "in"): string {
  if (accountCount <= 1 || emails.length === 0) return text;
  return emails.length === 1 ? `${text} ${preposition} ${emails[0]}` : `${text} ${preposition} ${emails.length} accounts`;
}
