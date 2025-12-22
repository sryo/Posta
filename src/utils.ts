// Utility functions

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

/**
 * Format sync time as relative time (e.g., "2m ago")
 */
export function formatSyncTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return "just now";
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
