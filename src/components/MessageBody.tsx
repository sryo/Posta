// MessageBody component - handles reactive CID image replacement
import { createMemo } from "solid-js";
import DOMPurify from 'dompurify';

// Configure DOMPurify with safe defaults for email HTML
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span', 'a', 'b', 'i', 'u', 'strong', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'pre', 'code',
    'hr', 'sub', 'sup', 'font', 'center'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'class', 'target', 'width', 'height', 'color', 'size', 'face'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
};

export interface MessageBodyProps {
  body: string;
  cidAttachmentData?: Record<string, string>;
  msgPayloadParts?: any[];
  msgId: string;
  threadAttachments?: { message_id: string; attachment_id: string; content_id: string | null; inline_data: string | null; mime_type: string }[];
}

export const MessageBody = (props: MessageBodyProps) => {
  // Use createMemo to reactively recompute when cidAttachmentData changes
  const processedHtml = createMemo(() => {
    const cidMap = new Map<string, string>();

    // First, use fetched CID data (from downloadAttachment calls)
    if (props.cidAttachmentData) {
      for (const [cid, data] of Object.entries(props.cidAttachmentData)) {
        if (data) {
          const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');
          // Find the mimeType for this CID from message parts
          let mimeType = 'image/png';
          const findMimeType = (parts: any[]) => {
            parts?.forEach(part => {
              const contentIdHeader = part.headers?.find((h: any) =>
                h.name?.toLowerCase() === 'content-id'
              );
              if (contentIdHeader) {
                const partCid = contentIdHeader.value?.replace(/^<|>$/g, '') || '';
                if (partCid === cid && part.mimeType) {
                  mimeType = part.mimeType;
                }
              }
              if (part.parts) findMimeType(part.parts);
            });
          };
          findMimeType(props.msgPayloadParts || []);
          cidMap.set(cid, `data:${mimeType};base64,${base64Data}`);
        }
      }
    }

    // Then scan message parts for Content-ID headers with inline data
    const findCidImages = (parts: any[]) => {
      parts?.forEach(part => {
        const contentIdHeader = part.headers?.find((h: any) =>
          h.name?.toLowerCase() === 'content-id'
        );
        if (contentIdHeader && part.mimeType?.startsWith('image/')) {
          const cid = contentIdHeader.value?.replace(/^<|>$/g, '') || '';
          if (cid && !cidMap.has(cid)) {
            const attachmentId = part.body?.attachmentId;
            let data = part.body?.data;

            if (!data && attachmentId) {
              const threadAtt = props.threadAttachments?.find(
                a => a.message_id === props.msgId && a.attachment_id === attachmentId
              );
              data = threadAtt?.inline_data;
            }

            if (data) {
              const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');
              cidMap.set(cid, `data:${part.mimeType};base64,${base64Data}`);
            }
          }
        }
        if (part.parts) findCidImages(part.parts);
      });
    };
    findCidImages(props.msgPayloadParts || []);

    // Also check threadAttachments with content_id (as backup)
    props.threadAttachments?.forEach(att => {
      if (att.message_id === props.msgId && att.content_id && att.inline_data && att.mime_type.startsWith('image/')) {
        if (!cidMap.has(att.content_id)) {
          const base64Data = att.inline_data.replace(/-/g, '+').replace(/_/g, '/');
          cidMap.set(att.content_id, `data:${att.mime_type};base64,${base64Data}`);
        }
      }
    });

    // Replace cid: URLs with data URLs
    let html = props.body;
    if (cidMap.size > 0) {
      html = html.replace(/src=["']cid:([^"']+)["']/gi, (match, cid) => {
        const dataUrl = cidMap.get(cid);
        return dataUrl ? `src="${dataUrl}"` : match;
      });
    }

    return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
  });

  return <div class="message-body" innerHTML={processedHtml()}></div>;
};

// Export DOMPURIFY_CONFIG for use in other places
export { DOMPURIFY_CONFIG };
