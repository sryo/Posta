import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { askConfirm, ConfirmDialog } from "./confirm";

afterEach(cleanup);

describe("askConfirm", () => {
  it("resolves true when the confirm button is pressed", async () => {
    render(() => <ConfirmDialog />);
    const answer = askConfirm("Delete the card?", "Delete");
    expect(await screen.findByText("Delete the card?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await answer).toBe(true);
    expect(screen.queryByText("Delete the card?")).not.toBeInTheDocument();
  });

  it("resolves false on Cancel, Escape, or a click outside", async () => {
    render(() => <ConfirmDialog />);
    const cancelled = askConfirm("First?");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await cancelled).toBe(false);

    const escaped = askConfirm("Second?");
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    expect(await escaped).toBe(false);

    const outside = askConfirm("Third?");
    await screen.findByText("Third?");
    fireEvent.click(document.querySelector(".preset-overlay")!);
    expect(await outside).toBe(false);
  });

  it("focuses the confirm button so Enter confirms", async () => {
    render(() => <ConfirmDialog />);
    const answer = askConfirm("Sign out?", "Sign out");
    const button = await screen.findByRole("button", { name: "Sign out" });
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(await answer).toBe(true);
  });

  it("gives focus back to what had it once answered", async () => {
    render(() => <ConfirmDialog />);
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const answer = askConfirm("Delete?");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(opener);
    fireEvent.click(cancel);
    await answer;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("cancels a question still open when another is asked", async () => {
    render(() => <ConfirmDialog />);
    const first = askConfirm("First?");
    const second = askConfirm("Second?");
    expect(await first).toBe(false);
    expect(await screen.findByText("Second?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await second).toBe(true);
  });

  it("asks a destructive question with a bold title, a red verb and focus on the safe answer", async () => {
    render(() => <ConfirmDialog />);
    const answer = askConfirm({
      title: "Delete and notify 2 guests?",
      message: "They get an email saying the event was cancelled.",
      confirmLabel: "Delete event",
      cancelLabel: "Keep event",
      tone: "danger",
    });
    const dialog = await screen.findByRole("alertdialog", { name: "Delete and notify 2 guests?" });
    expect(dialog.querySelector("strong")).toHaveTextContent("Delete and notify 2 guests?");
    expect(dialog).toHaveTextContent("They get an email saying the event was cancelled.");
    const confirm = screen.getByRole("button", { name: "Delete event" });
    expect(confirm).toHaveClass("btn-danger");
    const keep = screen.getByRole("button", { name: "Keep event" });
    await new Promise(r => setTimeout(r, 0));
    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    expect(await answer).toBe(false);
  });

  it("keeps Tab inside the dialog", async () => {
    render(() => <ConfirmDialog />);
    askConfirm("Delete?", "Delete");
    const confirm = await screen.findByRole("button", { name: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("keeps keys typed in the dialog from reaching the app's shortcuts", async () => {
    render(() => <ConfirmDialog />);
    let reached = 0;
    const listener = () => { reached++; };
    document.addEventListener("keydown", listener);
    askConfirm("Delete?");
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "d" });
    document.removeEventListener("keydown", listener);
    expect(reached).toBe(0);
  });
});

// WKWebView answers window.confirm/alert/prompt with Cancel unless the app
// implements its UI delegate, which wry does not
describe("native dialogs", () => {
  it("are never used by the app", () => {
    const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../test/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(["../App.tsx", "../utils.ts", "../components/EventView.tsx"]));
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\(/);
    }
  });
});
