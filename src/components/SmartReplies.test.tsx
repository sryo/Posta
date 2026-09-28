import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
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
});
