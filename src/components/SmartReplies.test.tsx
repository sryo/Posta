import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SmartReplies, describeSuggestionError } from "./SmartReplies";

const hasGeminiApiKey = vi.hoisted(() => vi.fn());
const suggestReplies = vi.hoisted(() => vi.fn());
vi.mock("../api/tauri", () => ({ hasGeminiApiKey, suggestReplies }));

beforeEach(() => {
  hasGeminiApiKey.mockReset();
  suggestReplies.mockReset();
});

describe("SmartReplies", () => {
  it("asks for suggestions when a key is saved, without handling the key itself", async () => {
    hasGeminiApiKey.mockResolvedValue(true);
    suggestReplies.mockResolvedValue(["Sounds good", "Thanks!"]);
    render(() => <SmartReplies accountId="acc" threadId="t1" onSelect={vi.fn()} />);
    expect(await screen.findByText("Sounds good")).toBeInTheDocument();
    expect(suggestReplies).toHaveBeenCalledWith("acc", "t1");
  });

  it("stays hidden and asks nothing without a saved key", async () => {
    hasGeminiApiKey.mockResolvedValue(false);
    const { container } = render(() => <SmartReplies accountId="acc" threadId="t1" onSelect={vi.fn()} />);
    await vi.waitFor(() => expect(hasGeminiApiKey).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 0));
    expect(suggestReplies).not.toHaveBeenCalled();
    expect(container.querySelector(".smart-replies-container")).toBeNull();
  });

  it("says why a rejected key failed and offers no retry that cannot succeed", async () => {
    hasGeminiApiKey.mockResolvedValue(true);
    const raw = 'Gemini API error 400 Bad Request: {"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}';
    suggestReplies.mockRejectedValue(raw);
    const { container } = render(() => <SmartReplies accountId="acc" threadId="t1" onSelect={vi.fn()} />);
    expect(await screen.findByText(/API key was rejected/)).toBeInTheDocument();
    expect(screen.queryByText("Retry suggestions")).toBeNull();
    expect(container.querySelector(".smart-replies-error")?.getAttribute("title")).toBe(raw);
  });

  it("names a rate limit and lets the user retry it", async () => {
    hasGeminiApiKey.mockResolvedValue(true);
    suggestReplies.mockRejectedValueOnce("Gemini API error 429 Too Many Requests: {}");
    suggestReplies.mockResolvedValueOnce(["Sure"]);
    render(() => <SmartReplies accountId="acc" threadId="t1" onSelect={vi.fn()} />);
    expect(await screen.findByText(/rate limit/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry suggestions"));
    expect(await screen.findByText("Sure")).toBeInTheDocument();
    expect(suggestReplies).toHaveBeenCalledTimes(2);
  });

  it("recognises errors the backend already worded for people", () => {
    expect(describeSuggestionError("Gemini API key was rejected. Update it in Settings.").retryable).toBe(false);
    expect(describeSuggestionError("Gemini rate limit reached").message).toMatch(/rate limit/);
    expect(describeSuggestionError("Failed to fetch thread: 500").retryable).toBe(true);
  });

  it("shows a short reason for other failures, with a retry", async () => {
    hasGeminiApiKey.mockResolvedValue(true);
    suggestReplies.mockRejectedValue(new Error("Request failed: connection refused"));
    render(() => <SmartReplies accountId="acc" threadId="t1" onSelect={vi.fn()} />);
    expect(await screen.findByText(/Couldn.t reach Gemini/)).toBeInTheDocument();
    expect(screen.getByText("Retry suggestions")).toBeInTheDocument();
  });

  it("trusts a known key state instead of asking the keychain on every thread open", async () => {
    suggestReplies.mockResolvedValue(["Ok"]);
    render(() => <SmartReplies accountId="acc" threadId="t1" keySaved={true} onSelect={vi.fn()} />);
    expect(await screen.findByText("Ok")).toBeInTheDocument();
    expect(hasGeminiApiKey).not.toHaveBeenCalled();
  });

  it("asks nothing when the known key state says there is no key", async () => {
    const { container } = render(() => <SmartReplies accountId="acc" threadId="t1" keySaved={false} onSelect={vi.fn()} />);
    await new Promise(r => setTimeout(r, 0));
    expect(hasGeminiApiKey).not.toHaveBeenCalled();
    expect(suggestReplies).not.toHaveBeenCalled();
    expect(container.querySelector(".smart-replies-container")).toBeNull();
  });

  it("asks again only when a new message arrives in the open thread", async () => {
    suggestReplies.mockResolvedValueOnce(["Old reply"]).mockResolvedValueOnce(["New reply"]);
    // Starring or relabelling reloads the thread as a new object with the same messages
    const [thread, setThread] = createSignal({ messages: [{ id: "m1" }] });
    const last = () => thread().messages[thread().messages.length - 1].id;
    render(() => <SmartReplies accountId="acc" threadId="t1" lastMessageId={last()} keySaved={true} onSelect={vi.fn()} />);
    expect(await screen.findByText("Old reply")).toBeInTheDocument();
    setThread({ messages: [{ id: "m1" }] });
    await new Promise(r => setTimeout(r, 0));
    expect(suggestReplies).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Old reply")).toBeInTheDocument();
    setThread({ messages: [{ id: "m1" }, { id: "m2" }] });
    expect(await screen.findByText("New reply")).toBeInTheDocument();
    expect(screen.queryByText("Old reply")).toBeNull();
    expect(suggestReplies).toHaveBeenCalledTimes(2);
  });

  it("ignores a slower answer for an earlier message", async () => {
    let finishOld!: (v: string[]) => void;
    suggestReplies.mockReturnValueOnce(new Promise<string[]>(r => { finishOld = r; })).mockResolvedValueOnce(["Fresh"]);
    const [last, setLast] = createSignal("m1");
    render(() => <SmartReplies accountId="acc" threadId="t1" lastMessageId={last()} keySaved={true} onSelect={vi.fn()} />);
    await vi.waitFor(() => expect(suggestReplies).toHaveBeenCalledTimes(1));
    setLast("m2");
    expect(await screen.findByText("Fresh")).toBeInTheDocument();
    finishOld(["Stale"]);
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
  });
});
