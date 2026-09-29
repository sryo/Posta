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
// changes. A signature the user edited, or text typed where one would go,
// stays as it is.
export function swapSignature(body: string, from: string | null | undefined, to: string | null | undefined): string {
  const old = signatureBlock(from);
  if (!old) return body === "" || body.startsWith("\n") ? withSignature(body, to) : body;
  const at = body.indexOf(old);
  const end = at + old.length;
  if (at === -1 || (end < body.length && body[end] !== "\n")) return body;
  return body.slice(0, at) + signatureBlock(to) + body.slice(end);
}
