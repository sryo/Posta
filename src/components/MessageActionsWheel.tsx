import { Show, For } from "solid-js";
import { ReplyIcon, ReplyAllIcon, ForwardIcon } from "./Icons";

// Message Actions Wheel Component - shared between ThreadView and EventView
export const MessageActionsWheel = (props: {
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  open: boolean;
  showHints?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) => {
  const actions = [
    { title: 'Reply', keyHint: 'R', icon: ReplyIcon, onClick: props.onReply },
    { title: 'Reply All', keyHint: 'A', icon: ReplyAllIcon, onClick: props.onReplyAll },
    { title: 'Forward', keyHint: 'F', icon: ForwardIcon, onClick: props.onForward },
  ];

  const innerRadius = 38;
  const numActions = actions.length;

  return (
    <div
      class={`message-actions-wheel ${props.open ? 'open' : ''}`}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <For each={actions}>
        {(action, i) => {
          // Arc on RIGHT side: from -60deg (top-right) to +60deg (bottom-right)
          const angle = (-Math.PI / 3) + (i() / (numActions - 1)) * (2 * Math.PI / 3);
          const x = innerRadius * Math.cos(angle);
          const y = innerRadius * Math.sin(angle);

          return (
            <button
              class="message-action-btn"
              style={{
                left: `calc(50% + ${x.toFixed(1)}px - 13px)`,
                top: `calc(50% + ${y.toFixed(1)}px - 13px)`
              }}
              onClick={(e) => { e.stopPropagation(); action.onClick(); }}
              title={action.title}
            >
              <div style={{ width: '14px', height: '14px' }}>
                <action.icon />
              </div>
              <Show when={props.showHints}>
                <span class="action-key-hint">{action.keyHint}</span>
              </Show>
            </button>
          );
        }}
      </For>
    </div>
  );
};
