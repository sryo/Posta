import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { CardAttachments } from "./CardAttachments";
import type { Attachment } from "../api/tauri";

const attachment = (filename: string, mime_type: string, size: number, inline_data: string | null = null): Attachment => ({
  message_id: "m1", attachment_id: `a-${filename}`, filename, mime_type, size, content_id: null, inline_data,
});

const files = [
  attachment("hotel.png", "image/png", 45000, "iVBOR"),
  attachment("layout.pdf", "application/pdf", 240 * 1024),
];

describe("CardAttachments", () => {
  it("renders each attachment as a button named after the file and its size", () => {
    render(() => <CardAttachments attachments={files} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByRole("button", { name: "hotel.png, 43.9 KB" }).querySelector("img")).not.toBeNull();
    expect(screen.getByRole("button", { name: "layout.pdf, 240.0 KB" })).toBeInTheDocument();
  });

  it("opens an attachment on click without opening the thread", () => {
    const onOpen = vi.fn();
    const rowClick = vi.fn();
    render(() => <div onClick={rowClick}><CardAttachments attachments={files} onOpen={onOpen} onMenu={vi.fn()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: /layout.pdf/ }));
    expect(onOpen).toHaveBeenCalledWith(files[1], 1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("opens the attachment menu from the keyboard with Shift+F10, and on ctrl-click", () => {
    const onMenu = vi.fn();
    const onOpen = vi.fn();
    render(() => <CardAttachments attachments={files} onOpen={onOpen} onMenu={onMenu} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /hotel.png/ }), { key: "F10", shiftKey: true });
    expect(onMenu).toHaveBeenCalledWith(files[0]);
    fireEvent.click(screen.getByRole("button", { name: /layout.pdf/ }), { ctrlKey: true });
    expect(onMenu).toHaveBeenLastCalledWith(files[1]);
    fireEvent.contextMenu(screen.getByRole("button", { name: /layout.pdf/ }));
    expect(onMenu).toHaveBeenCalledTimes(3);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps Enter and Space on an attachment from reaching the board's shortcuts", () => {
    const boardKey = vi.fn();
    render(() => <div onKeyDown={boardKey}><CardAttachments attachments={files} onOpen={vi.fn()} onMenu={vi.fn()} /></div>);
    fireEvent.keyDown(screen.getByRole("button", { name: /hotel.png/ }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: /hotel.png/ }), { key: " " });
    expect(boardKey).not.toHaveBeenCalled();
  });

  it("shows up to four thumbnails and three files, counting the rest", () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => attachment(`p${i}.png`, "image/png", 10, "iVBOR")),
      ...Array.from({ length: 4 }, (_, i) => attachment(`f${i}.txt`, "text/plain", 10)),
    ];
    const { container } = render(() => <CardAttachments attachments={many} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(container.querySelector(".thread-attachment-more")?.textContent).toBe("+2");
  });
});
