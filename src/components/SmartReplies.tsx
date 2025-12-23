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

    const projectId = () => localStorage.getItem("google_cloud_project_id") || "";

    const fetchSuggestions = async () => {
        if (!props.threadId || !props.accountId || !projectId()) return;

        setLoading(true);
        setError(null);
        try {
            const results = await suggestReplies(props.accountId, props.threadId, projectId());
            setSuggestions(results);
        } catch (e: any) {
            setError(typeof e === 'string' ? e : e.message);
        } finally {
            setLoading(false);
        }
    };

    onMount(() => {
        if (projectId()) {
            fetchSuggestions();
        }
    });

    // Don't render if no project ID configured
    if (!projectId()) return null;

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
