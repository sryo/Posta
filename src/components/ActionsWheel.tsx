import { Show, createMemo, type JSX } from "solid-js";
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  rsvpListedCalendarEvent,
  type Account,
  type Thread,
  type GoogleCalendarEvent,
} from "../api/tauri";
import { rsvpFailureMessage, rsvpSentMessage, type RsvpStatus } from "../app/rsvp";
import { eventActions, meetingOver } from "../app/eventActions";
import type { ScopeAnchor } from "../app/scopePrompt";
import {
  ClearIcon,
  ReplyIcon,
  ReplyAllIcon,
  ForwardIcon,
  ArchiveIcon,
  InboxIcon,
  StarIcon,
  StarFilledIcon,
  TrashIcon,
  SpamIcon,
  ThumbsUpIcon,
  ThumbsUpFilledIcon,
  ThumbsDownIcon,
  EyeOpenIcon,
  EyeClosedIcon,
  CalendarIcon,
  VideoIcon,
  CheckIcon,
} from "./Icons";
import { ActionWheel } from "./ActionWheel";
import type { RadialItem } from "./RadialMenu";

// The actions for a row, fanned out on the left of its checkbox
export const ActionsWheel = (props: {
  cardId: string;
  threadId?: string | null;
  thread?: Thread | null;
  event?: GoogleCalendarEvent | null;
  selectedCount: number;
  open: boolean;
  onClose: () => void;
  // App state accessors
  selectedAccount: () => Account | null;
  actionSettings: () => Record<string, boolean>;
  actionOrder: () => string[];
  eventActionSettings: () => Record<string, boolean>;
  eventActionOrder: () => string[];
  selectedThreads: () => Record<string, Set<string>>;
  setSelectedThreads: (v: Record<string, Set<string>>) => void;
  selectedEvents: () => Record<string, Set<string>>;
  setSelectedEvents: (v: Record<string, Set<string>>) => void;
  // App action callbacks
  openThreadQuickReply: (threadId: string, cardId: string) => void;
  openEventQuickReply: (eventId: string) => void;
  startBatchReply: (cardId: string, threadIds: string[]) => void;
  handleForward: (threadId: string, cardId: string) => void;
  handleThreadAction: (action: string, threadIds: string[], cardId: string) => void;
  // Deletes an event the user can edit; without it the wheel offers no delete
  // `anchor` is where the delete button was, for a menu asking which of a
  // repeating event's occurrences to delete
  onDeleteEvent?: (event: GoogleCalendarEvent, anchor: ScopeAnchor) => void;
  onRsvped?: (eventId: string, status: string) => void;
  showToast: (message: string) => void;
  // "Couldn't …", with the error that caused it
  showFailure: (failure: string, error: unknown) => void;
}) => {
  // One response at a time: a double click would otherwise send two
  let rsvpInFlight = false;
  const rsvp = async (evt: GoogleCalendarEvent, status: RsvpStatus) => {
    const account = props.selectedAccount();
    if (!account || rsvpInFlight) return;
    rsvpInFlight = true;
    try {
      await rsvpListedCalendarEvent(account.id, evt.calendar_id, evt.id, status);
      props.onRsvped?.(evt.id, status);
      props.showToast(rsvpSentMessage(status, evt.title));
      props.onClose();
    } catch (err) {
      props.showFailure(rsvpFailureMessage(evt.title), err);
    } finally {
      rsvpInFlight = false;
    }
  };

  // Derived so titles, icons and click handlers track thread/event state and
  // selection changes while the wheel stays mounted
  const actions = createMemo(() => {
    const settings = props.actionSettings();
    const actions: { cls: string; title: string, keyHint?: string, icon: () => JSX.Element, onClick: (e: MouseEvent) => void }[] = [];

    // Event actions (when event prop is provided)
    if (props.event) {
      const evt = props.event;
      const cId = props.cardId;
      const evtSelectedCount = props.selectedEvents()[cId]?.size || 0;
      const evtSettings = props.eventActionSettings();
      const evtOrder = props.eventActionOrder();
      const can = eventActions(evt, props.selectedAccount()?.email ?? '');

      // Event action definitions
      const eventActionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; available: boolean }> = {
        quickReply: {
          cls: 'bulk-reply',
          title: can.emailGuests ? 'Email guests' : 'Reply to organizer',
          keyHint: 'r',
          icon: can.emailGuests ? ReplyAllIcon : ReplyIcon,
          onClick: (e) => { e.stopPropagation(); props.openEventQuickReply(evt.id); },
          available: can.reply || can.emailGuests
        },
        joinMeeting: {
          cls: 'event-join',
          title: 'Join meeting',
          icon: VideoIcon,
          onClick: (e) => { e.stopPropagation(); evt.hangout_link && openUrl(evt.hangout_link); },
          available: can.join && !meetingOver(evt, Date.now())
        },
        openCalendar: {
          cls: 'event-open',
          title: 'Open in Calendar',
          icon: CalendarIcon,
          onClick: (e) => { e.stopPropagation(); evt.html_link && openUrl(evt.html_link); },
          available: can.open
        },
        rsvpYes: {
          cls: evt.response_status === 'accepted' ? 'event-rsvp-active' : 'event-rsvp',
          title: 'Going',
          icon: CheckIcon,
          onClick: (e) => { e.stopPropagation(); rsvp(evt, 'accepted'); },
          available: can.rsvp
        },
        rsvpNo: {
          cls: evt.response_status === 'declined' ? 'event-rsvp-active' : 'event-rsvp',
          title: 'Not going',
          icon: ThumbsDownIcon,
          onClick: (e) => { e.stopPropagation(); rsvp(evt, 'declined'); },
          available: can.rsvp
        },
        delete: {
          cls: 'bulk-danger',
          title: 'Delete',
          icon: TrashIcon,
          onClick: (e) => {
            e.stopPropagation();
            // The second click of a double click would delete it again
            if (e.detail > 1) return;
            const button = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onDeleteEvent?.(evt, { left: button.left, bottom: button.bottom });
            props.onClose();
          },
          available: can.delete && !!props.onDeleteEvent
        }
      };

      // Add actions in order, respecting settings
      for (const key of evtOrder) {
        const def = eventActionDefs[key];
        if (!def || !def.available) continue;
        // Check if enabled (quickReply defaults to true)
        if (key === 'quickReply') {
          if (evtSettings[key] === false) continue;
        } else {
          if (!evtSettings[key]) continue;
        }
        actions.push({ cls: def.cls, title: def.title, keyHint: def.keyHint, icon: def.icon, onClick: def.onClick });
      }

      // Clear selection (if events are selected)
      if (evtSelectedCount > 0) {
        actions.push({
          cls: 'bulk-clear',
          title: 'Clear',
          keyHint: '⎋',
          icon: ClearIcon,
          onClick: (e) => { e.stopPropagation(); props.setSelectedEvents({ ...props.selectedEvents(), [cId]: new Set() }); }
        });
      }
    }

    // Thread actions (when thread prop is provided)
    if (props.thread && props.threadId) {
      // Get thread state for icon selection
      const isStarred = props.thread.labels?.includes("STARRED") ?? false;
      const isImportant = props.thread.labels?.includes("IMPORTANT") ?? false;
      const isRead = (props.thread.unread_count ?? 0) === 0;
      const isInInbox = props.thread.labels?.includes("INBOX") ?? true;

      const order = props.actionOrder();

      // Action definitions - use order from settings
      const actionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; bulkTitle?: string; bulkIcon?: () => JSX.Element; bulkOnClick?: (e: MouseEvent) => void }> = {};
      const cId = props.cardId;
      const tId = props.threadId;
      const getSelection = () => Array.from(props.selectedThreads()[cId] || []);

      actionDefs.quickReply = {
        cls: 'bulk-reply', title: 'Reply', keyHint: 'r', icon: ReplyIcon,
        onClick: (e) => { e.stopPropagation(); props.openThreadQuickReply(tId, cId); },
        bulkTitle: 'Batch Reply', bulkOnClick: (e) => { e.stopPropagation(); props.startBatchReply(cId, getSelection()); props.onClose(); }
      };
      actionDefs.quickForward = {
        cls: 'bulk-forward', title: 'Forward', keyHint: 'f', icon: ForwardIcon,
        onClick: (e) => { e.stopPropagation(); props.handleForward(tId, cId); }
      };
      actionDefs.archive = {
        cls: 'bulk-archive', title: isInInbox ? 'Archive' : 'Move to Inbox', keyHint: 'a', icon: isInInbox ? ArchiveIcon : InboxIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction(isInInbox ? 'archive' : 'inbox', [tId], cId); },
        bulkTitle: 'Archive', bulkIcon: ArchiveIcon, bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('archive', getSelection(), cId); }
      };
      actionDefs.star = {
        cls: 'bulk-star', title: isStarred ? 'Unstar' : 'Star', keyHint: 's', icon: isStarred ? StarFilledIcon : StarIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction(isStarred ? 'unstar' : 'star', [tId], cId); },
        bulkTitle: 'Star', bulkIcon: StarIcon, bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('star', getSelection(), cId); }
      };
      actionDefs.markRead = {
        cls: 'bulk-read', title: isRead ? 'Mark unread' : 'Mark read', keyHint: 'u', icon: isRead ? EyeClosedIcon : EyeOpenIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction(isRead ? 'unread' : 'read', [tId], cId); },
        bulkTitle: 'Mark read', bulkIcon: EyeOpenIcon, bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('read', getSelection(), cId); }
      };
      actionDefs.markImportant = {
        cls: 'bulk-important', title: isImportant ? 'Mark not important' : 'Mark important', keyHint: 'i', icon: isImportant ? ThumbsUpFilledIcon : ThumbsUpIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction(isImportant ? 'notImportant' : 'important', [tId], cId); },
        bulkTitle: 'Mark important', bulkIcon: ThumbsUpIcon, bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('important', getSelection(), cId); }
      };
      actionDefs.spam = {
        cls: 'bulk-spam', title: 'Report spam', keyHint: '!', icon: SpamIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction('spam', [tId], cId); },
        bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('spam', getSelection(), cId); }
      };
      actionDefs.trash = {
        cls: 'bulk-danger', title: 'Delete', keyHint: 'd', icon: TrashIcon,
        onClick: (e) => { e.stopPropagation(); props.handleThreadAction('trash', [tId], cId); },
        bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('trash', getSelection(), cId); }
      };

      if (props.selectedCount > 0) {
        // Bulk Actions - follow same order as single thread actions
        for (const key of order) {
          if (key === 'quickForward') continue; // No forward in bulk
          const def = actionDefs[key];
          if (!def) continue;
          // For quickReply, check if enabled (default true)
          if (key === 'quickReply') {
            if (settings[key] === false) continue;
          } else {
            if (!settings[key]) continue;
          }
          actions.push({
            cls: def.cls,
            title: def.bulkTitle || def.title,
            keyHint: def.keyHint,
            icon: def.bulkIcon || def.icon,
            onClick: def.bulkOnClick || def.onClick
          });
        }
        // Clear at end
        actions.push({ cls: 'bulk-clear', title: 'Clear', keyHint: '⎋', icon: ClearIcon, onClick: (e) => { e.stopPropagation(); props.setSelectedThreads({ ...props.selectedThreads(), [cId]: new Set() }); } });
      } else {
        // Single Thread Actions - use order
        for (const key of order) {
          const def = actionDefs[key];
          if (!def) continue;
          // Check settings (quickReply/quickForward default to true if not set)
          if (key === 'quickReply' || key === 'quickForward') {
            if (settings[key] === false) continue;
          } else {
            if (!settings[key]) continue;
          }
          actions.push({ cls: def.cls, title: def.title, keyHint: def.keyHint, icon: def.icon, onClick: def.onClick });
        }
      }
    }

    return actions;
  });

  const items = (): RadialItem[] => actions().map(action => ({
    id: action.cls + action.title,
    label: action.title,
    hint: action.keyHint,
    icon: action.icon,
    danger: action.cls === 'bulk-danger',
    selected: action.cls === 'event-rsvp-active',
    onSelect: action.onClick,
  }));

  return (
    <Show when={actions().length > 0}>
      <ActionWheel
        side="left"
        label={props.event ? "Event actions" : props.selectedCount > 0 ? "Actions for the selected threads" : "Thread actions"}
        actions={items()}
        open={props.open}
        center={props.selectedCount > 0 ? <span class="bulk-count">{props.selectedCount}</span> : undefined}
        onEscape={props.onClose}
      />
    </Show>
  );
};
