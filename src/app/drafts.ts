import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { safeGetItem, safeGetJSON, safeRemoveItem, safeSetJSON } from "../shared/storage";

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
  // The user closed its compose and kept the draft
  closed?: boolean;
}

export interface DraftTarget {
  replyThreadId?: string;
  forwardThreadId?: string;
  replyEventId?: string;
  forwardEventId?: string;
}

const DRAFT_KINDS = ["new", "reply", "forward", "eventreply", "eventforward"];

// The group a compose's local draft belongs to: what it replies to or
// forwards, per account. Each compose saves under its own key in the group
// (sessionDraftKey) so two emails never overwrite each other.
export function draftKey(accountId: string | undefined, target: DraftTarget): string {
  if (target.replyThreadId) return `draft_reply_${accountId}_${target.replyThreadId}`;
  if (target.forwardThreadId) return `draft_forward_${accountId}_${target.forwardThreadId}`;
  if (target.replyEventId) return `draft_eventreply_${accountId}_${target.replyEventId}`;
  if (target.forwardEventId) return `draft_eventforward_${accountId}_${target.forwardEventId}`;
  return `draft_new_${accountId}`;
}

export function sessionDraftKey(group: string): string {
  return `${group}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function storageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

// The group's most recently saved draft. A bare group key is where earlier
// versions saved.
export function findLatestDraft(group: string, accept: (draft: Draft) => boolean = () => true): { key: string; draft: Draft } | null {
  let latest: { key: string; draft: Draft } | null = null;
  for (const key of storageKeys()) {
    if (key !== group && !key.startsWith(`${group}#`)) continue;
    const draft = safeGetJSON<Draft | null>(key, null);
    if (!draft || typeof draft.savedAt !== "number" || !accept(draft)) continue;
    if (!latest || draft.savedAt > latest.draft.savedAt) latest = { key, draft };
  }
  return latest;
}

export function markDraftClosed(key: string) {
  const draft = safeGetJSON<Draft | null>(key, null);
  if (draft) safeSetJSON(key, { ...draft, closed: true });
}

export function removeAccountDrafts(accountId: string) {
  const prefixes = DRAFT_KINDS.map(kind => `draft_${kind}_${accountId}`);
  for (const key of storageKeys()) {
    const prefix = prefixes.find(p => key.startsWith(p));
    if (prefix === undefined) continue;
    const next = key.charAt(prefix.length);
    if (next === "" || next === "_" || next === "#") safeRemoveItem(key);
  }
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

  function saveDraftToGmail(accountId: string, draftId: string | null, draft: Draft) {
    return invoke<{ id: string }>("save_draft", {
      accountId,
      draftId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      threadId: draft.threadId || null,
    });
  }

  async function sync(key: string, accountId: string, draft: Draft, startedIn: number) {
    if (clearedEpochs.has(startedIn)) return;
    // A compose that let go of its draft (replaced, closed or sent) still
    // syncs its last save, into the Gmail draft recorded on its own key
    const detached = startedIn !== epoch;
    let sentDraftId = gmailDraftId();
    if (detached) {
      const stored = safeGetJSON<Draft | null>(key, null);
      if (!stored) return;
      sentDraftId = stored.gmailDraftId ?? draft.gmailDraftId ?? null;
    } else {
      setSaving(true);
    }
    try {
      let result: { id: string };
      try {
        result = await saveDraftToGmail(accountId, sentDraftId, draft);
      } catch (e) {
        // Sent or deleted from another client: start a new Gmail draft
        if (!sentDraftId || !String(e).includes("API error 404")) throw e;
        if (startedIn === epoch) setGmailDraftId(null);
        result = await saveDraftToGmail(accountId, null, draft);
      }
      if (startedIn !== epoch) {
        const stored = safeGetJSON<Draft | null>(key, null);
        if (clearedEpochs.has(startedIn) || !stored) {
          // Discarded while this save was creating a Gmail draft the discard
          // couldn't know about: delete the orphan
          if (result.id && result.id !== sentDraftId) {
            invoke("delete_draft", { accountId, draftId: result.id })
              .catch(e => console.warn("Failed to delete orphaned draft:", e));
          }
        } else if (!stored.gmailDraftId || stored.gmailDraftId === sentDraftId) {
          // The compose was replaced, not discarded: its draft stays saved
          safeSetJSON(key, { ...stored, gmailDraftId: result.id });
        }
        return;
      }
      setGmailDraftId(result.id);
      // A later save may already have stored newer text locally
      const stored = safeGetJSON<Draft | null>(key, null);
      const latest = stored && stored.savedAt >= draft.savedAt ? stored : draft;
      safeSetJSON(key, { ...latest, gmailDraftId: result.id });
      flashSaved();
    } catch (e) {
      console.warn("Failed to sync draft to Gmail (offline?):", e);
      // The local copy was saved
      if (startedIn === epoch) flashSaved();
      // A closed draft that isn't in Gmail's Drafts would be kept where the
      // user can't see it; let the next compose pick it up again
      const stored = detached ? safeGetJSON<Draft | null>(key, null) : null;
      if (stored?.closed && !stored.gmailDraftId) safeSetJSON(key, { ...stored, closed: false });
    } finally {
      if (!detached) setSaving(false);
    }
  }

  // Write the local copy only, synchronously, so it survives a quit that
  // lands before the next Gmail sync
  function saveLocal(key: string, fields: DraftFields): Draft | null {
    if (!hasDraftContent(fields)) return null;
    const draft: Draft = { ...fields, gmailDraftId: gmailDraftId() || undefined, savedAt: Date.now() };
    safeSetJSON(key, draft);
    return draft;
  }

  function save(key: string, accountId: string, fields: DraftFields): Promise<void> {
    const draft = saveLocal(key, fields);
    if (!draft) return queue;
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

  async function deleteFromGmail(accountId: string | undefined, draftId: string | null | undefined) {
    if (!accountId || !draftId) return;
    try {
      await invoke("delete_draft", { accountId, draftId });
    } catch (e) {
      console.warn("Failed to delete draft from Gmail:", e);
    }
  }

  // Discard the open compose's draft locally and in Gmail
  async function clear(key: string, accountId: string | undefined) {
    const draftId = gmailDraftId();
    clearedEpochs.add(epoch);
    detach();
    safeRemoveItem(key);
    await deleteFromGmail(accountId, draftId);
  }

  // Discard the draft of a compose that was already detached (sent, or
  // closed and then discarded), once its in-flight saves have settled
  async function discard(key: string, accountId: string, knownDraftId?: string) {
    await queue;
    const stored = safeGetJSON<Draft | null>(key, null);
    safeRemoveItem(key);
    const ids = new Set([knownDraftId, stored?.gmailDraftId].filter((id): id is string => !!id));
    await Promise.all([...ids].map(id => deleteFromGmail(accountId, id)));
  }

  return { gmailDraftId, saving, saved, save, saveLocal, load, detach, clear, discard };
}
