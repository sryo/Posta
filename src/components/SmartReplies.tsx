import { createSignal, onMount, Show, For } from "solid-js";
import { suggestReplies } from "../api/tauri";

interface SmartRepliesProps {
    accountId: string;
    threadId: string;
    onSelect: (text: string) => void;
}

export const SmartReplies = (props: SmartRepliesProps) => {
    const [suggestions, setSuggestions] = createSignal<string[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);

    const apiKey = () => localStorage.getItem("gemini_api_key") || "";

    const fetchSuggestions = async () => {
        if (!props.threadId || !props.accountId || !apiKey()) return;

        setLoading(true);
        setError(null);
        try {
            const results = await suggestReplies(props.accountId, props.threadId, apiKey());
            setSuggestions(results);
        } catch (e: any) {
            setError(typeof e === 'string' ? e : e.message);
        } finally {
            setLoading(false);
        }
    };

    onMount(() => {
        if (apiKey()) {
            fetchSuggestions();
        }
    });

    // Don't render if no API key configured
    if (!apiKey()) return null;

    return (
        <div class="smart-replies-container">
            <Show when={loading()}>
                <div class="smart-replies-loading">
                    <div class="spinner-sm"></div>
                </div>
            </Show>

            <Show when={error()}>
                <div class="smart-replies-error" title={error() || ''}>
                    <button class="link-btn" onClick={fetchSuggestions}>Retry suggestions</button>
                </div>
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
    );
};
