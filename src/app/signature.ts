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
