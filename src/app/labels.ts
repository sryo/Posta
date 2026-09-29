import type { GmailLabel } from "../api/tauri";

const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  IMPORTANT: "Important",
  STARRED: "Starred",
  UNREAD: "Unread",
  SENT: "Sent",
  DRAFT: "Drafts",
  SPAM: "Spam",
  TRASH: "Trash",
  CHAT: "Chat",
  CATEGORY_PERSONAL: "Primary",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
};

// Gmail names its system labels by their ids (INBOX, CATEGORY_SOCIAL)
export function labelDisplayName(label: Pick<GmailLabel, "id" | "name" | "label_type">): string {
  if (label.label_type === "user") return label.name;
  const known = SYSTEM_LABEL_NAMES[label.id];
  if (known) return known;
  const words = label.id.replace(/^CATEGORY_/, "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
