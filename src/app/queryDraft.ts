import { isBalanced, joinQueryWords, queryWords } from "./queryTokens";

// A card query while its field is being typed in: the finished words before
// the text box, the text in it, and the finished words after it
export interface QueryDraft {
  head: string;
  draft: string;
  tail: string;
}

const wordTexts = (text: string) => queryWords(text).map(w => w.text);

export function composeQuery(d: QueryDraft): string {
  return joinQueryWords([d.head.trim(), d.draft.trim(), d.tail.trim()]);
}

export function draftAtEnd(query: string): QueryDraft {
  return { head: query.trim(), draft: "", tail: "" };
}

export function draftAtWord(query: string, index: number): { draft: QueryDraft; caret: number } {
  const words = wordTexts(query);
  const text = words[index] ?? "";
  return {
    draft: { head: joinQueryWords(words.slice(0, index)), draft: text, tail: joinQueryWords(words.slice(index + 1)) },
    caret: text.length,
  };
}

// Words before the caret are finished once a space follows them outside any
// quote or group, and move out of the text box; a paste finishes every word
// but the one the caret is in
export function commitTyped(d: QueryDraft, caret: number): { draft: QueryDraft; caret: number } {
  for (let end = caret; end > 0; end--) {
    const typed = d.draft.slice(0, end);
    if (!/\s$/.test(typed) || !isBalanced(typed)) continue;
    return {
      draft: { head: joinQueryWords([d.head.trim(), typed.trim()]), draft: d.draft.slice(end).replace(/^\s+/, ""), tail: d.tail },
      caret: caret - end,
    };
  }
  return { draft: d, caret };
}

export function stepLeft(d: QueryDraft): QueryDraft | null {
  const head = wordTexts(d.head);
  const previous = head.pop();
  if (previous === undefined) return null;
  return { head: joinQueryWords(head), draft: "", tail: joinQueryWords([previous, d.draft.trim(), d.tail.trim()]) };
}

export function stepRight(d: QueryDraft): QueryDraft | null {
  const tail = wordTexts(d.tail);
  const next = tail.shift();
  if (next === undefined) return null;
  return { head: joinQueryWords([d.head.trim(), d.draft.trim(), next]), draft: "", tail: joinQueryWords(tail) };
}

export function editPrevious(d: QueryDraft): { draft: QueryDraft; caret: number } | null {
  const head = wordTexts(d.head);
  const previous = head.pop();
  if (previous === undefined) return null;
  return { draft: { head: joinQueryWords(head), draft: joinQueryWords([previous, d.draft]), tail: d.tail }, caret: previous.length };
}

// The query autocomplete reads for the draft's caret: everything up to the end
// of the draft, so the calendar range and the first word are known, and where
// the draft starts in it
export function suggestionContext(d: QueryDraft, caret: number): { query: string; caret: number; offset: number } {
  const head = d.head.trim();
  const offset = head ? head.length + 1 : 0;
  return { query: (head ? `${head} ` : "") + d.draft, caret: offset + caret, offset };
}
