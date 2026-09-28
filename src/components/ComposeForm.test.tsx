import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { ComposeForm } from "./ComposeForm";

function renderCompose(initialTo = "", sending = false) {
  const [to, setTo] = createSignal(initialTo);
  const onSend = vi.fn();
  render(() => (
    <ComposeForm
      mode="new"
      to={to()}
      setTo={setTo}
      body=""
      setBody={vi.fn()}
      attachments={[]}
      onRemoveAttachment={vi.fn()}
      onFileSelect={vi.fn()}
      fileInputId="file"
      onSend={onSend}
      onClose={vi.fn()}
      sending={sending}
    />
  ));
  return { to, onSend };
}

describe("ComposeForm recipients", () => {
  it("keeps a recipient list exactly as typed", () => {
    const { to } = renderCompose();
    const input = screen.getByPlaceholderText("Recipients") as HTMLInputElement;
    const typed = '"Doe, Jane" <jane@example.com>, ';
    fireEvent.input(input, { target: { value: typed } });
    expect(to()).toBe(typed);
    expect(input.value).toBe(typed);
  });

  it("sends on Cmd+Enter only when there is a recipient", () => {
    const { onSend } = renderCompose();
    const body = screen.getByPlaceholderText("Write something...");
    fireEvent.keyDown(body, { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.input(screen.getByPlaceholderText("Recipients"), { target: { value: "a@example.com" } });
    fireEvent.keyDown(body, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send again on Cmd+Enter while a send is in flight", () => {
    const { onSend } = renderCompose("a@example.com", true);
    fireEvent.keyDown(screen.getByPlaceholderText("Write something..."), { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});
