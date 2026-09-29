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

describe("ComposeForm attaching dropped and pasted files", () => {
  function renderDropTarget() {
    const onAddFiles = vi.fn();
    render(() => (
      <ComposeForm
        mode="reply"
        to="a@example.com"
        setTo={vi.fn()}
        body=""
        setBody={vi.fn()}
        attachments={[]}
        onRemoveAttachment={vi.fn()}
        onFileSelect={vi.fn()}
        onAddFiles={onAddFiles}
        fileInputId="file"
        onSend={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    return { onAddFiles, body: screen.getByPlaceholderText("Write your reply...") };
  }
  const file = new File(["x"], "plan.pdf", { type: "application/pdf" });
  const files = (...list: File[]) => ({ types: ["Files"], files: list, items: [], dropEffect: "none" });

  it("shows a drop target while files are dragged over and attaches what is dropped", () => {
    const { onAddFiles, body } = renderDropTarget();
    expect(screen.queryByText("Drop to attach")).toBeNull();
    fireEvent.dragEnter(body, { dataTransfer: files(file) });
    expect(screen.getByText("Drop to attach")).toBeInTheDocument();
    expect(fireEvent.dragOver(body, { dataTransfer: files(file) })).toBe(false);
    expect(fireEvent.drop(body, { dataTransfer: files(file) })).toBe(false);
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByText("Drop to attach")).toBeNull();
  });

  it("hides the drop target when the drag leaves", () => {
    const { body } = renderDropTarget();
    fireEvent.dragEnter(body, { dataTransfer: files(file) });
    fireEvent.dragEnter(screen.getByText("Drop to attach"), { dataTransfer: files(file) });
    fireEvent.dragLeave(body, { dataTransfer: files(file) });
    expect(screen.getByText("Drop to attach")).toBeInTheDocument();
    fireEvent.dragLeave(screen.getByText("Drop to attach"), { dataTransfer: files(file) });
    expect(screen.queryByText("Drop to attach")).toBeNull();
  });

  it("leaves dragged text to the text field", () => {
    const { body } = renderDropTarget();
    fireEvent.dragEnter(body, { dataTransfer: { types: ["text/plain"], files: [], items: [] } });
    expect(screen.queryByText("Drop to attach")).toBeNull();
  });

  it("attaches a pasted image and leaves pasted text to the text field", () => {
    const { onAddFiles, body } = renderDropTarget();
    const image = new File(["png"], "image.png", { type: "image/png" });
    expect(fireEvent.paste(body, { clipboardData: { types: ["Files"], files: [image], items: [] } })).toBe(false);
    expect(onAddFiles).toHaveBeenCalledWith([image]);

    onAddFiles.mockClear();
    expect(fireEvent.paste(body, { clipboardData: { types: ["text/plain"], files: [], items: [], getData: () => "hi" } })).toBe(true);
    expect(onAddFiles).not.toHaveBeenCalled();
  });
});
