import { For, type JSX } from "solid-js";
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  rsvpCalendarEvent,
  type Account,
  type Thread,
  type GoogleCalendarEvent,
} from "../api/tauri";
import {
  ClearIcon,
  ReplyIcon,
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

// Half Pie Menu Component
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
  showToast: (message?: string) => void;
}) => {
  const settings = props.actionSettings();
  const actions: { cls: string; title: string, keyHint?: string, icon: () => JSX.Element, onClick: (e: MouseEvent) => void }[] = [];
  const containerRef = (el: HTMLDivElement) => {
    // Simple animation trigger
    setTimeout(() => el.classList.add('open'), 10);
  };

  // Event actions (when event prop is provided)
  if (props.event) {
    const evt = props.event;
    const cId = props.cardId;
    const evtSelectedCount = props.selectedEvents()[cId]?.size || 0;
    const evtSettings = props.eventActionSettings();
    const evtOrder = props.eventActionOrder();

    // Event action definitions
    const eventActionDefs: Record<string, { cls: string; title: string; keyHint?: string; icon: () => JSX.Element; onClick: (e: MouseEvent) => void; available: boolean }> = {
      quickReply: {
        cls: 'bulk-reply',
        title: 'Reply to organizer',
        keyHint: 'r',
        icon: ReplyIcon,
        onClick: (e) => { e.stopPropagation(); props.openEventQuickReply(evt.id); },
        available: !!evt.organizer
      },
      joinMeeting: {
        cls: 'event-join',
        title: 'Join meeting',
        keyHint: 'j',
        icon: VideoIcon,
        onClick: (e) => { e.stopPropagation(); evt.hangout_link && openUrl(evt.hangout_link); },
        available: !!evt.hangout_link
      },
      openCalendar: {
        cls: 'event-open',
        title: 'Open in Calendar',
        keyHint: 'o',
        icon: CalendarIcon,
        onClick: (e) => { e.stopPropagation(); evt.html_link && openUrl(evt.html_link); },
        available: !!evt.html_link
      },
      rsvpYes: {
        cls: evt.response_status === 'accepted' ? 'event-rsvp-active' : 'event-rsvp',
        title: 'RSVP Yes',
        keyHint: 'y',
        icon: CheckIcon,
        onClick: async (e) => {
          e.stopPropagation();
          const account = props.selectedAccount();
          if (!account) return;
          try {
            await rsvpCalendarEvent(account.id, evt.id, 'accepted');
            props.showToast('RSVP: Yes');
            props.onClose();
          } catch (err) {
            props.showToast('Failed to RSVP');
          }
        },
        available: true
      },
      rsvpNo: {
        cls: evt.response_status === 'declined' ? 'event-rsvp-active' : 'event-rsvp',
        title: 'RSVP No',
        keyHint: 'n',
        icon: ThumbsDownIcon,
        onClick: async (e) => {
          e.stopPropagation();
          const account = props.selectedAccount();
          if (!account) return;
          try {
            await rsvpCalendarEvent(account.id, evt.id, 'declined');
            props.showToast('RSVP: No');
            props.onClose();
          } catch (err) {
            props.showToast('Failed to RSVP');
          }
        },
        available: true
      },
      delete: {
        cls: 'bulk-danger',
        title: 'Delete',
        keyHint: 'd',
        icon: TrashIcon,
        onClick: async (e) => {
          e.stopPropagation();
          // Decline and remove from view
          const account = props.selectedAccount();
          if (!account) return;
          try {
            await rsvpCalendarEvent(account.id, evt.id, 'declined');
            props.showToast('Event declined');
            props.onClose();
          } catch (err) {
            props.showToast('Failed to decline event');
          }
        },
        available: true
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
        keyHint: 'ESC',
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
      cls: 'bulk-important', title: isImportant ? 'Unmark important' : 'Mark important', keyHint: 'i', icon: isImportant ? ThumbsUpFilledIcon : ThumbsUpIcon,
      onClick: (e) => { e.stopPropagation(); props.handleThreadAction(isImportant ? 'notImportant' : 'important', [tId], cId); },
      bulkTitle: 'Mark important', bulkIcon: ThumbsUpIcon, bulkOnClick: (e) => { e.stopPropagation(); props.handleThreadAction('important', getSelection(), cId); }
    };
    actionDefs.spam = {
      cls: 'bulk-spam', title: 'Report spam', keyHint: 'x', icon: SpamIcon,
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
      actions.push({ cls: 'bulk-clear', title: 'Clear', keyHint: 'ESC', icon: ClearIcon, onClick: (e) => { e.stopPropagation(); props.setSelectedThreads({ ...props.selectedThreads(), [cId]: new Set() }); } });
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

  if (actions.length === 0) return null;

  // Positioning Logic
  const innerRadius = 38;
  const numActions = actions.length;

  return (
    <div class={`bulk-actions-wheel ${props.open ? 'open' : ''}`} ref={containerRef}>
      {props.selectedCount > 0 && <span class="bulk-count">{props.selectedCount}</span>}
      <For each={actions}>
        {(action, i) => {
          let x = -innerRadius;
          let y = 0;
          if (numActions > 1) {
            // 120 degree arc from 4pi/3 down to 2pi/3.
            // In DOM coords (y increases downward):
            // i=0 -> 4pi/3 (240 deg) -> top-left
            // i=max -> 2pi/3 (120 deg) -> bottom-left
            // This matches context menu order: first item at top
            const angle = (4 * Math.PI / 3) - (i() / (numActions - 1)) * (2 * Math.PI / 3);
            x = innerRadius * Math.cos(angle);
            y = innerRadius * Math.sin(angle);
          }

          return (
            <button
              class={`bulk-btn ${action.cls}`}
              style={{
                left: `calc(50% + ${x.toFixed(1)}px - 14px)`,
                top: `calc(50% + ${y.toFixed(1)}px - 14px)`
              }}
              onClick={action.onClick}
              title={action.title}
            >
              <div style={{ width: '14px', height: '14px' }}>
                <action.icon />
              </div>
              {action.keyHint && <span class="action-key-hint">{action.keyHint}</span>}
            </button>
          );
        }}
      </For>
    </div>
  );
};
