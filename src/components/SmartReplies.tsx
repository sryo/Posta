import { createSignal, onMount, Show, For } from "solid-js";
import { hasGeminiApiKey, suggestReplies } from "../api/tauri";

interface SmartRepliesProps {
    accountId: string;
    threadId: string;
    onSelect: (text: string) => void;
}

// A short, visible reason for a failed request; `retryable` is false when
// asking again cannot help until the user changes the key in Settings
export function describeSuggestionError(raw: string): { message: string; retryable: boolean } {
    const gemini = raw.match(/^Gemini API error (\d{3})/);
    const status = gemini ? Number(gemini[1]) : null;
    if (/API_KEY_INVALID|API key not valid/i.test(raw) || status === 401 || status === 403) {
        return { message: "Gemini API key was rejected. Update it in Settings.", retryable: false };
    }
    if (/Gemini API key is required/i.test(raw)) {
        return { message: "Add a Gemini API key in Settings for suggestions.", retryable: false };
    }
    if (status === 429 || /RESOURCE_EXHAUSTED/.test(raw)) {
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

    const fetchSuggestions = async () => {
        if (!props.threadId || !props.accountId) return;

        setLoading(true);
        setError(null);
        try {
            const results = await suggestReplies(props.accountId, props.threadId);
            setSuggestions(results);
        } catch (e: any) {
            setError(typeof e === 'string' ? e : e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    onMount(async () => {
        try {
            if (!(await hasGeminiApiKey())) return;
        } catch {
            return;
        }
        setEnabled(true);
        fetchSuggestions();
    });

    // Gate in JSX rather than an early return: a top-level `return null`
    // freezes this instance as null forever, while <Show> re-evaluates
    return (
        <Show when={enabled()}>
        <div class="smart-replies-container">
            <Show when={loading()}>
                <div class="smart-replies-loading">
                    <div class="spinner-sm"></div>
                </div>
            </Show>

            <Show when={error()}>
                {(raw) => {
                    const described = () => describeSuggestionError(raw());
                    return (
                        <div class="smart-replies-error" title={raw()}>
                            <span>{described().message}</span>
                            <Show when={described().retryable}>
                                <button class="link-btn" onClick={fetchSuggestions}>Retry suggestions</button>
                            </Show>
                        </div>
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
