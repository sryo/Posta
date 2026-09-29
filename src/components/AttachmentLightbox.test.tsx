import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { AttachmentLightbox, type PreviewAttachment } from "./AttachmentLightbox";

const item = (filename: string, mimeType: string, inlineData: string | null = null): PreviewAttachment => ({
  messageId: "m1", attachmentId: `a-${filename}`, filename, mimeType, size: 2048, inlineData,
});

const items = [item("hotel.png", "image/png", "aW1n"), item("agenda.pdf", "application/pdf"), item("vineyard.jpg", "image/jpeg")];

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:pdf");
  URL.revokeObjectURL = vi.fn();
});

function renderLightbox(start = 0, loadData = vi.fn(async (_: PreviewAttachment) => "cGRm")) {
  const [index, setIndex] = createSignal(start);
  const props = {
    onClose: vi.fn(),
    onDownload: vi.fn(),
    onOpenExternally: vi.fn(),
    loadData,
  };
  const result = render(() => <AttachmentLightbox items={items} index={index()} onIndexChange={setIndex} {...props} />);
  return { ...result, props, index, loadData };
}

describe("AttachmentLightbox", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows an image from the data it already has, named and counted", () => {
    const { loadData } = renderLightbox();
    const dialog = screen.getByRole("dialog", { name: "hotel.png" });
    expect(dialog).toHaveTextContent("1 of 3");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aW1n");
    expect(loadData).not.toHaveBeenCalled();
  });

  it("loads a PDF and shows it in a frame", async () => {
    const { loadData } = renderLightbox(1);
    await waitFor(() => expect(screen.getByTitle("agenda.pdf").getAttribute("src")).toBe("blob:pdf"));
    expect(loadData).toHaveBeenCalledWith(items[1]);
  });

  it("moves between attachments with the arrow keys, stopping at the ends", () => {
    const { index } = renderLightbox();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(index()).toBe(0);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(index()).toBe(2);
    expect(screen.getByRole("dialog")).toHaveTextContent("3 of 3");
  });

  it("closes on Escape without letting the thread view behind it close too", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    const { props } = renderLightbox();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind);
  });

  it("downloads or opens the shown attachment in another app", () => {
    const { props } = renderLightbox(2);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(props.onDownload).toHaveBeenCalledWith(items[2]);
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    expect(props.onOpenExternally).toHaveBeenCalledWith(items[2]);
  });

  it("offers the other app when the preview can't be loaded", async () => {
    renderLightbox(1, vi.fn(async () => { throw new Error("offline"); }));
    expect(await screen.findByText(/Couldn't load a preview/)).toBeInTheDocument();
  });
});
