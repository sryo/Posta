import type { SendAttachment } from "../api/tauri";
import type { RecurrenceScope } from "../app/recurrence";

// Props for the inline compose form rendered inside ThreadView and EventView
export interface InlineComposeProps {
  replyToMessageId: string | null;
  isForward: boolean;
  to: string;
  setTo: (v: string) => void;
  cc: string;
  setCc: (v: string) => void;
  bcc: string;
  setBcc: (v: string) => void;
  showCcBcc: boolean;
  setShowCcBcc: (v: boolean) => void;
  suggestContacts?: (query: string) => { email: string; name?: string }[];
  body: string;
  setBody: (v: string) => void;
  attachments: SendAttachment[];
  onRemoveAttachment: (i: number) => void;
  onFileSelect: (e: Event) => void;
  onAddFiles?: (files: File[]) => void;
  error: string | null;
  draftSaving: boolean;
  draftSaved: boolean;
  sending?: boolean;
  onSend: () => void;
  onClose: () => void;
  onInput: () => void;
  focusBody: boolean;
  // The account the reply goes out from, named with more than one signed in
  fromEmail?: string;
  // Resize props
  resizing: boolean;
  onResizeStart: (e: MouseEvent) => void;
}

export interface InlineEditEventProps {
  summary: string;
  setSummary: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  endTime: string;
  setEndTime: (v: string) => void;
  allDay: boolean;
  setAllDay: (v: boolean) => void;
  attendees: string;
  setAttendees: (v: string) => void;
  recurrence: string | null;
  setRecurrence: (v: string | null) => void;
  // Editing one occurrence of a repeating event, which can't take a rule of its own
  occurrenceOnly: boolean;
  // Opened to reschedule: focus starts on the start time
  focusTime?: boolean;
  guestSuggestions?: (query: string) => { email: string; name?: string }[];
  addMeet?: boolean;
  setAddMeet?: (v: boolean) => void;
  hasMeet?: boolean;
  saving: boolean;
  onSave: (scope?: RecurrenceScope) => void;
  // Saving asks which occurrences of a repeating event to change
  askScope?: boolean;
  onClose: () => void;
  error: string | null;
  // Resize props
  resizing: boolean;
  onResizeStart: (e: MouseEvent) => void;
}

// An inline reply sent from the thread view, kept where it was written until
// the thread holds it
export interface SentReply {
  replyToMessageId: string;
  to: string;
  cc: string;
  bcc: string;
  body: string;
  attachments: SendAttachment[];
  fromEmail?: string;
  state: "sending" | "sent";
  sentAt?: number;
  // When the undo window closes
  undoUntil: number;
  onUndo: () => void;
}
