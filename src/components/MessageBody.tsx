// MessageBody component - handles reactive CID image replacement
import { createMemo, createSignal, Show } from "solid-js";
import DOMPurify from 'dompurify';
import { normalizeBase64Url } from "../utils";
import { splitQuotedHtml } from "../app/quotedHistory";

// Configure DOMPurify with safe defaults for email HTML
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'a', 'b', 'i', 'u', 'strong', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'table', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'td', 'th',
    'img', 'pre', 'code', 'hr', 'sub', 'sup', 'font', 'center', 'small', 's', 'strike'
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'style', 'target', 'width', 'height', 'color', 'size', 'face',
    'colspan', 'rowspan', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing'
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
};

// Only allow target="_blank", and force noopener/noreferrer on it so email
// links can't reach back into the opener or leak the referrer
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute('target')) {
    if (node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    } else {
      node.removeAttribute('target');
    }
  }
});

interface MessageBodyProps {
  body: string;
  cidAttachmentData?: Record<string, string>;
  msgPayloadParts?: any[];
  msgId: string;
  // The message is a forward, so the history it carries stays in view
  forward?: boolean;
  threadAttachments?: { message_id: string; attachment_id: string; content_id: string | null; inline_data: string | null; mime_type: string }[];
}

const CID_SRC = /src=["']cid:([^"']+)["']/gi;

type CidImage = { cid: string; mimeType: string; data: string };

const sameCidImages = (a: CidImage[], b: CidImage[]) =>
  a.length === b.length && a.every((x, i) => x.cid === b[i].cid && x.mimeType === b[i].mimeType && x.data === b[i].data);

const partsByContentId = (parts: any[] | undefined) => {
  const byCid = new Map<string, any>();
  const walk = (list: any[] | undefined) => list?.forEach(part => {
    const header = part.headers?.find((h: any) => h.name?.toLowerCase() === 'content-id');
    const cid = header?.value?.replace(/^<|>$/g, '') || '';
    if (cid && !byCid.has(cid)) byCid.set(cid, part);
    if (part.parts) walk(part.parts);
  });
  walk(parts);
  return byCid;
};

export const MessageBody = (props: MessageBodyProps) => {
  // Only the cids this body references matter; cidAttachmentData and
  // threadAttachments are thread-wide and change as other messages load
  const cidImages = createMemo<CidImage[]>(() => {
    const cids = new Set(Array.from(props.body.matchAll(CID_SRC), m => m[1]));
    if (cids.size === 0) return [];

    const parts = partsByContentId(props.msgPayloadParts);
    const ownAttachment = (match: (a: NonNullable<MessageBodyProps['threadAttachments']>[number]) => boolean) =>
      props.threadAttachments?.find(a => a.message_id === props.msgId && match(a));
    const images: CidImage[] = [];
    for (const cid of cids) {
      const part = parts.get(cid);
      // Fetched on demand (downloadAttachment), then inline part data, then
      // the thread listing's inline data
      const fetched = props.cidAttachmentData?.[cid];
      if (fetched) {
        images.push({ cid, mimeType: part?.mimeType || 'image/png', data: fetched });
        continue;
      }
      if (part?.mimeType?.startsWith('image/')) {
        const attachmentId = part.body?.attachmentId;
        const data = part.body?.data
          || (attachmentId ? ownAttachment(a => a.attachment_id === attachmentId)?.inline_data : null);
        if (data) {
          images.push({ cid, mimeType: part.mimeType, data });
          continue;
        }
      }
      const att = ownAttachment(a => a.content_id === cid && !!a.inline_data && a.mime_type.startsWith('image/'));
      if (att) images.push({ cid, mimeType: att.mime_type, data: att.inline_data! });
    }
    return images;
  }, [], { equals: sameCidImages });

  const processedHtml = createMemo(() => {
    const images = cidImages();
    let html = props.body;
    if (images.length > 0) {
      const dataUrls = new Map(images.map(img => [img.cid, `data:${img.mimeType};base64,${normalizeBase64Url(img.data)}`]));
      html = html.replace(CID_SRC, (match, cid) => {
        const dataUrl = dataUrls.get(cid);
        return dataUrl ? `src="${dataUrl}"` : match;
      });
    }
    const split = splitQuotedHtml(html, { forward: props.forward });
    if (!split) return { main: DOMPurify.sanitize(html, DOMPURIFY_CONFIG), quoted: null };
    return { main: DOMPurify.sanitize(split.main, DOMPURIFY_CONFIG), quoted: DOMPurify.sanitize(split.quoted, DOMPURIFY_CONFIG) };
  });

  const [quotedShown, setQuotedShown] = createSignal(false);

  return (
    <div class="message-body">
      <div innerHTML={processedHtml().main}></div>
      <Show when={processedHtml().quoted}>
        {(quoted) => (
          <>
            <button
              class="quoted-toggle"
              aria-expanded={quotedShown()}
              aria-label={quotedShown() ? 'Hide quoted text' : 'Show quoted text'}
              title={quotedShown() ? 'Hide quoted text' : 'Show quoted text'}
              onClick={() => setQuotedShown(!quotedShown())}
            >•••</button>
            <Show when={quotedShown()}>
              <div class="message-quoted" innerHTML={quoted()}></div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

// Export DOMPURIFY_CONFIG for use in other places
export { DOMPURIFY_CONFIG };
