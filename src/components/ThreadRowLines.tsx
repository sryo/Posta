import { Show, type JSX } from "solid-js";
import type { Thread } from "../api/tauri";
import { participantNames } from "../app/people";
import { decodeHtmlEntities } from "../utils";
import { AttachmentIcon } from "./Icons";

// What a thread row says, the same in a card and in a new card's preview:
// who wrote (unread dotted), the paperclip when no attachment shows below,
// when; then the subject, and the snippet or the invite's lines, then the
// attachments. A card's row adds its own controls in `beforeTime`.
export function ThreadRowLines(props: {
  thread: Thread;
  ownEmails: string[];
  time: string;
  subject?: string;
  attachmentsShown: boolean;
  beforeTime?: JSX.Element;
  invite?: JSX.Element;
  attachments?: JSX.Element;
}) {
  const t = () => props.thread;
  return (
    <>
      <div class="thread-row">
        <div class="unread-dot" classList={{ "read": t().unread_count === 0 }} aria-hidden="true"></div>
        <span class="thread-participants" title={t().participants.join(", ")}>
          {participantNames(t().participants, props.ownEmails)}
        </span>
        <Show when={t().has_attachment && !t().calendar_event && !props.attachmentsShown}>
          <span class="thread-indicator" title="Has attachment">
            <AttachmentIcon size="meta" strong />
          </span>
        </Show>
        {props.beforeTime}
        <span class="thread-time">{props.time}</span>
      </div>
      <div class="thread-subject" title={t().subject}>{props.subject ?? t().subject}</div>
      <Show when={props.invite} fallback={<div class="thread-snippet">{decodeHtmlEntities(t().snippet)}</div>}>
        {props.invite}
      </Show>
      {props.attachments}
    </>
  );
}
