import { ReplyIcon, ReplyAllIcon, ForwardIcon } from "./Icons";
import { RadialMenu, type RadialItem } from "./RadialMenu";

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
      <RadialMenu
        label="Reply"
        items={items()}
        open={props.open}
        arc={{ start: -60, span: 120 }}
        radius={38}
        itemSize={28}
        overlap="grow"
        maxRadius={56}
        hints={props.showHints ? "always" : "hover"}
      />
    </div>
  );
};
