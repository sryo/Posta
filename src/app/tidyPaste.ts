import { extractEmail, extractName } from "../utils";
import { formatRecipient, splitAtSeparators } from "./people";

const ADDRESS = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/g;

type Person = { email: string; name?: string };

// A pasted piece's people: one address takes the rest of the piece as its
// name ("Ana Ruiz <ana@x.co>", '"Bruno Sosa" bruno@x.dev', a sheet's "Ana\tana@x.co");
// several addresses in one piece stand alone
function peopleIn(piece: string): Person[] {
  const emails = piece.match(ADDRESS) ?? [];
  if (emails.length !== 1) return emails.map(email => ({ email }));
  const name = piece
    .replace(emails[0], " ")
    .replace(/mailto:/gi, " ")
    .replace(/[<>"'()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,;.-]+|[\s:,;.-]+$/g, "");
  return [{ email: emails[0], name: name || undefined }];
}

// What a pasted piece with no address is called: "Pablo (no email yet)" reads "Pablo"
const labelOf = (piece: string) => piece.replace(/\([^)]*\)/g, " ").replace(/["']/g, "").replace(/\s+/g, " ").trim();

const firstName = (person: Person) => person.name?.split(" ")[0] || person.email;

export interface TidiedRecipients {
  value: string;
  added: number;
  // Who was in the field already, by first name, and their addresses
  already: string[];
  merged: string[];
  // Pasted text that names no address, left at the end to finish
  unresolved: string[];
}

// A pasted list of people as recipients after what the field holds: each
// address once, named from the paste or else the contacts, with the text
// that has no address left at the end. Null for a paste that isn't a list:
// one bare address, or text without any.
export function tidyRecipients(existing: string, pasted: string, nameFor?: (email: string) => string | undefined): TidiedRecipients | null {
  const pieces = pasted.split(/\r?\n/).flatMap(line => splitAtSeparators(line)).map(p => p.replace(/\t/g, " ").trim()).filter(Boolean);
  const people = pieces.map(peopleIn);
  const found = people.flat();
  if (found.length === 0) return null;
  if (pieces.length === 1 && pieces[0] === found[0].email) return null;

  const kept = splitAtSeparators(existing).map(p => p.trim()).filter(Boolean);
  const keptByEmail = new Map(kept.filter(p => p.includes("@")).map(p => [extractEmail(p).toLowerCase(), p]));
  const seen = new Set<string>();
  const added: string[] = [];
  const already: string[] = [];
  const merged: string[] = [];
  const unresolved: string[] = [];
  pieces.forEach((piece, i) => {
    if (people[i].length === 0) {
      const label = labelOf(piece);
      if (label) unresolved.push(label);
      return;
    }
    for (const person of people[i]) {
      const key = person.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const there = keptByEmail.get(key);
      if (there !== undefined) {
        already.push(firstName({ email: person.email, name: extractName(there) ?? person.name }));
        merged.push(key);
        continue;
      }
      added.push(formatRecipient({ email: person.email, name: person.name || nameFor?.(key) }));
    }
  });
  return { value: [...kept, ...added, ...unresolved].join(", "), added: added.length, already, merged, unresolved };
}

const people = (names: string[]) => (names.length === 2 ? `${names[0]} and ${names[1]}` : names[0]);

// "Added 2 · Ana was already here · “Pablo” has no address, left for you"
export function pasteNote(tidy: Pick<TidiedRecipients, "added" | "already" | "unresolved">): string {
  const parts: string[] = [];
  if (tidy.added > 0) parts.push(`Added ${tidy.added}`);
  if (tidy.already.length === 1) parts.push(`${tidy.already[0]} was already here`);
  else if (tidy.already.length === 2) parts.push(`${people(tidy.already)} were already here`);
  else if (tidy.already.length > 2) parts.push(`${tidy.already.length} were already here`);
  if (tidy.unresolved.length === 1) parts.push(`“${tidy.unresolved[0]}” has no address, left for you`);
  else if (tidy.unresolved.length > 1) parts.push(`${tidy.unresolved.length} have no address, left for you`);
  return parts.join(" · ");
}

const URL_ONLY = /^https?:\/\/\S+$/i;

// A link pasted over selected words in a plain-text body: the words keep
// their place with the link after them in brackets, as plain text links.
// Null unless the paste is one URL and the selection is words, not a link.
export function linkPaste(text: string, start: number, end: number, pasted: string): { text: string; caret: number; note: string } | null {
  const url = pasted.trim();
  const selected = text.slice(start, end);
  if (start === end || !URL_ONLY.test(url) || !selected.trim() || /https?:\/\//i.test(selected)) return null;
  const linked = `${selected} (${url})`;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // An unparseable URL is still named whole
  }
  return {
    text: text.slice(0, start) + linked + text.slice(end),
    caret: start + linked.length,
    note: `Linked “${selected.trim()}” to ${host}`,
  };
}
