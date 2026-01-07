// Utility functions

/**
 * Decode HTML entities like &amp; &#39; etc.
 */
export function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Decode base64 URL-safe string as UTF-8
 */
export function decodeBase64Utf8(base64: string): string {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const binaryStr = atob(normalized);
  const bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Recursively search for content in nested MIME parts by type
 */
export function findContent(parts: any[] | undefined, mimeType: string): string | null {
  if (!parts) return null;
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Utf8(part.body.data);
    }
    if (part.parts) {
      const found = findContent(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format timestamp for display (time if today, date otherwise)
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Sync status thresholds (in milliseconds)
export const SYNC_FRESH_MS = 3000;      // "just now" duration
export const SYNC_STALE_MS = 15 * 60 * 1000;  // 15 minutes

/**
 * Get sync status state: 'fresh' | 'stale' | 'normal'
 */
export function getSyncState(timestamp: number | undefined, now?: number): 'fresh' | 'stale' | 'normal' {
  if (!timestamp) return 'normal';
  const diff = (now ?? Date.now()) - timestamp;
  if (diff < SYNC_FRESH_MS) return 'fresh';
  if (diff > SYNC_STALE_MS) return 'stale';
  return 'normal';
}

/**
 * Format sync time as relative time (e.g., "2m ago")
 * @param timestamp - The timestamp to format
 * @param now - Optional current time (for reactive updates)
 */
export function formatSyncTime(timestamp: number | undefined, now?: number): string {
  if (!timestamp) return "";
  const currentTime = now ?? Date.now();
  const diff = currentTime - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (diff < SYNC_FRESH_MS) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Truncate filename in the middle, preserving extension
 */
export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const ext = str.lastIndexOf('.') > 0 ? str.slice(str.lastIndexOf('.')) : '';
  const nameLen = maxLen - ext.length - 2; // 2 for ".."
  if (nameLen <= 0) return str.slice(0, maxLen - 2) + '..';
  return str.slice(0, nameLen) + '..' + ext;
}

/**
 * Get initial letter from email for avatar placeholder
 */
export function getInitial(email: string): string {
  return email.charAt(0).toUpperCase();
}

/**
 * Convert base64 to Blob
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const byteCharacters = atob(normalized);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Extract email address from "Name <email@example.com>" format
 */
export function extractEmail(fromStr: string): string {
  const match = fromStr.match(/<([^>]+)>/);
  return match ? match[1] : fromStr;
}

/**
 * Extract name from "Name <email@example.com>" format
 * Returns undefined if no name found
 */
export function extractName(fromStr: string): string | undefined {
  const match = fromStr.match(/^(.+?)\s*<[^>]+>$/);
  if (match) {
    // Remove surrounding quotes if present
    return match[1].replace(/^["']|["']$/g, '').trim() || undefined;
  }
  return undefined;
}

/**
 * Parse "Name <email>" or plain email into { name, email }
 */
export function parseContact(str: string): { email: string; name?: string } {
  const email = extractEmail(str);
  const name = extractName(str);
  return { email, name };
}

/**
 * Generate consistent color from string (for avatars)
 */
const AVATAR_COLORS = [
  '#E53935', '#FB8C00', '#FDD835', '#43A047',
  '#00ACC1', '#1E88E5', '#5E35B1', '#D81B60'
];

export function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Validate a single email address
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  // Basic email regex - allows most valid emails
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

/**
 * Validate a comma-separated list of emails (for To, Cc, Bcc fields)
 * Returns { valid: boolean, invalidEmails: string[] }
 */
export function validateEmailList(emailStr: string): { valid: boolean; invalidEmails: string[] } {
  if (!emailStr.trim()) return { valid: true, invalidEmails: [] };

  const emails = emailStr.split(',').map(e => e.trim()).filter(e => e);
  const invalidEmails: string[] = [];

  for (const email of emails) {
    // Handle "Name <email>" format
    const extracted = extractEmail(email);
    if (!isValidEmail(extracted)) {
      invalidEmails.push(email);
    }
  }

  return { valid: invalidEmails.length === 0, invalidEmails };
}

/**
 * Format email header date string into a nice readable format
 * e.g., "Mon, 23 Dec 2024 10:30:15 -0500" -> "Dec 23 at 10:30 AM" or "Today at 10:30 AM"
 */
export function formatEmailDate(dateStr: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr; // Return original if parsing fails

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  }
  if (isThisYear) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${timeStr}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ` at ${timeStr}`;
}

/**
 * Format calendar event date/time for display
 * Shows date, time, and duration (e.g., "Today 2pm (1h)")
 */
export function formatCalendarEventDate(
  startTime: number,
  endTime: number | null,
  allDay: boolean
): string {
  let start: Date;
  if (allDay) {
    const d = new Date(startTime);
    start = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  } else {
    start = new Date(startTime);
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  // Normalize start to midnight for date comparison (matches grouping logic)
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const isToday = startDay.getTime() === today.getTime();
  const isTomorrow = startDay.getTime() === tomorrow.getTime();
  const isThisYear = start.getFullYear() === now.getFullYear();

  // Format date part
  let dateStr: string;
  if (isToday) {
    dateStr = 'Today';
  } else if (isTomorrow) {
    dateStr = 'Tomorrow';
  } else if (isThisYear) {
    dateStr = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } else {
    dateStr = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // For all-day events, just show the date
  if (allDay) {
    return dateStr;
  }

  // Format time - compact format like "2pm" or "2:30pm"
  const hours = start.getHours();
  const minutes = start.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;
  const timeStr = minutes === 0 ? `${hour12}${ampm}` : `${hour12}:${minutes.toString().padStart(2, '0')}${ampm}`;

  if (endTime) {
    const durationMs = endTime - startTime;
    const durationMins = Math.round(durationMs / 60000);

    let durationStr: string;
    if (durationMins < 60) {
      durationStr = `${durationMins}m`;
    } else {
      const hours = Math.floor(durationMins / 60);
      const mins = durationMins % 60;
      durationStr = mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
    }

    return `${dateStr} ${timeStr} (${durationStr})`;
  }

  return `${dateStr} ${timeStr}`;
}
