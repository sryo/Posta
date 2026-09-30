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

describe("ComposeForm quoted history in a reply", () => {
  const quote = "\n\nOn Mon, Ana <ana@x> wrote:\n> Lunch?";

  function renderReply(initialBody: string, mode: "reply" | "forward" = "reply") {
    const [body, setBody] = createSignal(initialBody);
    render(() => (
      <ComposeForm
        mode={mode} to="ana@x" body={body()} setBody={setBody} attachments={[]}
        onRemoveAttachment={vi.fn()} onFileSelect={vi.fn()} fileInputId="file" onSend={vi.fn()} onClose={vi.fn()}
      />
    ));
    return { body, textarea: screen.getByPlaceholderText("Write your reply...") as HTMLTextAreaElement };
  }

  it("folds the quote away while the reply is written above it, and keeps it in the body", () => {
    const { body, textarea } = renderReply(`\n\n--\nMateo${quote}`);
    expect(textarea.value).toBe("\n\n--\nMateo");
    fireEvent.input(textarea, { target: { value: "Yes!\n\n--\nMateo\n" } });
    expect(body()).toBe(`Yes!\n\n--\nMateo\n${quote}`);
    expect(textarea.value).toBe("Yes!\n\n--\nMateo\n");
  });

  it("shows the whole body, quote included, once the toggle is opened", () => {
    const { body, textarea } = renderReply(quote);
    expect(textarea.value).toBe("");
    const toggle = screen.getByRole("button", { name: "Show quoted text" });
    expect(toggle.textContent).toBe("•••");
    fireEvent.click(toggle);
    expect(textarea.value).toBe(quote);
    fireEvent.input(textarea, { target: { value: "Hi" + quote.replace("Lunch?", "Lunch? no") } });
    expect(body()).toBe("Hi" + quote.replace("Lunch?", "Lunch? no"));
    expect(screen.getByRole("button", { name: "Hide quoted text" })).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves a forward's text unfolded", () => {
    const { textarea } = renderReply(`\n\n---------- Forwarded message ----------\n> quoted in the original`, "forward");
    expect(textarea.value).toContain("Forwarded message");
    expect(screen.queryByRole("button", { name: "Show quoted text" })).toBeNull();
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

describe("ComposeForm fields and footer", () => {
  it("builds its rows and footer from the shared form parts", () => {
    renderCompose("kim@example.com");
    expect(screen.getByLabelText("To").closest(".form-field-row")).not.toBeNull();
    expect(screen.getByLabelText("Cc").closest(".form-field-row")).not.toBeNull();
    const footer = document.querySelector(".form-footer.compose-footer")!;
    expect(footer).not.toBeNull();
    expect(footer.querySelector(".form-footer-actions")!.contains(screen.getByRole("button", { name: /Send/ }))).toBe(true);
    expect(footer.contains(screen.getByTitle("Attach files"))).toBe(true);
  });

  it("shows Sending... on its button while a send is in flight", () => {
    renderCompose("kim@example.com", true);
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  });
});

describe("ComposeForm sender", () => {
  const accounts = [
    { id: "a", email: "a@x.com", picture: null, signature: null },
    { id: "b", email: "b@x.com", picture: null, signature: null },
  ];
  const base = {
    body: "", setBody: vi.fn(), attachments: [], onRemoveAttachment: vi.fn(), onFileSelect: vi.fn(),
    fileInputId: "file", onSend: vi.fn(), onClose: vi.fn(), to: "", setTo: vi.fn(),
  };

  it("lets a new email be sent from any signed-in account", () => {
    const setFrom = vi.fn();
    render(() => <ComposeForm mode="new" {...base} fromAccounts={accounts} fromAccountId="a" setFromAccountId={setFrom} />);
    const from = screen.getByRole("combobox", { name: "From" }) as HTMLSelectElement;
    expect([...from.options].map(o => o.textContent)).toEqual(["a@x.com", "b@x.com"]);
    expect(from.value).toBe("a");
    fireEvent.change(from, { target: { value: "b" } });
    expect(setFrom).toHaveBeenCalledWith("b");
  });

  it("asks nothing with one account", () => {
    render(() => <ComposeForm mode="new" {...base} fromAccounts={accounts.slice(0, 1)} fromAccountId="a" setFromAccountId={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "From" })).not.toBeInTheDocument();
  });

  it("names the account a reply goes out from", () => {
    render(() => <ComposeForm mode="reply" {...base} fromEmail="b@x.com" />);
    const from = screen.getByText("b@x.com").closest(".compose-from")!;
    expect(from.closest(".panel-header")).toHaveTextContent("b@x.comReply");
    expect(from.querySelector(".panel-account-avatar")).toHaveAttribute("data-hue");
    expect(screen.queryByRole("combobox", { name: "From" })).not.toBeInTheDocument();
  });
});
