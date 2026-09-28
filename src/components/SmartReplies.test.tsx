import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { SmartReplies } from "./SmartReplies";

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
});
