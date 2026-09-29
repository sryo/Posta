import { CALENDAR_OPERATORS, CALENDAR_RANGES, GMAIL_OPERATORS } from "../shared/constants";
import { cardTypeForQuery } from "./cardType";
import { matchContacts, type RecentContact } from "./contacts";

export interface QuerySuggestion {
  text: string;
  desc: string;
  // The part of the query the suggestion replaces
  replace: { start: number; end: number };
}

const EMAIL_ADDRESS_OPERATORS = ["from:", "to:", "cc:", "bcc:", "deliveredto:"];
const CALENDAR_ADDRESS_OPERATORS = ["with:", "organizer:"];
const MAX_SUGGESTIONS = 8;

// Gmail searches a label by its name lowercased, with spaces and the "/" of
// nested labels as hyphens
export function labelQueryValue(name: string): string {
  return name.toLowerCase().replace(/[\s/]+/g, "-");
}

function contactDesc(contact: RecentContact): string {
  const count = contact.frequency > 0 ? `${contact.frequency} email${contact.frequency === 1 ? "" : "s"}` : "";
  if (contact.name) return count ? `${contact.name} (${count})` : contact.name;
  return count;
}

// The whitespace-delimited word the caret is in
export function wordAt(query: string, caret: number): { start: number; end: number } {
  let start = caret;
  while (start > 0 && !/\s/.test(query[start - 1])) start--;
  let end = caret;
  while (end < query.length && !/\s/.test(query[end])) end++;
  return { start, end };
}

// Suggestions for the word the caret is in (the end of the query unless
// given): operators, addresses for address operators, and the account's
// labels for label:. A query starting with calendar: gets calendar operators.
export function querySuggestions(
  query: string,
  contacts: RecentContact[],
  labelNames: string[],
  caret: number = query.length,
): QuerySuggestion[] {
  const replace = wordAt(query, caret);
  const token = query.slice(replace.start, replace.end).toLowerCase();
  if (!token) return [];

  const isFirstWord = !query.slice(0, replace.start).trim();
  const calendar = cardTypeForQuery(query) === "calendar";

  const addressOp = (calendar ? CALENDAR_ADDRESS_OPERATORS : EMAIL_ADDRESS_OPERATORS).find(op => token.startsWith(op));
  if (addressOp) {
    const typed = token.slice(addressOp.length);
    if (!typed) return [];
    return matchContacts(contacts, typed, 6).map(contact => ({
      text: addressOp + contact.email,
      desc: contactDesc(contact),
      replace,
    }));
  }

  if (!calendar && token.startsWith("label:")) {
    const typed = token.slice("label:".length);
    return labelNames
      .filter(name => labelQueryValue(name).startsWith(labelQueryValue(typed)) || name.toLowerCase().includes(typed))
      .slice(0, MAX_SUGGESTIONS)
      .map(name => ({ text: `label:${labelQueryValue(name)}`, desc: name, replace }));
  }

  const operators = [
    ...(isFirstWord ? CALENDAR_RANGES : []),
    ...(calendar ? (isFirstWord ? [] : CALENDAR_OPERATORS) : GMAIL_OPERATORS),
  ];
  const suggestions: QuerySuggestion[] = [];
  for (const { op, desc } of operators) {
    const lower = op.toLowerCase();
    if (lower === token) continue;
    if (lower.startsWith(token) || (token.length >= 2 && lower.includes(token))) {
      suggestions.push({ text: op, desc, replace });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
  }
  return suggestions;
}
