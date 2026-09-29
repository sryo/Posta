import { splitQuotedText } from "./quotedHistory";

// "-- " with its trailing space is the delimiter mail clients recognise as
// the start of a signature. The leading blank lines leave room to type above.
export function signatureBlock(signature: string | null | undefined): string {
  const text = signature?.trim();
  return text ? `\n\n-- \n${text}` : "";
}

// The signature goes above any quoted or forwarded text, so it stays with the
// user's own words
export function withSignature(body: string, signature: string | null | undefined): string {
  const block = signatureBlock(signature);
  if (!block || !body) return block + body;
  return block + (body.startsWith("\n") ? "" : "\n\n") + body;
}

// The body with `from`'s signature swapped for `to`'s, when the sender
// changes. A signature the user edited stays as it is; without one, the new
// one goes below what the user typed and above any quoted text.
export function swapSignature(body: string, from: string | null | undefined, to: string | null | undefined): string {
  const old = signatureBlock(from);
  if (!old) {
    if (body === "" || body.startsWith("\n")) return withSignature(body, to);
    const typed = splitQuotedText(body)?.head ?? body.trimEnd();
    return typed + signatureBlock(to) + body.slice(typed.length);
  }
  const at = body.indexOf(old);
  const end = at + old.length;
  if (at === -1 || (end < body.length && body[end] !== "\n")) return body;
  return body.slice(0, at) + signatureBlock(to) + body.slice(end);
}
