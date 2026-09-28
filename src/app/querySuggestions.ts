import { GMAIL_OPERATORS } from "../shared/constants";
import { matchContacts, type RecentContact } from "./contacts";

export interface QuerySuggestion {
  text: string;
  desc: string;
  // The part of the query the suggestion replaces
  replace: { start: number; end: number };
}

const ADDRESS_OPERATORS = ["from:", "to:", "cc:", "bcc:", "deliveredto:"];
const MAX_SUGGESTIONS = 8;

// Gmail searches a label by its name lowercased, with spaces and the "/" of
// nested labels as hyphens
export function labelQueryValue(name: string): string {
  return name.toLowerCase().replace(/[\s/]+/g, "-");
}

// Suggestions for the word being typed at the end of a card query: operators,
// addresses for address operators, and the account's labels for label:
export function querySuggestions(query: string, contacts: RecentContact[], labelNames: string[]): QuerySuggestion[] {
  const tokenStart = query.lastIndexOf(" ") + 1;
  const token = query.slice(tokenStart).toLowerCase();
  if (!token) return [];
  const replace = { start: tokenStart, end: query.length };

  const addressOp = ADDRESS_OPERATORS.find(op => token.startsWith(op));
  if (addressOp) {
    const typed = token.slice(addressOp.length);
    if (!typed) return [];
    return matchContacts(contacts, typed, 6).map(contact => ({
      text: addressOp + contact.email,
      desc: contact.name ? `${contact.name} (${contact.frequency} emails)` : `${contact.frequency} emails`,
      replace,
    }));
  }

  if (token.startsWith("label:")) {
    const typed = token.slice("label:".length);
    return labelNames
      .filter(name => labelQueryValue(name).startsWith(labelQueryValue(typed)) || name.toLowerCase().includes(typed))
      .slice(0, MAX_SUGGESTIONS)
      .map(name => ({ text: `label:${labelQueryValue(name)}`, desc: name, replace }));
  }

  const suggestions: QuerySuggestion[] = [];
  for (const { op, desc } of GMAIL_OPERATORS) {
    const lower = op.toLowerCase();
    if (lower.startsWith(token) || (token.length >= 2 && lower.includes(token))) {
      suggestions.push({ text: op, desc, replace });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
  }
  return suggestions;
}
