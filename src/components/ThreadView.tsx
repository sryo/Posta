import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from "solid-js";
import { MessageBody } from './MessageBody';
import { sendReaction, type FullThread, type FullMessage, type Attachment, type CalendarEvent } from "../api/tauri";
import type { RsvpStatus } from "../app/rsvp";
import { isCalendarAttachment } from "../app/attachments";
import { InviteBlock } from "./InviteBlock";
import { createCloseAfterAnimation } from "../shared/closeAfterAnimation";
import { isTypingTarget, hasCommandModifier, onActivateKey } from "../shared/keyboard";
import {
  findContent,
  formatFileSize,
  truncateMiddle,
  extractEmail,
  extractName,
  formatEmailDate,
  normalizeBase64Url,
  extractMessageHtml,
  extractMessageText,
  buildQuotedBody,
  buildForwardBody,
  addReplyPrefix,
  addForwardPrefix,
  smoothScroll,
  splitEmailList,
} from "../utils";
import {
  ArchiveIcon,
  InboxIcon,
  StarIcon,
  StarFilledIcon,
  TrashIcon,
  SpamIcon,
  ThumbsUpIcon,
  ThumbsUpFilledIcon,
  EyeOpenIcon,
  EyeClosedIcon,
  LabelIcon,
  CalendarIcon,
} from "./Icons";
import { SmartReplies } from "./SmartReplies";
import { ReactionButton } from "./ReactionButton";
import { CloseButton } from "./ComposeAtoms";
import { ComposeForm } from "./ComposeForm";
import { MessageActionsWheel } from "./MessageActionsWheel";
import { COLOR_HEX } from "../shared/constants";
import type { InlineComposeProps } from "./types";
import { findHeader, lastMessageFromOthers } from "../app/messages";

const normalizeMessageId = (id: string) => id.trim().replace(/^<|>$/g, '').toLowerCase();

export const ThreadView = (props: {
  thread: FullThread | null,
  loading: boolean,
  error: string | null,
  onRetry?: () => void,
  card: { name: string; color: string | null } | null,
  focusColor: string | null,
  onClose: () => void,
  focusedMessageIndex: number,
  onFocusChange: (index: number) => void,
  onOpenAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onDownloadAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onShowAttachmentMenu: (att: { messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null }) => void,
  // messageId is the RFC 2822 Message-ID header value (undefined when the
  // header is missing; the backend resolves missing ids itself)
  onReply: (to: string, cc: string, subject: string, quotedBody: string, messageId: string | undefined, isHtml: boolean) => void,
  onForward: (subject: string, body: string) => void,
  // Toolbar action props
  onAction: (action: string) => void,
  onOpenLabels: () => void,
  labelDrawerOpen?: boolean,
  onCloseLabelDrawer?: () => void,
  accountId: string,
  // Signed-in account's email; used to exclude self from reply-all recipients
  currentUserEmail?: string,
  isStarred: boolean,
  isRead: boolean,
  isImportant: boolean,
  isInInbox: boolean,
  labelCount: number,
  // Inline compose
  inlineCompose: InlineComposeProps | null,
  // Attachments from thread listing (with inline_data for thumbnails)
  threadAttachments?: Attachment[],
  // CID attachment data fetched on-demand (cid -> base64 data)
  cidAttachmentData?: Record<string, string>,
  onError?: (message: string) => void,
  // Whether a Gemini key is saved; smart replies ask the keychain when unknown
  geminiKeySaved?: boolean,
  // The event of an invite email, shown above the body of the message carrying it
  invite?: { event: CalendarEvent; rsvp: string | null | undefined; onAnswer: (status: RsvpStatus) => void; disabled: boolean } | null,
  // Opens a new event named after the thread, with its people as guests
  onCreateEvent?: () => void,
}) => {
  let messageRefs: (HTMLDivElement | undefined)[] = [];
  let contentRef: HTMLDivElement | undefined;
  const [hoveredMessageId, setHoveredMessageId] = createSignal<string | null>(null);
  const [wheelOpen, setWheelOpen] = createSignal(false);
  const [hoveredLinkUrl, setHoveredLinkUrl] = createSignal<string | null>(null);
  const [sendingReaction, setSendingReaction] = createSignal(false);
  // Message a forward was started from in this view; null means the forward
  // came from elsewhere (e.g. the card list) and sits under the last message
  const [forwardSourceId, setForwardSourceId] = createSignal<string | null>(null);
  createEffect(() => { if (!props.inlineCompose?.isForward) setForwardSourceId(null); });
  let hoverTimeout: number | undefined;

  // Handle sending a reaction
  const handleSendReaction = async (msgId: string, emoji: string) => {
    if (!props.thread || sendingReaction()) return;

    const msg = props.thread.messages.find(m => m.id === msgId);
    if (!msg) return;

    // Get the sender's email to send the reaction to
    const fromHeader = findHeader(msg.payload?.headers, 'From');
    if (!fromHeader) return;

    const toEmail = extractEmail(fromHeader);
    const messageIdHeader = findHeader(msg.payload?.headers, 'Message-ID') || msgId;

    setSendingReaction(true);

    try {
      await sendReaction(props.accountId, props.thread.id, messageIdHeader, emoji, toEmail);
    } catch (e) {
      console.error('Failed to send reaction:', e);
      props.onError?.(`Failed to send reaction: ${e}`);
    } finally {
      setSendingReaction(false);
    }
  };

  const { closing, close: handleClose } = createCloseAfterAnimation(() => props.onClose());

  // Gmail messages never change content under the same id (a draft edit gets
  // a new id), so a reloaded thread reuses the loaded message objects and
  // <For> keeps their rendered rows instead of rebuilding every body
  let loadedById = new Map<string, FullMessage>();
  // The message whose parts include the calendar file, else the first
  const inviteMessageId = createMemo(() => {
    if (!props.invite) return null;
    const list = props.thread?.messages ?? [];
    const hasCalendarPart = (parts: any[] | undefined): boolean => !!parts?.some(p =>
      isCalendarAttachment({ filename: p.filename ?? "", mime_type: p.mimeType ?? "" }) || hasCalendarPart(p.parts));
    return (list.find(m => hasCalendarPart(m.payload?.parts)) ?? list[0])?.id ?? null;
  });

  const messages = createMemo(() => {
    const next = new Map<string, FullMessage>();
    const list = (props.thread?.messages ?? []).map(m => {
      const kept = loadedById.get(m.id) ?? m;
      next.set(m.id, kept);
      return kept;
    });
    loadedById = next;
    return list;
  });

  // Scroll to the newest message when the thread loads or gains a message.
  // Actions such as star or a label change reload the same thread, and must
  // not pull the reader away from an earlier message.
  let scrolledTo: { id: string; count: number } | null = null;
  createEffect(() => {
    const loaded = props.thread;
    // Opening a thread clears it while it loads, so a reopened thread
    // starts at its newest message again
    if (!loaded) { scrolledTo = null; return; }
    const count = loaded.messages.length;
    if (scrolledTo?.id === loaded.id && count <= scrolledTo.count) return;
    scrolledTo = { id: loaded.id, count };
    if (contentRef) {
      requestAnimationFrame(() => {
        const thread = props.thread;
        if (!thread) return;
        const lastIndex = thread.messages.length - 1;
        const lastMessage = messageRefs[lastIndex];
        if (lastMessage) {
          lastMessage.scrollIntoView({ block: 'start' });
        } else {
          contentRef!.scrollTop = contentRef!.scrollHeight;
        }
      });
    }
  });

  // Link hover detection via event delegation
  const handleLinkHover = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link && link.href) {
      setHoveredLinkUrl(link.href);
    } else {
      setHoveredLinkUrl(null);
    }
  };

  const showMessageWheel = (msgId: string) => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    setHoveredMessageId(msgId);
    setWheelOpen(true);
  };

  const hideMessageWheel = () => {
    hoverTimeout = window.setTimeout(() => {
      setWheelOpen(false);
      setHoveredMessageId(null);
    }, 150);
  };

  // Reply / reply-all / forward for one message; shared by the per-message
  // actions wheel and the r / R / f shortcuts on the focused message
  const messageActions = (msg: FullMessage) => {
    const headers = msg.payload?.headers || [];
    const from = findHeader(headers, 'From') || 'Unknown';
    const date = findHeader(headers, 'Date') || '';
    const subject = findHeader(headers, 'Subject') || '';
    const rfcMessageId = findHeader(headers, 'Message-ID');
    const isHtml = msg.payload?.mimeType === 'text/html' || !!findContent(msg.payload?.parts, 'text/html');
    const quotedBody = () => buildQuotedBody(date, from, extractMessageText(msg.payload, msg.snippet));
    const addresses = (header: string) => splitEmailList(findHeader(headers, header) || '').map(extractEmail);

    // Recipients for a reply: to the sender (Reply-To wins over From), or,
    // when replying to one's own message, back to its original recipients.
    // Reply-all adds everyone else once, never the current user.
    const recipients = (all: boolean) => {
      const me = props.currentUserEmail?.toLowerCase();
      const seen = new Set<string>(me ? [me] : []);
      const unique = (list: string[]) => list.filter(e => {
        const key = e.toLowerCase();
        if (!e || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const fromMe = !!me && extractEmail(from).toLowerCase() === me;
      if (fromMe && !findHeader(headers, 'Reply-To')) {
        const to = unique(addresses('To'));
        if (to.length > 0) return { to: to.join(', '), cc: all ? unique(addresses('Cc')).join(', ') : '' };
      }
      const replyTo = unique(addresses('Reply-To'));
      const sender = extractEmail(from);
      seen.add(sender.toLowerCase());
      const to = replyTo.length > 0 ? replyTo.join(', ') : sender;
      return { to, cc: all ? unique([...addresses('To'), ...addresses('Cc')]).join(', ') : '' };
    };

    const reply = (all: boolean, prefix = '') => {
      const { to, cc } = recipients(all);
      props.onReply(to, cc, addReplyPrefix(subject), prefix + quotedBody(), rfcMessageId, isHtml);
    };

    return {
      reply: (prefix = '') => reply(false, prefix),
      replyAll: () => reply(true),
      forward: () => {
        const fwdBody = buildForwardBody({
          from, date, subject,
          to: findHeader(headers, 'To'),
          cc: findHeader(headers, 'Cc'),
          body: extractMessageText(msg.payload, msg.snippet),
        });
        setForwardSourceId(msg.id);
        props.onForward(addForwardPrefix(subject), fwdBody);
      },
    };
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const isTyping = isTypingTarget(e.target);

    if (e.key === 'Escape') {
      if (isTyping) return; // input-level handlers (e.g. ComposeForm) own Escape
      if (props.inlineCompose) { props.inlineCompose.onClose(); return; }
      if (props.labelDrawerOpen) { props.onCloseLabelDrawer?.(); return; }
      handleClose();
      return;
    }
    if (isTyping || hasCommandModifier(e) || !props.thread) return;

    // The drawer covers the thread, so only its own toggle stays live
    if (props.labelDrawerOpen) {
      if (e.key === 'l') { e.preventDefault(); props.onCloseLabelDrawer?.(); }
      return;
    }

    if (e.key === 'a') { e.preventDefault(); props.onAction(props.isInInbox ? 'archive' : 'inbox'); return; }
    if (e.key === 's') { e.preventDefault(); props.onAction(props.isStarred ? 'unstar' : 'star'); return; }
    if (e.key === 'u') { e.preventDefault(); props.onAction(props.isRead ? 'unread' : 'read'); return; }
    if (e.key === 'i') { e.preventDefault(); props.onAction(props.isImportant ? 'notImportant' : 'important'); return; }
    if (e.key === '!') { e.preventDefault(); props.onAction('spam'); return; }
    if (e.key === '#' || e.key === 'd') { e.preventDefault(); props.onAction('trash'); return; }
    if (e.key === 'l') { e.preventDefault(); props.onOpenLabels(); return; }
    if (e.key === 'e' && props.onCreateEvent) { e.preventDefault(); props.onCreateEvent(); return; }

    // Reply shortcuts advertised by the focused message's actions wheel
    if ((e.key === 'r' || e.key === 'R' || e.key === 'f') && !props.inlineCompose) {
      const msg = props.thread.messages[props.focusedMessageIndex];
      if (!msg) return;
      e.preventDefault();
      const actions = messageActions(msg);
      if (e.key === 'r') actions.reply();
      else if (e.key === 'R') actions.replyAll();
      else actions.forward();
      return;
    }

    // j/k for message navigation
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const maxIndex = props.thread.messages.length - 1;
      const newIndex = e.key === 'j'
        ? Math.min(props.focusedMessageIndex + 1, maxIndex)
        : Math.max(props.focusedMessageIndex - 1, 0);

      if (newIndex !== props.focusedMessageIndex) {
        props.onFocusChange(newIndex);
        messageRefs[newIndex]?.scrollIntoView({ behavior: smoothScroll(), block: 'nearest' });
      }
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class={`thread-overlay ${closing() ? 'closing' : ''}`} style={props.focusColor ? { '--message-focused-color': props.focusColor } as any : undefined}>
      <div class="thread-floating-bar">
        {/* Row 1: Close + Subject + Card indicator */}
        <div class="thread-floating-bar-row">
          <CloseButton onClick={handleClose} />
          <div class="thread-bar-subject">
            <Show when={props.thread} fallback={<Show when={props.loading}><span>Loading...</span></Show>}>
              <h2>{findHeader(props.thread?.messages[0]?.payload?.headers, 'Subject') || '(No Subject)'}</h2>
            </Show>
          </div>
          <Show when={props.card}>
            <div
              class="thread-bar-card"
              style={props.card?.color ? {
                background: COLOR_HEX[props.card.color] + '20',
                color: COLOR_HEX[props.card.color]
              } : {
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)'
              }}
            >
              {props.card?.name}
            </div>
          </Show>
        </div>

        {/* Row 2: Actions */}
        <Show when={props.thread}>
          <div class="thread-floating-bar-row thread-bar-actions">
            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isInInbox ? 'archive' : 'inbox')} title={props.isInInbox ? 'Archive' : 'Move to Inbox'}>
              {props.isInInbox ? <ArchiveIcon /> : <InboxIcon />}
              <span class="thread-toolbar-label">{props.isInInbox ? 'Archive' : 'Inbox'}</span>
              <span class="shortcut-hint">A</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isStarred ? 'unstar' : 'star')} title={props.isStarred ? "Unstar" : "Star"}>
              {props.isStarred ? <StarFilledIcon /> : <StarIcon />}
              <span class="thread-toolbar-label">{props.isStarred ? 'Unstar' : 'Star'}</span>
              <span class="shortcut-hint">S</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isRead ? 'unread' : 'read')} title={props.isRead ? "Mark unread" : "Mark read"}>
              {props.isRead ? <EyeClosedIcon /> : <EyeOpenIcon />}
              <span class="thread-toolbar-label">{props.isRead ? 'Unread' : 'Read'}</span>
              <span class="shortcut-hint">U</span>
            </button>

            <button class="thread-toolbar-btn" onClick={() => props.onAction(props.isImportant ? 'notImportant' : 'important')} title={props.isImportant ? "Unmark important" : "Mark important"}>
              {props.isImportant ? <ThumbsUpFilledIcon /> : <ThumbsUpIcon />}
              <span class="thread-toolbar-label">{props.isImportant ? 'Unmark' : 'Important'}</span>
              <span class="shortcut-hint">I</span>
            </button>

            <div class="thread-toolbar-divider" />

            <button class="thread-toolbar-btn" onClick={props.onOpenLabels} title="Manage labels">
              <LabelIcon />
              <span class="thread-toolbar-label">Labels{props.labelCount > 0 ? ` (${props.labelCount})` : ''}</span>
              <span class="shortcut-hint">L</span>
            </button>

            <Show when={props.onCreateEvent}>
              <button class="thread-toolbar-btn" onClick={() => props.onCreateEvent!()} title="Create event from this thread">
                <CalendarIcon />
                <span class="thread-toolbar-label">Create event…</span>
                <span class="shortcut-hint">E</span>
              </button>
            </Show>

            <div class="thread-toolbar-divider" />

            <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('spam')} title="Report spam">
              <SpamIcon />
              <span class="thread-toolbar-label">Spam</span>
              <span class="shortcut-hint">!</span>
            </button>

            <button class="thread-toolbar-btn thread-toolbar-btn-danger" onClick={() => props.onAction('trash')} title="Delete">
              <TrashIcon />
              <span class="thread-toolbar-label">Delete</span>
              <span class="shortcut-hint">#</span>
            </button>
          </div>
        </Show>
      </div>

      <div class="thread-content" ref={contentRef} onMouseOver={handleLinkHover} onMouseOut={() => setHoveredLinkUrl(null)}>
        <Show when={props.loading}>
          <div class="thread-skeleton">
            <div class="skeleton-message">
              <div class="skeleton-header">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-meta">
                  <div class="skeleton-line skeleton-name"></div>
                  <div class="skeleton-line skeleton-date"></div>
                </div>
              </div>
              <div class="skeleton-body">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line skeleton-short"></div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.error}>
          <div class="error-message">
            {props.error}
            <Show when={props.onRetry}>
              <button class="retry-btn" onClick={() => props.onRetry?.()}>Try again</button>
            </Show>
          </div>
        </Show>

        <Show when={props.thread}>
          <div class="messages-list">
            <For each={messages()}>
              {(msg, index) => {
                const headers = msg.payload?.headers || [];
                const from = findHeader(headers, 'From') || 'Unknown';
                const date = findHeader(headers, 'Date') || '';

                const getBody = () => extractMessageHtml(msg.payload, msg.snippet);

                // Extract attachments from message parts, enriched with inline_data from threadAttachments
                const getAttachments = () => {
                  const attachments: { filename: string; mimeType: string; size: number; attachmentId?: string; inlineData?: string }[] = [];
                  const payload = msg.payload;
                  const fileParts: any[] = [];
                  const findFileParts = (parts: any[]) => {
                    parts?.forEach(part => {
                      if (part.filename && part.filename.length > 0) fileParts.push(part);
                      if (part.parts) findFileParts(part.parts);
                    });
                  };
                  findFileParts(payload?.parts?.length ? payload.parts : payload?.filename ? [payload] : []);

                  // Gmail issues a new attachmentId on every fetch, so the
                  // listing's ids often differ from these; fall back to
                  // pairing same-named files in order, each listing entry once
                  const listed = props.threadAttachments?.filter(a => a.message_id === msg.id) ?? [];
                  const partIds = new Set(fileParts.map(p => p.body?.attachmentId));
                  const unpaired = listed.filter(a => !partIds.has(a.attachment_id));
                  for (const part of fileParts) {
                    const attachmentId = part.body?.attachmentId;
                    let threadAtt = listed.find(a => a.attachment_id === attachmentId);
                    if (!threadAtt) {
                      const i = unpaired.findIndex(a => a.filename === part.filename);
                      if (i !== -1) threadAtt = unpaired.splice(i, 1)[0];
                    }
                    attachments.push({
                      filename: part.filename,
                      mimeType: part.mimeType || 'application/octet-stream',
                      size: part.body?.size || 0,
                      attachmentId,
                      inlineData: threadAtt?.inline_data || part.body?.data,
                    });
                  }
                  return attachments;
                };

                // Memo (not snapshot): threadAttachments is a live getter that
                // re-reads cardThreads, so inline_data arriving after this row
                // mounts must re-render the thumbnails (same reason MessageBody
                // wraps its lookup in createMemo)
                const attachments = createMemo(() => getAttachments());
                const isImage = (mime: string) => mime.startsWith('image/');
                const isPdf = (mime: string) => mime === 'application/pdf';

                const actions = messageActions(msg);
                const getRfcMessageId = () => findHeader(headers, 'Message-ID');
                // One chip per emoji, naming each sender once
                const receivedReactions = createMemo(() => {
                  const id = getRfcMessageId();
                  if (!id) return [];
                  const target = normalizeMessageId(id);
                  const me = props.currentUserEmail?.toLowerCase();
                  const groups = new Map<string, { emoji: string; senders: Map<string, string> }>();
                  for (const m of props.thread!.messages) {
                    const r = m.reaction;
                    if (!r || normalizeMessageId(r.in_reply_to) !== target) continue;
                    const addr = r.from_addr.toLowerCase();
                    const name = addr === me ? 'You' : extractName(findHeader(m.payload?.headers, 'From') || '') || r.from_addr;
                    const group = groups.get(r.emoji) ?? { emoji: r.emoji, senders: new Map<string, string>() };
                    if (!group.senders.has(addr)) group.senders.set(addr, name);
                    groups.set(r.emoji, group);
                  }
                  return Array.from(groups.values(), g => ({ emoji: g.emoji, names: Array.from(g.senders.values()) }));
                });

                // Match either the Gmail API id or the RFC Message-ID, since
                // onReply now reports the RFC id back through inlineCompose
                const isReplyingToThis = () => {
                  const rid = props.inlineCompose?.replyToMessageId;
                  return rid != null && (rid === msg.id || rid === getRfcMessageId());
                };
                const isForwardingFromThis = () => {
                  if (!props.inlineCompose?.isForward) return false;
                  const source = forwardSourceId();
                  const sourceShown = source != null && props.thread!.messages.some(m => m.id === source);
                  return sourceShown ? source === msg.id : index() === props.thread!.messages.length - 1;
                };
                const showInlineCompose = () => isReplyingToThis() || isForwardingFromThis();

                return (
                  <div
                    class={`message-row ${showInlineCompose() ? 'with-compose' : ''} ${props.inlineCompose?.resizing ? 'resizing' : ''}`}
                    onMouseEnter={() => showMessageWheel(msg.id)}
                    onMouseLeave={hideMessageWheel}
                  >
                    <div
                      class={`message-card ${props.focusedMessageIndex === index() ? 'message-focused' : ''}`}
                      ref={(el) => { messageRefs[index()] = el; }}
                    >
                      <div class="message-header">
                        <div class="message-sender">{from}</div>
                        <div class="message-header-actions">
                          <Show when={!msg.reaction && extractEmail(from).toLowerCase() !== props.currentUserEmail?.toLowerCase()}>
                            <ReactionButton
                              onSelect={(emoji) => handleSendReaction(msg.id, emoji)}
                              sending={sendingReaction()}
                            />
                          </Show>
                          <div class="message-date">{formatEmailDate(date)}</div>
                        </div>
                      </div>
                      {/* Message Actions Wheel - show for focused or hovered message */}
                      <Show when={((hoveredMessageId() === msg.id && wheelOpen()) || props.focusedMessageIndex === index()) && !showInlineCompose()}>
                        <MessageActionsWheel
                          onReply={() => actions.reply()}
                          onReplyAll={actions.replyAll}
                          onForward={actions.forward}
                          open={true}
                          showHints={props.focusedMessageIndex === index()}
                          onMouseEnter={() => showMessageWheel(msg.id)}
                          onMouseLeave={hideMessageWheel}
                        />
                      </Show>
                      <Show when={props.invite && inviteMessageId() === msg.id}>
                        <InviteBlock
                          invite={props.invite!.event}
                          rsvp={props.invite!.rsvp}
                          onAnswer={props.invite!.onAnswer}
                          disabled={props.invite!.disabled}
                          showTitle
                          size="md"
                        />
                      </Show>
                      <Show
                        when={msg.reaction}
                        fallback={
                          <MessageBody
                            body={getBody()}
                            cidAttachmentData={props.cidAttachmentData}
                            msgPayloadParts={msg.payload?.parts}
                            msgId={msg.id}
                            threadAttachments={props.threadAttachments}
                          />
                        }
                      >
                        {(reaction) => <div class="message-reaction-note">Reacted {reaction().emoji}</div>}
                      </Show>
                      <Show when={receivedReactions().length > 0}>
                        <div class="message-reactions">
                          <For each={receivedReactions()}>
                            {(r) => <span class="message-reaction" title={r.names.join(', ')}>{r.names.length > 1 ? `${r.emoji} ${r.names.length}` : r.emoji}</span>}
                          </For>
                        </div>
                      </Show>
                      <Show when={attachments().length > 0}>
                        <div class="message-attachments">
                          <For each={attachments()}>
                            {(att) => {
                              const handleContextMenu = (e: MouseEvent) => {
                                e.preventDefault();
                                props.onShowAttachmentMenu({
                                  messageId: msg.id,
                                  attachmentId: att.attachmentId || "",
                                  filename: att.filename,
                                  mimeType: att.mimeType,
                                  inlineData: att.inlineData || null
                                });
                              };
                              const hasThumb = att.inlineData && isImage(att.mimeType);
                              const open = () => props.onOpenAttachment(msg.id, att.attachmentId, att.filename, att.mimeType, att.inlineData);
                              return (
                                <div
                                  class="attachment-thumb"
                                  role="button"
                                  tabIndex={0}
                                  title={`${att.filename} (${formatFileSize(att.size)})`}
                                  onClick={open}
                                  on:keydown={onActivateKey(open)}
                                  onContextMenu={handleContextMenu}
                                >
                                  {hasThumb ? (
                                    <img
                                      class="attachment-preview"
                                      src={`data:${att.mimeType};base64,${normalizeBase64Url(att.inlineData!)}`}
                                      alt={att.filename}
                                    />
                                  ) : (
                                    <div class={`attachment-icon ${isImage(att.mimeType) ? 'image' : isPdf(att.mimeType) ? 'pdf' : 'file'}`}>
                                      {isImage(att.mimeType) ? '🖼️' : isPdf(att.mimeType) ? '📄' : '📎'}
                                    </div>
                                  )}
                                  <div class="attachment-info">
                                    <div class="attachment-name">{truncateMiddle(att.filename, 20)}</div>
                                    <div class="attachment-size">{formatFileSize(att.size)}</div>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                    {/* Resize handle and inline compose form */}
                    <Show when={showInlineCompose() && props.inlineCompose}>
                      <div
                        class="inline-resize-handle"
                        onMouseDown={props.inlineCompose!.onResizeStart}
                      />
                      <div class="inline-compose">
                        <ComposeForm
                          mode={props.inlineCompose!.isForward ? 'forward' : 'reply'}
                          to={props.inlineCompose!.to}
                          setTo={props.inlineCompose!.setTo}
                          cc={props.inlineCompose!.cc}
                          setCc={props.inlineCompose!.setCc}
                          bcc={props.inlineCompose!.bcc}
                          setBcc={props.inlineCompose!.setBcc}
                          showCcBcc={props.inlineCompose!.showCcBcc}
                          setShowCcBcc={props.inlineCompose!.setShowCcBcc}
                          body={props.inlineCompose!.body}
                          setBody={props.inlineCompose!.setBody}
                          attachments={props.inlineCompose!.attachments}
                          onRemoveAttachment={props.inlineCompose!.onRemoveAttachment}
                          onFileSelect={props.inlineCompose!.onFileSelect}
                          fileInputId={`inline-file-input-${msg.id}`}
                          error={props.inlineCompose!.error}
                          draftSaving={props.inlineCompose!.draftSaving}
                          draftSaved={props.inlineCompose!.draftSaved}
                          sending={props.inlineCompose!.sending}
                          onSend={props.inlineCompose!.onSend}
                          onClose={props.inlineCompose!.onClose}
                          onInput={props.inlineCompose!.onInput}
                          focusBody={props.inlineCompose!.focusBody}
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
          <SmartReplies
            accountId={props.accountId}
            threadId={props.thread!.id}
            lastMessageId={props.thread!.messages[props.thread!.messages.length - 1]?.id}
            keySaved={props.geminiKeySaved}
            onSelect={(suggestion) => {
              const target = lastMessageFromOthers(props.thread!.messages, props.currentUserEmail ?? '');
              if (target) messageActions(target).reply(suggestion);
            }}
          />
        </Show>
      </div>


      {/* Link hover status bar */}
      <Show when={hoveredLinkUrl()}>
        <div class="link-status-bar">{hoveredLinkUrl()}</div>
      </Show>
    </div>
  );
};
