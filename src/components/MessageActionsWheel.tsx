import { ReplyIcon, ReplyAllIcon, ForwardIcon } from "./Icons";
import { ActionWheel } from "./ActionWheel";
import type { RadialItem } from "./RadialMenu";

// Message Actions Wheel Component - shared between ThreadView and EventView
// A missing handler leaves its action off the wheel
export const MessageActionsWheel = (props: {
  onReply?: () => void;
  onReplyAll?: () => void;
  replyAllTitle?: string;
  onForward: () => void;
  open: boolean;
  showHints?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) => {
  const actions = () => [
    props.onReply && { title: 'Reply', keyHint: 'R', icon: ReplyIcon, onClick: props.onReply },
    props.onReplyAll && {
      title: props.replyAllTitle ?? 'Reply All',
      keyHint: props.onReply ? '⇧R' : 'R',
      icon: ReplyAllIcon,
      onClick: props.onReplyAll,
    },
    { title: 'Forward', keyHint: 'F', icon: ForwardIcon, onClick: props.onForward },
  ].filter(a => !!a);

  const items = (): RadialItem[] => actions().map(action => ({
    id: action.title,
    label: action.title,
    hint: action.keyHint,
    icon: action.icon,
    onSelect: (e: MouseEvent) => { e.stopPropagation(); action.onClick(); },
  }));

  return (
    <div
      class="message-actions-wheel"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <ActionWheel
        side="right"
        label="Reply"
        actions={items()}
        open={props.open}
        showHints={props.showHints}
      />
    </div>
  );
};
