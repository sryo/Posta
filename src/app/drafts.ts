import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { safeGetItem, safeRemoveItem, safeSetJSON } from "../shared/storage";

export interface DraftFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  threadId?: string;
}

export interface Draft extends DraftFields {
  gmailDraftId?: string;
  savedAt: number;
}

// Where a compose keeps its local draft: one per reply thread, one for a
// forward and one for a new email, per account
export function draftKey(accountId: string | undefined, target: { replyThreadId?: string; forwarding?: boolean }): string {
  if (target.replyThreadId) return `draft_reply_${accountId}_${target.replyThreadId}`;
  if (target.forwarding) return `draft_forward_${accountId}`;
  return `draft_new_${accountId}`;
}

export function hasDraftContent(fields: Pick<DraftFields, "to" | "subject" | "body">): boolean {
  return !!(fields.to || fields.subject || fields.body);
}

const SAVED_INDICATOR_MS = 2000;

// The open compose's draft: saved locally first (so it survives offline and
// restarts), then synced to one Gmail draft that later saves update in place.
export function createDraftSync() {
  const [gmailDraftId, setGmailDraftId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  // Bumped whenever the compose's draft is cleared or the compose replaced;
  // an in-flight save compares against it so a stale resolve can't resurrect
  // the draft or attach its Gmail draft to the next compose
  let epoch = 0;
  const clearedEpochs = new Set<number>();
  // Saves run one at a time, so a save started while the first one is still
  // creating the Gmail draft updates that draft instead of creating another
  let queue: Promise<void> = Promise.resolve();
  let savedTimeout: number | undefined;

  function flashSaved() {
    clearTimeout(savedTimeout);
    setSaved(true);
    savedTimeout = window.setTimeout(() => setSaved(false), SAVED_INDICATOR_MS);
  }

  async function sync(key: string, accountId: string, draft: Draft, startedIn: number) {
    if (startedIn !== epoch) return;
    setSaving(true);
    try {
      const result = await invoke<{ id: string }>("save_draft", {
        accountId,
        draftId: gmailDraftId(),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        threadId: draft.threadId || null,
      });
      if (startedIn !== epoch) {
        if (!clearedEpochs.has(startedIn)) {
          // The compose was replaced, not discarded: its draft stays saved
          safeSetJSON(key, { ...draft, gmailDraftId: result.id });
        } else if (result.id && result.id !== draft.gmailDraftId) {
          // Discarded while this save was creating a Gmail draft the clear
          // couldn't know about: delete the orphan
          invoke("delete_draft", { accountId, draftId: result.id })
            .catch(e => console.warn("Failed to delete orphaned draft:", e));
        }
        return;
      }
      setGmailDraftId(result.id);
      safeSetJSON(key, { ...draft, gmailDraftId: result.id });
      flashSaved();
    } catch (e) {
      console.warn("Failed to sync draft to Gmail (offline?):", e);
      // The local copy was saved
      if (startedIn === epoch) flashSaved();
    } finally {
      setSaving(false);
    }
  }

  function save(key: string, accountId: string, fields: DraftFields): Promise<void> {
    if (!hasDraftContent(fields)) return queue;
    const draft: Draft = { ...fields, gmailDraftId: gmailDraftId() || undefined, savedAt: Date.now() };
    safeSetJSON(key, draft);
    const startedIn = epoch;
    queue = queue.then(() => sync(key, accountId, draft, startedIn));
    return queue;
  }

  // A saved draft to restore, adopting its Gmail draft for later saves
  function load(key: string): Draft | null {
    const raw = safeGetItem(key);
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw) as Draft;
      if (draft.gmailDraftId) setGmailDraftId(draft.gmailDraftId);
      return draft;
    } catch {
      return null;
    }
  }

  // Keep whatever was saved but stop this compose's saves from touching it
  function detach() {
    epoch++;
    setGmailDraftId(null);
  }

  // Discard the draft locally and in Gmail
  async function clear(key: string, accountId: string | undefined) {
    const draftId = gmailDraftId();
    clearedEpochs.add(epoch);
    detach();
    safeRemoveItem(key);
    if (accountId && draftId) {
      try {
        await invoke("delete_draft", { accountId, draftId });
      } catch (e) {
        console.warn("Failed to delete draft from Gmail:", e);
      }
    }
  }

  return { gmailDraftId, saving, saved, save, load, detach, clear };
}
