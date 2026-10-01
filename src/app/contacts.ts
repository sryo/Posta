import type { Contact } from "../api/tauri";
import { parseContact } from "../utils";
import { localeOrApp } from "./dateFormat";
import { isRobot } from "./people";

export interface RecentContact {
  email: string;
  name?: string;
  lastContacted: number;
  frequency: number;
  fromGoogle: boolean;
  // When loaded mail first shows the address
  firstSeen?: number;
  // A short line under the suggestion, such as why it ranks where it does
  note?: string;
}

const DAY_MS = 1000 * 60 * 60 * 24;

// Everyone the user could write to: Google contacts plus the participants of
// loaded threads, best first, leaving out the user's own accounts. Frequent and recent correspondents rank high;
// a Google contact never seen in a thread gets a small boost over nothing.
export function rankContacts(
  googleContacts: Contact[],
  threads: { participants: string[]; last_message_date: number }[],
  ownEmails: string[],
  now: number,
): RecentContact[] {
  const own = new Set(ownEmails.map(e => e.toLowerCase()));
  const byEmail = new Map<string, RecentContact>();

  for (const contact of googleContacts) {
    for (const email of contact.email_addresses) {
      const key = email.toLowerCase();
      if (own.has(key) || byEmail.has(key)) continue;
      byEmail.set(key, { email, name: contact.display_name || undefined, lastContacted: 0, frequency: 0, fromGoogle: true });
    }
  }

  for (const thread of threads) {
    for (const participant of thread.participants) {
      const { email, name } = parseContact(participant);
      const key = email.toLowerCase();
      if (!key || own.has(key)) continue;
      const existing = byEmail.get(key);
      if (!existing) {
        byEmail.set(key, { email, name, lastContacted: thread.last_message_date, frequency: 1, fromGoogle: false, firstSeen: thread.last_message_date });
        continue;
      }
      existing.frequency++;
      existing.firstSeen = Math.min(existing.firstSeen ?? thread.last_message_date, thread.last_message_date);
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

const QUIET_DAYS = 60;

// A name two addresses must share to be one person: accents, case and
// spacing aside, and at least two words, so "Ana" alone links nobody
function personKey(name: string | undefined): string | null {
  const key = name?.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
  return key && key.includes(" ") ? key : null;
}

// "August" this year, "July 2025" before it
function monthLabel(time: number, now: number, locale?: string): string {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(localeOrApp(locale), sameYear ? { month: "long" } : { month: "long", year: "numeric" }).format(date);
}

// A person who has moved to a new address: both have written to the user,
// the new one at least twice and only after the old one went quiet for 60
// days or more. The new address moves above the old one and both say why;
// if the old one still writes, they are two inboxes and nothing changes.
export function noteMovedContacts(contacts: RecentContact[], now: number, locale?: string): RecentContact[] {
  const byPerson = new Map<string, RecentContact[]>();
  for (const contact of contacts) {
    const key = personKey(contact.name);
    if (!key || contact.frequency === 0 || isRobot(contact.email)) continue;
    byPerson.set(key, [...(byPerson.get(key) ?? []), contact]);
  }
  const result = [...contacts];
  for (const group of byPerson.values()) {
    if (group.length < 2) continue;
    const latest = group.reduce((a, b) => (b.lastContacted > a.lastContacted ? b : a));
    const olds = group.filter(c => c !== latest);
    const moved = latest.frequency >= 2 && latest.firstSeen !== undefined && olds.every(old =>
      old.lastContacted < latest.firstSeen! && now - old.lastContacted >= QUIET_DAYS * DAY_MS);
    if (!moved) continue;
    const firstOld = Math.min(...olds.map(old => result.indexOf(old)));
    const at = result.indexOf(latest);
    const newer = { ...latest, note: `Writes from here since ${monthLabel(latest.firstSeen!, now, locale)}` };
    result.splice(at, 1);
    result.splice(Math.min(at, firstOld), 0, newer);
    for (const old of olds) result[result.indexOf(old)] = { ...old, note: `Last heard from here in ${monthLabel(old.lastContacted, now, locale)}` };
  }
  return result;
}

const NO_REPLY = /^(no|do[-_.]?not)[-_.]?reply\b/i;

function startsAWord(contact: RecentContact, q: string): boolean {
  const email = contact.email.toLowerCase();
  const name = contact.name?.toLowerCase() ?? "";
  const words = [...email.split("@")[0].split(/[-_.+]/), ...name.split(/\s+/)];
  return email.startsWith(q) || name.startsWith(q) || words.some(w => w.startsWith(q));
}

// Contacts the query finds, best first: people before no-reply senders, and
// within each, names or addresses starting with the query before ones that
// only contain it. The ranking order holds within each tier.
export function matchContacts(contacts: RecentContact[], query: string, limit: number): RecentContact[] {
  const q = query.trim().toLowerCase();
  const tier = (c: RecentContact) => (NO_REPLY.test(c.email) ? 2 : 0) + (q && !startsAWord(c, q) ? 1 : 0);
  const matches = q
    ? contacts.filter(c => c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
    : contacts;
  return matches
    .map(contact => ({ contact, tier: tier(contact) }))
    .sort((a, b) => a.tier - b.tier)
    .slice(0, limit)
    .map(m => m.contact);
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
