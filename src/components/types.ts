import type { SendAttachment } from "../api/tauri";

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
  subject: string;
  setSubject: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  attachments: SendAttachment[];
  onRemoveAttachment: (i: number) => void;
  onFileSelect: (e: Event) => void;
  error: string | null;
  draftSaving: boolean;
  draftSaved: boolean;
  sending?: boolean;
  onSend: () => void;
  onClose: () => void;
  onInput: () => void;
  focusBody: boolean;
  // Resize props
  messageWidth: number;
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
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  error: string | null;
  // Resize props
  resizing: boolean;
  onResizeStart: (e: MouseEvent) => void;
}
