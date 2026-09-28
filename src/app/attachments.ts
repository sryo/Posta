import type { SendAttachment } from "../api/tauri";
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
