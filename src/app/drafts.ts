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
  // Queued to send when last saved
  sending?: boolean;
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
export function findLatestDraft(group: string, accept: (draft: Draft, key: string) => boolean = () => true): { key: string; draft: Draft } | null {
  let latest: { key: string; draft: Draft } | null = null;
  for (const key of storageKeys()) {
    if (key !== group && !key.startsWith(`${group}#`)) continue;
    const draft = safeGetJSON<Draft | null>(key, null);
    if (!draft || typeof draft.savedAt !== "number" || !accept(draft, key)) continue;
    if (!latest || draft.savedAt > latest.draft.savedAt) latest = { key, draft };
  }
  return latest;
}

export function markDraftClosed(key: string) {
  const draft = safeGetJSON<Draft | null>(key, null);
  if (draft) safeSetJSON(key, { ...draft, closed: true });
}

const CLOSED_DRAFT_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

// Closed drafts that Gmail's Drafts already holds. A closed new email is
// never offered again, so its local copy goes at once; a closed reply or
// forward stays a month for replying to the same thread again. Anything that
// may be the only copy stays.
export function pruneDrafts(now: number) {
  for (const key of storageKeys()) {
    if (!DRAFT_KINDS.some(kind => key.startsWith(`draft_${kind}_`))) continue;
    const draft = safeGetJSON<Draft | null>(key, null);
    if (!draft || !draft.closed || !draft.gmailDraftId || draft.sending) continue;
    const newEmail = key.startsWith("draft_new_");
    if (newEmail || now - draft.savedAt > CLOSED_DRAFT_KEPT_MS) safeRemoveItem(key);
  }
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
  // The Gmail draft each key synced to, for drafts local storage refused
  const syncedDraftIds = new Map<string, string>();
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

  // Resolves true once Gmail has the draft
  async function sync(key: string, accountId: string, draft: Draft, startedIn: number, storedLocally: boolean): Promise<boolean> {
    if (clearedEpochs.has(startedIn)) return false;
    // A compose that let go of its draft (replaced, closed or sent) still
    // syncs its last save, into the Gmail draft recorded on its own key. A
    // missing local copy means it was discarded, unless it never got stored.
    const detached = startedIn !== epoch;
    let sentDraftId = gmailDraftId();
    if (detached) {
      const stored = safeGetJSON<Draft | null>(key, null);
      if (!stored && storedLocally) return false;
      sentDraftId = stored?.gmailDraftId ?? draft.gmailDraftId ?? syncedDraftIds.get(key) ?? null;
    } else {
      setSaving(true);
    }
    try {
      // A Gmail draft deleted or sent elsewhere is recreated by the backend
      const result = await saveDraftToGmail(accountId, sentDraftId, draft);
      if (startedIn !== epoch) {
        const stored = safeGetJSON<Draft | null>(key, null);
        if (clearedEpochs.has(startedIn) || (!stored && storedLocally)) {
          // Discarded while this save was creating a Gmail draft the discard
          // couldn't know about: delete the orphan
          if (result.id && result.id !== sentDraftId) {
            invoke("delete_draft", { accountId, draftId: result.id })
              .catch(e => console.warn("Failed to delete orphaned draft:", e));
          }
          return false;
        }
        syncedDraftIds.set(key, result.id);
        if (stored && (!stored.gmailDraftId || stored.gmailDraftId === sentDraftId)) {
          // The compose was replaced, not discarded: its draft stays saved
          safeSetJSON(key, { ...stored, gmailDraftId: result.id });
        }
        return true;
      }
      setGmailDraftId(result.id);
      syncedDraftIds.set(key, result.id);
      // A later save may already have stored newer text locally
      const stored = safeGetJSON<Draft | null>(key, null);
      const latest = stored && stored.savedAt >= draft.savedAt ? stored : draft;
      safeSetJSON(key, { ...latest, gmailDraftId: result.id });
      flashSaved();
      return true;
    } catch (e) {
      console.warn("Failed to sync draft to Gmail (offline?):", e);
      if (startedIn === epoch && storedLocally) flashSaved();
      // A closed draft that isn't in Gmail's Drafts would be kept where the
      // user can't see it; let the next compose pick it up again
      const stored = detached ? safeGetJSON<Draft | null>(key, null) : null;
      if (stored?.closed && !stored.gmailDraftId) safeSetJSON(key, { ...stored, closed: false });
      return false;
    } finally {
      if (!detached) setSaving(false);
    }
  }

  // Write the local copy only, synchronously, so it survives a quit that
  // lands before the next Gmail sync
  function writeLocal(key: string, fields: DraftFields): { draft: Draft; stored: boolean } | null {
    if (!hasDraftContent(fields)) return null;
    const draft: Draft = { ...fields, gmailDraftId: gmailDraftId() || undefined, savedAt: Date.now() };
    return { draft, stored: safeSetJSON(key, draft) };
  }

  function saveLocal(key: string, fields: DraftFields): Draft | null {
    return writeLocal(key, fields)?.draft ?? null;
  }

  // Resolves true once Gmail has this save
  function save(key: string, accountId: string, fields: DraftFields): Promise<boolean> {
    const local = writeLocal(key, fields);
    if (!local) return queue.then(() => false);
    const startedIn = epoch;
    const synced = queue.then(() => sync(key, accountId, local.draft, startedIn, local.stored));
    queue = synced.then(() => {});
    return synced;
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
    const ids = new Set([knownDraftId, stored?.gmailDraftId, syncedDraftIds.get(key)].filter((id): id is string => !!id));
    syncedDraftIds.delete(key);
    await Promise.all([...ids].map(id => deleteFromGmail(accountId, id)));
  }

  return { gmailDraftId, saving, saved, save, saveLocal, load, detach, clear, discard };
}
