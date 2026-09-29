// Earlier messages that a reply quotes at its end, split off so they can be
// folded away. Quotes answered inline are part of the reply and stay.

const ATTRIBUTION_END = /(wrote|escribió|a écrit|schrieb|ha scritto|escreveu):\s*$/i;
const isQuotedLine = (line: string) => /^\s*>/.test(line);
const isBlank = (line: string) => line.trim() === "";

// Plain text: an attribution line ("On …, Ana wrote:") and the quoted lines
// ending the text, or just those quoted lines when there is no attribution
export function splitQuotedText(text: string): { head: string; quoted: string } | null {
  const lines = text.split("\n");
  let start = lines.length;
  while (start > 0 && (isQuotedLine(lines[start - 1]) || isBlank(lines[start - 1]))) start--;
  if (!lines.slice(start).some(isQuotedLine)) return null;

  let before = start - 1;
  while (before >= 0 && isBlank(lines[before])) before--;
  if (before >= 0 && ATTRIBUTION_END.test(lines[before])) {
    start = before;
    // A long attribution wraps onto a second line
    if (!/^\s*On\b/i.test(lines[before]) && before > 0 && /^\s*On\b/i.test(lines[before - 1])) start = before - 1;
  }

  const head = lines.slice(0, start).join("\n").trimEnd();
  return { head, quoted: text.slice(head.length) };
}

// Where mail clients start the history they quote
const QUOTE_MARKERS = [
  ".gmail_quote",
  'blockquote[type="cite"]',
  "#divRplyFwdMsg",
  "#appendonsend",
  ".moz-cite-prefix",
  ".yahoo_quoted",
].join(", ");

function quoteStart(body: HTMLElement): { node: Node; offset?: number } | null {
  const marker = body.querySelector(QUOTE_MARKERS);
  if (marker) {
    const previous = marker.previousElementSibling;
    if (previous?.tagName === "HR" && marker.id === "divRplyFwdMsg") return { node: previous };
    if (previous && ATTRIBUTION_END.test(previous.textContent?.trim() ?? "")) return { node: previous };
    return { node: marker };
  }
  // A plain-text body's quote sits at the end of its last text
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.trim() !== "") last = n as Text;
  }
  const split = last ? splitQuotedText(last.data) : null;
  return split && last ? { node: last, offset: split.head.length } : null;
}

// HTML: `main` is the reply, `quoted` the history it ends with; null when
// there is no such history, or nothing but it
export function splitQuotedHtml(html: string): { main: string; quoted: string } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  const start = quoteStart(body);
  if (!start) return null;

  const range = doc.createRange();
  if (start.offset !== undefined) range.setStart(start.node, start.offset);
  else range.setStartBefore(start.node);
  range.setEnd(body, body.childNodes.length);
  const history = range.extractContents();

  if (body.textContent?.trim() === "" && !body.querySelector("img")) return null;
  const holder = doc.createElement("div");
  holder.appendChild(history);
  return { main: body.innerHTML, quoted: holder.innerHTML };
}
