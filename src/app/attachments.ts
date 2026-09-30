import type { Attachment, SendAttachment } from "../api/tauri";
import { formatFileSize } from "../utils";

// Gmail's limit for a single message
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // Drop the "data:mime/type;base64," prefix
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export async function readFilesAsAttachments(
  files: Iterable<File>,
  maxBytes = MAX_ATTACHMENT_SIZE,
): Promise<{ attachments: SendAttachment[]; skipped: string[] }> {
  const attachments: SendAttachment[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      skipped.push(`${file.name} (${formatFileSize(file.size)} - max ${formatFileSize(maxBytes)})`);
      continue;
    }
    try {
      attachments.push({
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        data: await readAsBase64(file),
      });
    } catch {
      skipped.push(`${file.name} (could not be read)`);
    }
  }
  return { attachments, skipped };
}

// Matches the backend's Attachment::is_calendar, which decides whether a thread gets invite UI
export function isCalendarAttachment(a: { filename: string; mime_type: string }): boolean {
  const mime = a.mime_type.toLowerCase();
  return mime === "text/calendar" || mime === "application/ics" || a.filename.toLowerCase().endsWith(".ics");
}

// Shown in the lightbox; SVG is left to other apps since it is a document
// that can carry script, not a plain picture
export function isPreviewable(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return mime === "application/pdf" || (mime.startsWith("image/") && mime !== "image/svg+xml");
}

export type AttachmentKind = "image" | "pdf" | "calendar" | "file";

export function kindOf(a: { filename: string; mime_type: string }): AttachmentKind {
  if (isCalendarAttachment(a)) return "calendar";
  const mime = a.mime_type.toLowerCase();
  if (mime === "application/pdf") return "pdf";
  return mime.startsWith("image/") ? "image" : "file";
}

// An image the message body shows in place (a logo, a signature) rather than a
// file sent along: the thread view draws it inside the mail. Photos from Apple
// Mail carry a Content-ID too, so it also takes an unnamed part (named after
// its Content-ID), an Outlook-style "image001.png", or a small size. The
// backend's Attachment::looks_embedded is the same rule.
const EMBEDDED_IMAGE_MAX_SIZE = 15_000;
export function inBody(a: Pick<Attachment, "content_id" | "mime_type" | "filename" | "size">): boolean {
  if (!a.content_id || !a.mime_type.startsWith("image/")) return false;
  const stem = a.filename.replace(/\.[^.]*$/, "");
  return stem === a.content_id || /^image\d{3}$/i.test(stem) || a.size < EMBEDDED_IMAGE_MAX_SIZE;
}

// The attachments worth showing: not images the body already draws, not the
// calendar file when the invite shows its event, and each file once. Google
// puts an invite's .ics in a message twice (the invite part and the attached
// file), so a message keeps one calendar file; a file sent again in a later
// message of the same list shows once.
export function visibleAttachments(list: Attachment[], opts: { hideCalendar?: boolean } = {}): Attachment[] {
  const calendarIn = new Set<string>();
  const fileFrom = new Map<string, string>();
  return list.filter(a => {
    if (inBody(a)) return false;
    if (isCalendarAttachment(a)) {
      if (opts.hideCalendar || calendarIn.has(a.message_id)) return false;
      calendarIn.add(a.message_id);
      return true;
    }
    const key = `${a.filename}\u0000${a.size}`;
    const from = fileFrom.get(key);
    if (from !== undefined && from !== a.message_id) return false;
    fileFrom.set(key, a.message_id);
    return true;
  });
}

// "80431_EXPENSAS_OCT.pdf" as a stem that can be cut short and the extension that can't
export function splitName(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0 && filename.length - dot <= 6 ? { stem: filename.slice(0, dot), ext: filename.slice(dot) } : { stem: filename, ext: "" };
}
