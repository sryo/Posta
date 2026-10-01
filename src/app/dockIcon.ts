import iconSvg from "../../src-tauri/icons/source/icon.svg?raw";
import type { CardHue } from "../shared/constants";

// Below this contrast against the white stamp a hue can't carry the "p." (yellow)
const MIN_GLYPH_CONTRAST = 1.8;

// WCAG relative luminance of a #rrggbb colour
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** The app icon recoloured for a board hue, or null to keep the bundled icon.
 *  Colours come from the stylesheet's tokens, read through `readToken`. */
export function dockIconForHue(hue: CardHue | undefined, readToken: (name: string) => string): string | null {
  if (!hue) return null;
  const color = readToken(`--hue-${hue}`).trim();
  const paper = readToken("--neutral-0").trim();
  const ink = readToken("--neutral-900").trim();
  if (![color, paper, ink].every(isHex)) return null;
  const legible = contrast(color, paper) >= MIN_GLYPH_CONTRAST;
  const doc = new DOMParser().parseFromString(iconSvg, "image/svg+xml");
  doc.getElementById("stamp")?.setAttribute("fill", legible ? paper : color);
  doc.getElementById("glyph")?.setAttribute("fill", legible ? color : ink);
  return new XMLSerializer().serializeToString(doc);
}

/** Applies dock icons as they're asked for: null restores the bundled icon,
 *  repeats are skipped, and a render that finishes after a newer request is
 *  dropped. Nothing is applied until the first non-null icon. */
export function createDockIconSync(
  apply: (png: Uint8Array | null) => Promise<void>,
  render: (svg: string) => Promise<Uint8Array>,
) {
  let applied: string | null = null;
  let latest = 0;
  return async (svg: string | null) => {
    if (svg === applied) return;
    const ticket = ++latest;
    const png = svg === null ? null : await render(svg);
    if (ticket !== latest) return;
    applied = svg;
    await apply(png);
  };
}

/** Rasterises an icon SVG to a PNG at the full 1024px icon size */
export async function renderIconPng(svg: string, size = 1024): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(size, size);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d")!.drawImage(image, 0, 0, size, size);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't encode the dock icon");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
