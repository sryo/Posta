import { cardTypeForQuery } from "./cardType";

export interface QueryOperator {
  op: string;
  value: string;
  negated: boolean;
}

// One whitespace-separated word of a card query; `operator` is set when the
// word is a single operator the query field can show as a chip
export interface QueryWord {
  text: string;
  operator: QueryOperator | null;
}

const EMAIL_OPERATORS = [
  "from", "to", "cc", "bcc", "subject", "label", "has", "is", "in", "category", "filename",
  "larger", "smaller", "older_than", "newer_than", "after", "before", "deliveredto", "list",
];
const CALENDAR_OPERATORS = ["calendar", "with", "organizer", "location", "response", "status"];
const KNOWN_OPERATORS = new Set([...EMAIL_OPERATORS, ...CALENDAR_OPERATORS]);

// Splits on whitespace outside double quotes and parentheses, so a quoted
// phrase or a parenthesised group stays one word
function splitWords(query: string): string[] {
  const words: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;
  for (const ch of query) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "(") depth++;
    else if (!inQuotes && ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && !inQuotes && depth === 0) {
      if (current) words.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);
  return words;
}

function parseOperator(word: string): QueryOperator | null {
  const match = /^(-?)([a-z_]+):(.+)$/i.exec(word);
  if (!match) return null;
  const op = match[2].toLowerCase();
  if (!KNOWN_OPERATORS.has(op)) return null;
  let value = match[3];
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) return null;
    value = value.slice(1, -1);
  } else if (/["()]/.test(value)) {
    return null;
  }
  if (!value) return null;
  return { op, value, negated: match[1] === "-" };
}

export function queryWords(query: string): QueryWord[] {
  return splitWords(query).map(text => ({ text, operator: parseOperator(text) }));
}

export function joinQueryWords(words: string[]): string {
  return words.filter(Boolean).join(" ");
}

export function removeWord(query: string, index: number): string {
  return joinQueryWords(splitWords(query).filter((_, i) => i !== index));
}

export function replaceWord(query: string, index: number, text: string): string {
  return joinQueryWords(splitWords(query).map((word, i) => (i === index ? text : word)));
}

// The text for an operator's value, quoted when it holds a space
export function operatorText(op: string, value: string, negated = false): string {
  const quoted = /\s/.test(value) ? `"${value}"` : value;
  return `${negated ? "-" : ""}${op}:${quoted}`;
}

const NAMED_RANGES = ["today", "tomorrow", "week", "month"];
const MAX_UPCOMING_DAYS = 36500;
const DAYS_PER_UNIT: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

function parseDuration(value: string): { count: number; unit: string } | null {
  const match = /^(\d+)([dwmy])$/.exec(value);
  if (!match) return null;
  const count = Number(match[1]);
  const days = count * DAYS_PER_UNIT[match[2]];
  if (days < 1 || days > MAX_UPCOMING_DAYS) return null;
  return { count, unit: match[2] };
}

const UNIT_NAMES: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
function durationText({ count, unit }: { count: number; unit: string }): string {
  return `${count} ${UNIT_NAMES[unit]}${count === 1 ? "" : "s"}`;
}

// The range a calendar card's leading calendar: operator names, when it
// names none the backend understands; the message matches the backend's
export function calendarRangeError(query: string): string | null {
  if (cardTypeForQuery(query) !== "calendar") return null;
  const value = queryWords(query.trim())[0]?.text.slice("calendar:".length).replace(/^"|"$/g, "") ?? "";
  const lower = value.toLowerCase();
  if (NAMED_RANGES.includes(lower) || parseDuration(lower)) return null;
  return `Unknown range "${value}". Try today, tomorrow, week, month, 7d, 2w`;
}

function rangeText(value: string): string {
  switch (value.toLowerCase()) {
    case "today": return "today";
    case "tomorrow": return "tomorrow";
    case "week": return "in the next 7 days";
    case "month": return "in the next 30 days";
  }
  const duration = parseDuration(value.toLowerCase())!;
  return duration.count === 1 ? `in the next ${UNIT_NAMES[duration.unit]}` : `in the next ${durationText(duration)}`;
}

const RESPONSES: Record<string, string> = {
  needsaction: "you haven't answered",
  accepted: "you're going",
  declined: "you declined",
  tentative: "you might go",
};

function calendarPart({ op, value, negated }: QueryOperator): string | null {
  if (negated) return null;
  switch (op) {
    case "with": return `with ${value}`;
    case "organizer": return `organised by ${value}`;
    case "location": return `at ${value}`;
    case "response": return RESPONSES[value.toLowerCase()] ?? null;
    case "status": return value.toLowerCase();
  }
  return null;
}

const IS_VALUES: Record<string, string> = {
  unread: "unread", read: "read", starred: "starred", important: "important", snoozed: "snoozed", muted: "muted",
  inbox: "in the inbox",
};
const IN_VALUES: Record<string, string> = {
  inbox: "in the inbox", sent: "in Sent", drafts: "in Drafts", spam: "in Spam", trash: "in Trash",
  anywhere: "anywhere, including Spam and Trash",
};
const HAS_VALUES: Record<string, string> = {
  attachment: "attachments", drive: "Drive files", document: "Google Docs", spreadsheet: "Google Sheets",
  presentation: "Google Slides", youtube: "YouTube videos",
};

function emailPart({ op, value, negated }: QueryOperator): string | null {
  const lower = value.toLowerCase();
  if (op === "has") {
    const what = HAS_VALUES[lower];
    if (!what) return null;
    return `${negated ? "without" : "with"} ${what}`;
  }
  const part = (() => {
    switch (op) {
      case "from": return `from ${value}`;
      case "to": return `to ${value}`;
      case "cc": return `copied to ${value}`;
      case "bcc": return `blind-copied to ${value}`;
      case "deliveredto": return `delivered to ${value}`;
      case "list": return `from the list ${value}`;
      case "subject": return `with “${value}” in the subject`;
      case "label": return `labelled ${value}`;
      case "is": return IS_VALUES[lower] ?? null;
      case "in": return IN_VALUES[lower] ?? null;
      case "category": return `in ${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
      case "filename": return `with an attachment named ${value}`;
      case "larger": return `larger than ${value}`;
      case "smaller": return `smaller than ${value}`;
      case "after": return `after ${value}`;
      case "before": return `before ${value}`;
      case "newer_than": {
        const duration = parseDuration(lower);
        if (!duration) return null;
        return duration.count === 1 ? `from the last ${UNIT_NAMES[duration.unit]}` : `from the last ${durationText(duration)}`;
      }
      case "older_than": {
        const duration = parseDuration(lower);
        return duration ? `older than ${durationText(duration)}` : null;
      }
    }
    return null;
  })();
  if (!part) return null;
  return negated ? `not ${part}` : part;
}

function plainWordPart(word: string): string | null {
  if (/^(OR|AND)$/.test(word) || /[()]/.test(word) || /^-?[a-z_]+:/i.test(word)) return null;
  if (word.startsWith("-")) {
    const excluded = word.slice(1).replace(/^"|"$/g, "");
    return excluded ? `without “${excluded}”` : null;
  }
  return `containing “${word.replace(/^"|"$/g, "")}”`;
}

// A plain-language reading of a card query, such as "Events in the next 7
// days · with Ana"; null when some part of it can't be put into words
export function describeQuery(query: string): string | null {
  const words = queryWords(query.trim());
  if (words.length === 0) return null;
  const calendar = cardTypeForQuery(query) === "calendar";
  if (calendar && calendarRangeError(query)) return null;

  const parts: string[] = [];
  for (const [i, word] of words.entries()) {
    if (calendar && i === 0) continue;
    const part = word.operator
      ? (calendar ? calendarPart(word.operator) : emailPart(word.operator))
      : plainWordPart(word.text);
    if (!part) return null;
    parts.push(part);
  }

  if (calendar) {
    return [`Events ${rangeText(words[0].operator?.value ?? "")}`, ...parts].join(" · ");
  }
  const [first, ...rest] = parts;
  return [`Emails ${first}`, ...rest].join(" · ");
}
