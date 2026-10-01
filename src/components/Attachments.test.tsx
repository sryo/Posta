import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { AttachmentList } from "./Attachments";
import type { Attachment } from "../api/tauri";

const attachment = (filename: string, mime_type: string, size: number, inline_data: string | null = null): Attachment => ({
  message_id: "m1", attachment_id: `a-${filename}`, filename, mime_type, size, content_id: null, inline_data,
});

const files = [
  attachment("hotel.png", "image/png", 45000, "iVBOR"),
  attachment("layout.pdf", "application/pdf", 240 * 1024),
];

describe("AttachmentList", () => {
  it("renders each attachment as a button named after the file and its size", () => {
    render(() => <AttachmentList attachments={files} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByRole("button", { name: "hotel.png, 43.9 KB" }).querySelector("img")).not.toBeNull();
    expect(screen.getByRole("button", { name: "layout.pdf, 240.0 KB" })).toBeInTheDocument();
  });

  it("opens an attachment on click without opening the thread", () => {
    const onOpen = vi.fn();
    const rowClick = vi.fn();
    render(() => <div onClick={rowClick}><AttachmentList attachments={files} onOpen={onOpen} onMenu={vi.fn()} /></div>);
    fireEvent.click(screen.getByRole("button", { name: /layout.pdf/ }));
    expect(onOpen).toHaveBeenCalledWith(files[1], 1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("opens the attachment menu from the keyboard with Shift+F10, and on ctrl-click", () => {
    const onMenu = vi.fn();
    const onOpen = vi.fn();
    render(() => <AttachmentList attachments={files} onOpen={onOpen} onMenu={onMenu} />);
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
    render(() => <div onKeyDown={boardKey}><AttachmentList attachments={files} onOpen={vi.fn()} onMenu={vi.fn()} /></div>);
    fireEvent.keyDown(screen.getByRole("button", { name: /hotel.png/ }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: /hotel.png/ }), { key: " " });
    expect(boardKey).not.toHaveBeenCalled();
  });

  it("shows up to six thumbnails and three files, counting the rest", () => {
    const many = [
      ...Array.from({ length: 7 }, (_, i) => attachment(`p${i}.png`, "image/png", 10, "iVBOR")),
      ...Array.from({ length: 4 }, (_, i) => attachment(`f${i}.txt`, "text/plain", 10)),
    ];
    const { container } = render(() => <AttachmentList attachments={many} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(container.querySelector(".attachments-more")?.textContent).toBe("+2");
  });

  it("downloads a big image's preview when it has none, and falls back to its chip when it can't", async () => {
    const big = attachment("escupido.jpg", "image/jpeg", 900000);
    const load = vi.fn(async () => "iVBOR");
    const shown: IntersectionObserverCallback[] = [];
    const IO = vi.fn(function (this: unknown, cb: IntersectionObserverCallback) { shown.push(cb); return { observe: vi.fn(), disconnect: vi.fn() }; });
    vi.stubGlobal("IntersectionObserver", IO);
    const { container } = render(() => <AttachmentList attachments={[big]} onOpen={vi.fn()} onMenu={vi.fn()} loadPreview={load} />);
    expect(container.querySelector(".attachment-pending")).not.toBeNull();
    shown[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await vi.waitFor(() => expect(container.querySelector(".attachment-media img")).not.toBeNull());
    expect(load).toHaveBeenCalledWith(big);
    vi.unstubAllGlobals();
  });
});

describe("AttachmentList embedded images", () => {
  const embedded = (filename: string, size: number, content_id: string) => ({ ...attachment(filename, "image/png", size, "iVBOR"), content_id });

  it("leaves logos and signature images to the message, and keeps photos sent inline", () => {
    render(() => (
      <AttachmentList
        attachments={[
          embedded("ii_abc.png", 60000, "ii_abc"),
          embedded("image001.png", 60000, "x@y"),
          embedded("logo.png", 3000, "x@y"),
          { ...attachment("IMG_2041.jpeg", "image/jpeg", 900000), content_id: "B1C2@apple" },
          attachment("layout.pdf", "application/pdf", 240 * 1024),
        ]}
        onOpen={vi.fn()}
        onMenu={vi.fn()}
      />
    ));
    expect(screen.getAllByRole("button").map(b => b.getAttribute("title")?.split(" (")[0])).toEqual(["IMG_2041.jpeg", "layout.pdf"]);
  });

  it("cuts a long name short but always shows its extension", () => {
    render(() => <AttachmentList attachments={[attachment("80431_EXPENSAS_OCTUBRE.pdf", "application/pdf", 1000)]} onOpen={vi.fn()} onMenu={vi.fn()} />);
    const chip = screen.getByRole("button");
    expect(chip.querySelector(".file-stem")).toHaveTextContent("80431_EXPENSAS_OCTUBRE");
    expect(chip.querySelector(".file-ext")).toHaveTextContent(".pdf");
  });
});

describe("AttachmentList at detail size", () => {
  it("shows each attachment with its preview or its kind's glyph, its name and its size", () => {
    const { container } = render(() => <AttachmentList size="detail" attachments={files} onOpen={vi.fn()} onMenu={vi.fn()} />);
    const [image, pdf] = Array.from(container.querySelectorAll<HTMLElement>(".attachment"));
    expect(container.querySelector(".attachments")).toHaveAttribute("data-size", "detail");
    expect(image.querySelector(".attachment-media img")).not.toBeNull();
    expect(image.querySelector(".attachment-meta")).toHaveTextContent("43.9 KB · PNG");
    expect(pdf).toHaveAttribute("data-kind", "pdf");
    expect(pdf.querySelector(".attachment-media svg")).not.toBeNull();
    expect(pdf.querySelector(".file-ext")).toHaveTextContent(".pdf");
  });

  it("lists every attachment, not six and three", () => {
    const many = Array.from({ length: 5 }, (_, i) => attachment(`f${i}.txt`, "text/plain", 10 + i));
    const { container } = render(() => <AttachmentList size="detail" attachments={many} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll(".attachment")).toHaveLength(5);
    expect(container.querySelector(".attachments-more")).toBeNull();
  });
});

describe("AttachmentList duplicates", () => {
  const ics = (mime_type: string, message_id = "m1") => ({ ...attachment("invite.ics", mime_type, 1400), message_id });

  it("shows an invite's calendar file once, though Google puts it in the message twice, and none when the invite shows", () => {
    const both = [ics("text/calendar"), ics("application/ics")];
    const { container, unmount } = render(() => <AttachmentList size="detail" attachments={both} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll(".attachment")).toHaveLength(1);
    unmount();
    const hidden = render(() => <AttachmentList size="detail" attachments={both} hideCalendar onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(hidden.container.querySelector(".attachment")).toBeNull();
  });

  it("shows a file sent again in a later message once, and keeps two files of one message apart", () => {
    const again = [
      { ...attachment("plan.pdf", "application/pdf", 900), message_id: "m1" },
      { ...attachment("plan.pdf", "application/pdf", 900), message_id: "m2" },
      { ...attachment("image.png", "image/png", 10, "iVBOR"), attachment_id: "x1" },
      { ...attachment("image.png", "image/png", 10, "iVBOR"), attachment_id: "x2" },
    ];
    const { container } = render(() => <AttachmentList attachments={again} onOpen={vi.fn()} onMenu={vi.fn()} />);
    expect(container.querySelectorAll(".attachment")).toHaveLength(3);
  });

  it("says under an opened message's attachment that a later version came, with a way to open it", () => {
    const open = vi.fn();
    render(() => (
      <AttachmentList
        size="detail"
        attachments={files}
        onOpen={vi.fn()}
        onMenu={vi.fn()}
        laterVersion={(a) => (a.filename === "layout.pdf" ? { text: "Martín sent v3 on Sep 28, in “Obra”.", action: "Open v3", open } : null)}
      />
    ));
    const note = screen.getByText("Martín sent v3 on Sep 28, in “Obra”.");
    expect(note.closest(".attachment-noted")?.querySelector(".attachment")).toBe(screen.getByRole("button", { name: /layout.pdf/ }));
    expect(screen.getByRole("button", { name: /hotel.png/ }).closest(".attachment-noted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open v3" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
