import type { Contact } from "../api/tauri";
import { parseContact } from "../utils";

export interface RecentContact {
  email: string;
  name?: string;
  lastContacted: number;
  frequency: number;
  fromGoogle: boolean;
}

const DAY_MS = 1000 * 60 * 60 * 24;

// Everyone the user could write to: Google contacts plus the participants of
// loaded threads, best first. Frequent and recent correspondents rank high;
// a Google contact never seen in a thread gets a small boost over nothing.
export function rankContacts(
  googleContacts: Contact[],
  threads: { participants: string[]; last_message_date: number }[],
  accountEmail: string | undefined,
  now: number,
): RecentContact[] {
  const self = accountEmail?.toLowerCase();
  const byEmail = new Map<string, RecentContact>();

  for (const contact of googleContacts) {
    for (const email of contact.email_addresses) {
      const key = email.toLowerCase();
      if (key === self || byEmail.has(key)) continue;
      byEmail.set(key, { email, name: contact.display_name || undefined, lastContacted: 0, frequency: 0, fromGoogle: true });
    }
  }

  for (const thread of threads) {
    for (const participant of thread.participants) {
      const { email, name } = parseContact(participant);
      const key = email.toLowerCase();
      if (!key || key === self) continue;
      const existing = byEmail.get(key);
      if (!existing) {
        byEmail.set(key, { email, name, lastContacted: thread.last_message_date, frequency: 1, fromGoogle: false });
        continue;
      }
      existing.frequency++;
      if (name && !existing.name) existing.name = name;
      if (thread.last_message_date > existing.lastContacted) existing.lastContacted = thread.last_message_date;
    }
  }

  const score = (c: RecentContact) => {
    const recency = c.lastContacted ? 1 / (1 + (now - c.lastContacted) / DAY_MS) : 0;
    const googleBoost = c.fromGoogle && c.frequency === 0 ? 0.1 : 0;
    return c.frequency * 0.4 + recency * 100 * 0.6 + googleBoost;
  };
  return Array.from(byEmail.values()).sort((a, b) => score(b) - score(a));
}

export function matchContacts(contacts: RecentContact[], query: string, limit: number): RecentContact[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? contacts.filter(c => c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
    : contacts;
  return matches.slice(0, limit);
}

// Index of the comma that ends the last complete recipient in a To/Cc value,
// ignoring commas inside quoted display names; -1 if there is none
function lastRecipientSeparator(value: string): number {
  let inQuotes = false;
  let last = -1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') inQuotes = !inQuotes;
    else if (value[i] === "," && !inQuotes) last = i;
  }
  return last;
}

// The recipient still being typed at the end of a To/Cc value
export function currentRecipient(value: string): string {
  return value.slice(lastRecipientSeparator(value) + 1).trim();
}

// The value with the recipient being typed replaced by `email`
export function completeRecipient(value: string, email: string): string {
  const done = value.slice(0, lastRecipientSeparator(value) + 1).trimEnd();
  return done ? `${done} ${email}` : email;
}
