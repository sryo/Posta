// The eight card hues, by the names App.css gives them (--hue-red, …). Script
// passes a hue by name, as data-color or data-hue; the stylesheet colours it.
export const CARD_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;

export type CardHue = typeof CARD_COLORS[number];
export type CardColor = CardHue | null;

// Board colours, in the order their index is stored under; the board wears
// the hue through data-board-hue on <html>.
export const BOARD_COLORS: { name: string; hue: CardHue }[] = [
  { name: "Red", hue: "red" },
  { name: "Orange", hue: "orange" },
  { name: "Yellow", hue: "yellow" },
  { name: "Green", hue: "green" },
  { name: "Teal", hue: "cyan" },
  { name: "Blue", hue: "blue" },
  { name: "Purple", hue: "purple" },
  { name: "Pink", hue: "pink" },
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
export const GMAIL_OPERATORS: { op: string; desc: string }[] = [
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

// A calendar card's query starts with one of these ranges
export const CALENDAR_RANGES: { op: string; desc: string }[] = [
  { op: "calendar:today", desc: "Today's events" },
  { op: "calendar:tomorrow", desc: "Tomorrow's events" },
  { op: "calendar:week", desc: "Next 7 days, from today" },
  { op: "calendar:month", desc: "Next 30 days, from today" },
  { op: "calendar:7d", desc: "Next 7 days, from now" },
  { op: "calendar:2w", desc: "Next 2 weeks, from now" },
];

export const CALENDAR_OPERATORS: { op: string; desc: string }[] = [
  { op: "with:", desc: "Attendee name or address" },
  { op: "organizer:", desc: "Event organizer" },
  { op: "location:", desc: "Event location" },
  { op: "response:needsAction", desc: "Events you haven't answered" },
  { op: "response:accepted", desc: "Events you're going to" },
  { op: "response:declined", desc: "Events you declined" },
  { op: "status:cancelled", desc: "Cancelled events" },
];
