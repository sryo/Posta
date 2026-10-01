import { queryWords } from "./queryTokens";

// A user label's name as a query writes it: lower case, with spaces and
// slashes as dashes
export function gmailLabelName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s/]+/g, "-");
}

// The system label each word of a query stands for, where its labels alone
// answer it; a thread is unread when it carries UNREAD
const SYSTEM: Record<string, string> = {
  "in:inbox": "INBOX", "is:inbox": "INBOX", "label:inbox": "INBOX",
  "is:starred": "STARRED", "label:starred": "STARRED",
  "is:unread": "UNREAD", "label:unread": "UNREAD",
  "is:important": "IMPORTANT", "label:important": "IMPORTANT",
  "in:sent": "SENT", "is:sent": "SENT", "label:sent": "SENT",
};

// Whether a card with this query lists a thread with these labels: true when
// every word is answered by the labels, false when one word rules it out,
// null when the labels can't tell (a sender, a word to search for, a label
// not known)
export function cardWouldList(query: string, labels: string[], labelId: (name: string) => string | undefined): boolean | null {
  const words = queryWords(query);
  if (words.length === 0) return null;
  if (labels.includes("SPAM") || labels.includes("TRASH")) {
    return /\b(in|label):(spam|trash|anywhere)\b/i.test(query) ? null : false;
  }
  let known = true;
  for (const { operator } of words) {
    if (!operator) {
      known = false;
      continue;
    }
    const key = `${operator.op}:${operator.value.toLowerCase()}`;
    const label = SYSTEM[key]
      ?? (key === "is:read" ? "UNREAD" : undefined)
      ?? (operator.op === "label" ? labelId(gmailLabelName(operator.value)) : undefined);
    if (!label) {
      known = false;
      continue;
    }
    const wants = (key === "is:read") === operator.negated;
    if (labels.includes(label) !== wants) return false;
  }
  return known ? true : null;
}
