export const CARD_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
export const COLOR_HEX: Record<string, string> = {
  red: "#E53935",
  orange: "#FB8C00",
  yellow: "#FDD835",
  green: "#43A047",
  cyan: "#00ACC1",
  blue: "#1E88E5",
  purple: "#5E35B1",
  pink: "#D81B60",
};

export type CardColor = typeof CARD_COLORS[number] | null;

// Background colors with light/dark mode support (same base colors, lower opacity)
export const BG_COLORS = [
  { light: "rgba(229, 57, 53, 0.18)", dark: "rgba(229, 57, 53, 0.25)", hex: "#E53935" },
  { light: "rgba(251, 140, 0, 0.18)", dark: "rgba(251, 140, 0, 0.25)", hex: "#FB8C00" },
  { light: "rgba(253, 216, 53, 0.20)", dark: "rgba(253, 216, 53, 0.22)", hex: "#FDD835" },
  { light: "rgba(67, 160, 71, 0.18)", dark: "rgba(67, 160, 71, 0.25)", hex: "#43A047" },
  { light: "rgba(0, 172, 193, 0.18)", dark: "rgba(0, 172, 193, 0.25)", hex: "#00ACC1" },
  { light: "rgba(30, 136, 229, 0.18)", dark: "rgba(30, 136, 229, 0.25)", hex: "#1E88E5" },
  { light: "rgba(94, 53, 177, 0.18)", dark: "rgba(94, 53, 177, 0.25)", hex: "#5E35B1" },
  { light: "rgba(216, 27, 96, 0.18)", dark: "rgba(216, 27, 96, 0.25)", hex: "#D81B60" },
];

export type GroupBy = "date" | "sender" | "label" | "organizer" | "calendar";

export const EMAIL_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "sender", label: "Sender" },
  { value: "label", label: "Label" },
];

export const CALENDAR_GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "organizer", label: "Organizer" },
  { value: "calendar", label: "Calendar" },
];

export type ActionSettings = Record<string, boolean>;

// Gmail search operators for autocomplete
export const GMAIL_OPERATORS: { op: string; desc: string; values?: string[] }[] = [
  { op: "from:", desc: "Sender address" },
  { op: "to:", desc: "Recipient address" },
  { op: "cc:", desc: "CC recipient" },
  { op: "bcc:", desc: "BCC recipient" },
  { op: "subject:", desc: "Words in subject" },
  { op: "label:", desc: "Messages with label" },
  { op: "has:attachment", desc: "Has attachments" },
  { op: "has:drive", desc: "Has Google Drive files" },
  { op: "has:document", desc: "Has Google Docs" },
  { op: "has:spreadsheet", desc: "Has Google Sheets" },
  { op: "has:presentation", desc: "Has Google Slides" },
  { op: "has:youtube", desc: "Has YouTube videos" },
  { op: "is:unread", desc: "Unread messages" },
  { op: "is:read", desc: "Read messages" },
  { op: "is:starred", desc: "Starred messages" },
  { op: "is:important", desc: "Important messages" },
  { op: "is:snoozed", desc: "Snoozed messages" },
  { op: "is:muted", desc: "Muted conversations" },
  { op: "in:inbox", desc: "In inbox" },
  { op: "in:sent", desc: "In sent" },
  { op: "in:drafts", desc: "In drafts" },
  { op: "in:spam", desc: "In spam" },
  { op: "in:trash", desc: "In trash" },
  { op: "in:anywhere", desc: "All mail including spam/trash" },
  { op: "category:primary", desc: "Primary category" },
  { op: "category:social", desc: "Social category" },
  { op: "category:promotions", desc: "Promotions category" },
  { op: "category:updates", desc: "Updates category" },
  { op: "category:forums", desc: "Forums category" },
  { op: "filename:", desc: "Attachment filename" },
  { op: "larger:", desc: "Larger than size (e.g. 5M)" },
  { op: "smaller:", desc: "Smaller than size" },
  { op: "older_than:", desc: "Older than (e.g. 1y, 2m, 3d)" },
  { op: "newer_than:", desc: "Newer than" },
  { op: "after:", desc: "After date (YYYY/MM/DD)" },
  { op: "before:", desc: "Before date" },
  { op: "deliveredto:", desc: "Delivered to address" },
  { op: "list:", desc: "Mailing list" },
];
