import { createSignal, createEffect, createMemo, on, onMount, Show, For } from "solid-js";
import { StatusLine } from "./StatusLine";
import { hasGeminiApiKey, suggestReplies } from "../api/tauri";

interface SmartRepliesProps {
    accountId: string;
    threadId: string;
    // Suggestions answer this message; a new one arriving asks again
    lastMessageId?: string;
    // Whether a Gemini key is saved, when the caller already knows; otherwise
    // the keychain is asked on mount
    keySaved?: boolean;
    onSelect: (text: string) => void;
    // Opens Settings where the key is changed
    onOpenSettings?: () => void;
}

// A short, visible reason for a failed request; `retryable` is false when
// asking again cannot help until the user changes the key in Settings
export function describeSuggestionError(raw: string): { message: string; retryable: boolean } {
    const gemini = raw.match(/^Gemini API error (\d{3})/);
    const status = gemini ? Number(gemini[1]) : null;
    if (/API_KEY_INVALID|API key not valid|API key was rejected/i.test(raw) || status === 401 || status === 403) {
        return { message: "Gemini API key was rejected. Update it in Settings.", retryable: false };
    }
    if (/Gemini API key is required/i.test(raw)) {
        return { message: "Add a Gemini API key in Settings for suggestions.", retryable: false };
    }
    if (/Keychain unavailable/.test(raw)) {
        return { message: "Couldn't read the Gemini key: the keychain is locked or Posta was denied access. Unlock it, or choose Always Allow when macOS asks, then try again.", retryable: true };
    }
    if (status === 429 || /RESOURCE_EXHAUSTED|rate limit/i.test(raw)) {
        return { message: "Gemini rate limit reached. Try again in a minute.", retryable: true };
    }
    if (/^Request failed/.test(raw)) {
        return { message: "Couldn't reach Gemini.", retryable: true };
    }
    return { message: "Couldn't load suggestions.", retryable: true };
}

export const SmartReplies = (props: SmartRepliesProps) => {
    const [suggestions, setSuggestions] = createSignal<string[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    const [enabled, setEnabled] = createSignal(false);

    let request = 0;
    const fetchSuggestions = async () => {
        if (!props.threadId || !props.accountId) return;

        const current = ++request;
        setLoading(true);
        setError(null);
        setSuggestions([]);
        try {
            const results = await suggestReplies(props.accountId, props.threadId);
            if (current === request) setSuggestions(results);
        } catch (e: any) {
            if (current === request) setError(typeof e === 'string' ? e : e?.message || String(e));
        } finally {
            if (current === request) setLoading(false);
        }
    };

    onMount(async () => {
        if (props.keySaved === undefined) {
            try {
                if (!(await hasGeminiApiKey())) return;
            } catch {
                return;
            }
        } else if (!props.keySaved) {
            return;
        }
        setEnabled(true);
        fetchSuggestions();
    });

    // A memo so a thread reloaded with the same messages (after starring,
    // say) does not ask again
    const answering = createMemo(() => `${props.threadId}\n${props.lastMessageId ?? ''}`);
    createEffect(on(answering, () => { if (enabled()) fetchSuggestions(); }, { defer: true }));

    // Gate in JSX rather than an early return: a top-level `return null`
    // freezes this instance as null forever, while <Show> re-evaluates
    return (
        <Show when={enabled()}>
        <div class="smart-replies-container">
            <Show when={loading()}>
                <StatusLine kind="loading" size="inline">
                    <div class="spinner-sm"></div>
                </StatusLine>
            </Show>

            <Show when={error()}>
                {(raw) => {
                    const described = () => describeSuggestionError(raw());
                    return (
                        <StatusLine kind="error" size="inline" title={raw()}>
                            <span>{described().message}</span>
                            <Show when={described().retryable}>
                                <button class="link-btn" onClick={fetchSuggestions}>Retry suggestions</button>
                            </Show>
                            <Show when={!described().retryable && props.onOpenSettings}>
                                <button class="link-btn" onClick={() => props.onOpenSettings?.()}>Open Settings</button>
                            </Show>
                        </StatusLine>
                    );
                }}
            </Show>

            <Show when={!loading() && !error() && suggestions().length > 0}>
                <div class="smart-replies-chips">
                    <For each={suggestions()}>
                        {(suggestion) => (
                            <button
                                class="reply-chip"
                                onClick={() => props.onSelect(suggestion)}
                            >
                                {suggestion}
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
        </Show>
    );
};
