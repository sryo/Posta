import { decodeBase64Utf8, findContent } from "../utils";

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function plainTextHtml(text: string): string {
  return `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(text)}</pre>`;
}

// A Gmail message payload as HTML safe to hand to the sanitizer: HTML bodies
// pass through, plain-text bodies are escaped so `<addr@x>` etc. stay visible.
// The snippet fallback is already entity-encoded by Gmail.
export function messageBodyHtml(payload: any, snippet?: string): string {
  if (payload?.body?.data) {
    const body = decodeBase64Utf8(payload.body.data);
    return payload.mimeType === 'text/html' ? body : plainTextHtml(body);
  }

  const htmlContent = findContent(payload?.parts, 'text/html');
  if (htmlContent) return htmlContent;

  const textContent = findContent(payload?.parts, 'text/plain');
  if (textContent) return plainTextHtml(textContent);

  return snippet || '(No content)';
}
