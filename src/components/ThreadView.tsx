import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import DOMPurify from 'dompurify';
import { MessageBody, DOMPURIFY_CONFIG } from './MessageBody';
import { sendReaction, type FullThread, type Attachment } from "../api/tauri";
import {
  findContent,
  formatFileSize,
  truncateMiddle,
  extractEmail,
  formatEmailDate,
  normalizeBase64Url,
  extractMessageBody,
  stripHtml,
  buildQuotedBody,
  addReplyPrefix,
  addForwardPrefix,
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
} from "./Icons";
import { SmartReplies } from "./SmartReplies";
import { ReactionButton } from "./ReactionButton";
import { CloseButton } from "./ComposeAtoms";
import { ComposeForm } from "./ComposeForm";
import { MessageActionsWheel } from "./MessageActionsWheel";
import { COLOR_HEX } from "../shared/constants";
import type { InlineComposeProps } from "./types";

export const ThreadView = (props: {
  thread: FullThread | null,
  loading: boolean,
  error: string | null,
  card: { name: string; color: string | null } | null,
  focusColor: string | null,
  onClose: () => void,
  focusedMessageIndex: number,
  onFocusChange: (index: number) => void,
  onOpenAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onDownloadAttachment: (messageId: string, attachmentId: string | undefined, filename: string, mimeType: string, inlineData?: string) => void,
  onShowAttachmentMenu: (att: { messageId: string; attachmentId: string; filename: string; mimeType: string; inlineData: string | null }) => void,
  onReply: (to: string, cc: string, subject: string, quotedBody: string, messageId: string, isHtml: boolean) => void,
  onForward: (subject: string, body: string) => void,
  // Toolbar action props
  onAction: (action: string) => void,
  onOpenLabels: () => void,
  accountId: string,
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
}) => {
  let messageRefs: (HTMLDivElement | undefined)[] = [];
  let contentRef: HTMLDivElement | undefined;
  const [hoveredMessageId, setHoveredMessageId] = createSignal<string | null>(null);
  const [wheelOpen, setWheelOpen] = createSignal(false);
  const [hoveredLinkUrl, setHoveredLinkUrl] = createSignal<string | null>(null);
  const [closing, setClosing] = createSignal(false);
  const [sendingReaction, setSendingReaction] = createSignal(false);
  let hoverTimeout: number | undefined;

  // Handle sending a reaction
  const handleSendReaction = async (msgId: string, emoji: string) => {
    if (!props.thread || sendingReaction()) return;

    const msg = props.thread.messages.find(m => m.id === msgId);
    if (!msg) return;

    // Get the sender's email to send the reaction to
    const fromHeader = msg.payload?.headers?.find(h => h.name === 'From')?.value;
    if (!fromHeader) return;

    const toEmail = extractEmail(fromHeader);
    const messageIdHeader = msg.payload?.headers?.find(h => h.name === 'Message-ID')?.value || msgId;

    setSendingReaction(true);

    try {
      await sendReaction(props.accountId, props.thread.id, messageIdHeader, emoji, toEmail);
    } catch (e) {
      console.error('Failed to send reaction:', e);
    } finally {
      setSendingReaction(false);
    }
  };

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => props.onClose(), 200); // Match animation duration
  };

  // Scroll to newest message when thread loads
  createEffect(() => {
    if (props.thread && contentRef) {
      requestAnimationFrame(() => {
        const lastIndex = props.thread!.messages.length - 1;
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

  const handleKeyDown = (e: KeyboardEvent) => {
    const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (isTyping) return; // input-level handlers (e.g. ComposeForm) own Escape
      if (props.inlineCompose) { props.inlineCompose.onClose(); return; }
      handleClose();
      return;
    }
    if (!isTyping && props.thread) {
      if (e.key === 'a') { e.preventDefault(); props.onAction(props.isInInbox ? 'archive' : 'inbox'); return; }
      if (e.key === 's') { e.preventDefault(); props.onAction(props.isStarred ? 'unstar' : 'star'); return; }
      if (e.key === 'd') { e.preventDefault(); props.onAction('trash'); return; }
      if (e.key === 'l') { e.preventDefault(); props.onOpenLabels(); return; }
    }

    // j/k for message navigation
    if (!isTyping && props.thread && (e.key === 'j' || e.key === 'k')) {
      e.preventDefault();
      const maxIndex = props.thread.messages.length - 1;
      let newIndex = props.focusedMessageIndex;

      if (e.key === 'j') {
        newIndex = Math.min(props.focusedMessageIndex + 1, maxIndex);
      } else if (e.key === 'k') {
        newIndex = Math.max(props.focusedMessageIndex - 1, 0);
      }

      if (newIndex !== props.focusedMessageIndex) {
        props.onFocusChange(newIndex);
        // Scroll to focused message
        messageRefs[newIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            <Show when={props.thread} fallback={<span>Loading...</span>}>
              <h2>{props.thread?.messages[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '(No Subject)'}</h2>
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
          <div class="error-message">{props.error}</div>
        </Show>

        <Show when={props.thread}>
          <div class="messages-list">
            <For each={props.thread!.messages}>
              {(msg, index) => {
                const headers = msg.payload?.headers || [];
                const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                const date = headers.find(h => h.name === 'Date')?.value || '';

                const getBody = () => extractMessageBody(msg.payload, msg.snippet);

                // Extract attachments from message parts, enriched with inline_data from threadAttachments
                const getAttachments = () => {
                  const attachments: { filename: string; mimeType: string; size: number; attachmentId?: string; inlineData?: string }[] = [];
                  const findAttachments = (parts: any[]) => {
                    parts?.forEach(part => {
                      if (part.filename && part.filename.length > 0) {
                        const attachmentId = part.body?.attachmentId;
                        // Look up inline_data from threadAttachments if available
                        const threadAtt = props.threadAttachments?.find(
                          a => a.message_id === msg.id && (a.attachment_id === attachmentId || a.filename === part.filename)
                        );
                        attachments.push({
                          filename: part.filename,
                          mimeType: part.mimeType || 'application/octet-stream',
                          size: part.body?.size || 0,
                          attachmentId,
                          inlineData: threadAtt?.inline_data || part.body?.data,
                        });
                      }
                      if (part.parts) findAttachments(part.parts);
                    });
                  };
                  findAttachments(msg.payload?.parts || []);
                  return attachments;
                };

                const attachments = getAttachments();
                const isImage = (mime: string) => mime.startsWith('image/');
                const isPdf = (mime: string) => mime === 'application/pdf';

                const getReplySubject = () => addReplyPrefix(headers.find(h => h.name === 'Subject')?.value || '');
                const getPlainTextBody = () => stripHtml(getBody());

                // Detect if original message was HTML
                const isOriginalHtml = () => {
                  if (msg.payload?.mimeType === 'text/html') return true;
                  return !!findContent(msg.payload?.parts, 'text/html');
                };

                const handleReply = () => {
                  const replyTo = extractEmail(from);
                  const quotedBody = buildQuotedBody(date, from, getPlainTextBody());
                  props.onReply(replyTo, "", getReplySubject(), quotedBody, msg.id, isOriginalHtml());
                };

                const handleReplyAll = () => {
                  const replyTo = extractEmail(from);
                  const toHeader = headers.find(h => h.name === 'To')?.value || '';
                  const ccHeader = headers.find(h => h.name === 'Cc')?.value || '';
                  const allRecipients = [toHeader, ccHeader]
                    .filter(Boolean)
                    .join(', ')
                    .split(',')
                    .map(e => extractEmail(e.trim()))
                    .filter(e => e && e !== replyTo);
                  const ccList = allRecipients.join(', ');
                  const quotedBody = buildQuotedBody(date, from, getPlainTextBody());
                  props.onReply(replyTo, ccList, getReplySubject(), quotedBody, msg.id, isOriginalHtml());
                };

                const handleForward = () => {
                  const origSubject = headers.find(h => h.name === 'Subject')?.value || '';
                  const fwdSubject = addForwardPrefix(origSubject);
                  const plainBody = getPlainTextBody();
                  const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${from}\nDate: ${date}\nSubject: ${origSubject}\n\n${plainBody}`;
                  props.onForward(fwdSubject, fwdBody);
                };

                const isReplyingToThis = () => props.inlineCompose?.replyToMessageId === msg.id;
                const isForwardingFromThis = () => props.inlineCompose?.isForward && index() === props.thread!.messages.length - 1;
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
                          <ReactionButton
                            onSelect={(emoji) => handleSendReaction(msg.id, emoji)}
                            sending={sendingReaction()}
                          />
                          <div class="message-date">{formatEmailDate(date)}</div>
                        </div>
                      </div>
                      {/* Message Actions Wheel - show for focused or hovered message */}
                      <Show when={((hoveredMessageId() === msg.id && wheelOpen()) || props.focusedMessageIndex === index()) && !showInlineCompose()}>
                        <MessageActionsWheel
                          onReply={handleReply}
                          onReplyAll={handleReplyAll}
                          onForward={handleForward}
                          open={true}
                          showHints={props.focusedMessageIndex === index()}
                          onMouseEnter={() => showMessageWheel(msg.id)}
                          onMouseLeave={hideMessageWheel}
                        />
                      </Show>
                      <MessageBody
                        body={getBody()}
                        cidAttachmentData={props.cidAttachmentData}
                        msgPayloadParts={msg.payload?.parts}
                        msgId={msg.id}
                        threadAttachments={props.threadAttachments}
                      />
                      <Show when={attachments.length > 0}>
                        <div class="message-attachments">
                          <For each={attachments}>
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
                              return (
                                <div
                                  class="attachment-thumb clickable"
                                  title={`${att.filename} (${formatFileSize(att.size)})`}
                                  onClick={() => props.onOpenAttachment(msg.id, att.attachmentId, att.filename, att.mimeType, att.inlineData)}
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
            onSelect={(suggestion) => {
              const lastMsg = props.thread!.messages[props.thread!.messages.length - 1];
              if (!lastMsg) return;

              const headers = lastMsg.payload?.headers || [];
              const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
              const date = headers.find(h => h.name === 'Date')?.value || '';
              const replyTo = extractEmail(from);

              const subject = addReplyPrefix(headers.find(h => h.name === 'Subject')?.value || '');
              const body = extractMessageBody(lastMsg.payload, lastMsg.snippet);
              const plainBody = stripHtml(DOMPurify.sanitize(body, DOMPURIFY_CONFIG));
              const quotedBody = buildQuotedBody(date, from, plainBody);
              const fullBody = `${suggestion}${quotedBody}`;

              const isHtml = lastMsg.payload?.mimeType === 'text/html' || !!findContent(lastMsg.payload?.parts, 'text/html');
              props.onReply(replyTo, "", subject, fullBody, lastMsg.id, isHtml);
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
