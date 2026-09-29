import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { ComposeForm } from "./ComposeForm";

const CONTACTS = [{ email: "kenji@example.com", name: "Kenji" }, { email: "kim@example.com" }];
const suggestContacts = (q: string) => CONTACTS.filter(c => c.email.startsWith(q));

function renderCompose(initialTo = "", sending = false, suggest?: (q: string) => { email: string; name?: string }[]) {
  const [to, setTo] = createSignal(initialTo);
  const [cc, setCc] = createSignal("");
  const [bcc, setBcc] = createSignal("");
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(() => (
    <ComposeForm
      mode="new"
      to={to()}
      setTo={setTo}
      cc={cc()}
      setCc={setCc}
      bcc={bcc()}
      setBcc={setBcc}
      showCcBcc={true}
      setShowCcBcc={vi.fn()}
      body=""
      setBody={vi.fn()}
      attachments={[]}
      onRemoveAttachment={vi.fn()}
      onFileSelect={vi.fn()}
      fileInputId="file"
      onSend={onSend}
      onClose={onClose}
      sending={sending}
      suggestContacts={suggest}
    />
  ));
  return { to, cc, bcc, onSend, onClose };
}

describe("ComposeForm while an input method is composing", () => {
  it("leaves Escape and Enter to the composition", () => {
    const { to, onClose } = renderCompose("", false, suggestContacts);
    const input = screen.getByPlaceholderText("Recipients");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "ken" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Write something..."), { key: "Escape", isComposing: true });
    expect(to()).toBe("ken");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(to()).toBe("kenji@example.com");
  });
});

describe("ComposeForm recipient suggestions", () => {
  it("labels each recipient field", () => {
    renderCompose();
    expect(screen.getByLabelText("To")).toBe(screen.getByPlaceholderText("Recipients"));
    expect(screen.getByLabelText("Cc")).toBe(screen.getByPlaceholderText("Cc recipients"));
    expect(screen.getByLabelText("Bcc")).toBe(screen.getByPlaceholderText("Bcc recipients"));
  });

  it("suggests nothing on an empty To field", () => {
    renderCompose("", false, suggestContacts);
    fireEvent.focus(screen.getByLabelText("To"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("suggests contacts in Cc and Bcc as in To", () => {
    const { cc, bcc } = renderCompose("", false, suggestContacts);
    for (const [label, value] of [["Cc", cc], ["Bcc", bcc]] as const) {
      const input = screen.getByLabelText(label);
      fireEvent.focus(input);
      fireEvent.input(input, { target: { value: "ki" } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      fireEvent.keyDown(input, { key: "Tab" });
      expect(value()).toBe("kim@example.com");
      fireEvent.blur(input);
    }
  });

  it("closes the suggestions on Escape and closes the compose on the next one", () => {
    const { onClose } = renderCompose("", false, suggestContacts);
    const input = screen.getByLabelText("To");
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "k" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

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
