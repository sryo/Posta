// Posta's icon set: duotone, soft and chunky. One 16-unit grid, two plates per icon.
//   ink : outline and details in currentColor (the host's text token). Solid details
//         (dots, the calendar header, arrow wedges) are ink too.
//   wash: the object's body, in var(--icon-fill). App.css sets that per context
//         (card hue inside a card, accent in chrome, status colours on answers) and
//         prints it one plate-step down-right of the ink. Without that CSS the wash
//         resolves to nothing and the icon is a plain outline, so ink alone must read.
// Strokes are heavier at small sizes so the ink never renders under 1.4px; heavy
// details (stubs, handles, hands, bars) are 1.4x. Round caps and joins throughout.
// Size comes from the role the icon sits in (see --icon-* in App.css), never a px value.
import type { JSX } from "solid-js";

export type IconSize = "meta" | "ui" | "tool";
export interface IconProps {
  size?: IconSize;
  // In strong (600) text, e.g. the invite time chip or "Going": the ink steps up with the type
  strong?: boolean;
  // An "on" state: the wash snaps into register and prints in ink
  on?: boolean;
  class?: string;
}

const PX: Record<IconSize, number> = { meta: 12, ui: 14, tool: 20 };
const SIZE_CLASS: Record<IconSize, string> = { meta: "icon-meta", ui: "icon-ui", tool: "icon-tool" };
// Stroke in grid units: 1.75 at 12px = 1.31px, 1.6 at 14px = 1.4px, 1.5 at 20px = 1.88px.
// Heavier than a Feather-style set at every size; that weight is the family's chunk.
const STROKE: Record<IconSize, number> = { meta: 1.75, ui: 1.6, tool: 1.5 };

type Opts = { on?: boolean; flip?: boolean };
const icon = (name: string, wash: (() => JSX.Element) | null, ink: (h: number) => JSX.Element, opts: Opts = {}) =>
  (props: IconProps = {}) => {
    const size = props.size ?? "ui";
    const s = STROKE[size] + (props.strong ? 0.3 : 0);
    const h = Math.round(s * 1.4 * 100) / 100;
    const on = opts.on || props.on;
    // thumbs-down is thumbs-up turned over; the flip sits inside the wash group so
    // the plate offset still falls down-right
    const flip = (el: JSX.Element) => (opts.flip ? <g transform="matrix(1 0 0 -1 0 16)">{el}</g> : el);
    return (
      <svg
        class={`icon ${SIZE_CLASS[size]}${on ? " icon-on" : ""}${props.class ? ` ${props.class}` : ""}`}
        data-icon={name}
        width={PX[size]}
        height={PX[size]}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width={s}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        {wash && <g class="icon-wash">{flip(wash())}</g>}
        <g class="icon-ink">{flip(ink(h))}</g>
      </svg>
    );
  };

// -------- Chrome
// Down caret. Line glyph, no wash.
export const ChevronIcon = icon("chevron", null, (_h) => <><path d="M4.25 6.25 8 10l3.75-3.75"/></>);
// Line glyph. Stroke steps up with size, never a filled Material chevron.
export const ChevronLeftIcon = icon("chevron-left", null, (_h) => <><path d="M9.75 3.75 5.5 8l4.25 4.25"/></>);
// Mirror of left.
export const ChevronRightIcon = icon("chevron-right", null, (_h) => <><path d="M6.25 3.75 10.5 8l-4.25 4.25"/></>);
// Line glyph. Arms stop 1u short of Plus so the two read the same weight.
export const CloseIcon = icon("close", null, (_h) => <><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></>);
// Alias of Close.
export const ClearIcon = icon("clear", null, (_h) => <><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></>);
// Line glyph.
export const PlusIcon = icon("plus", null, (_h) => <><path d="M8 3.25v9.5M3.25 8h9.5"/></>);
// New (replaces •••). Three solid r1.45 dots: chunkier than a stroke dot.
export const MoreIcon = icon("more", null, (_h) => <><circle fill="currentColor" stroke="none" cx="3.5" cy="8" r="1.45"/><circle fill="currentColor" stroke="none" cx="8" cy="8" r="1.45"/><circle fill="currentColor" stroke="none" cx="12.5" cy="8" r="1.45"/></>);
// New (replaces ↗). A washed window with the arrow leaving it.
export const ExternalIcon = icon("external", () => <><rect x="2.5" y="4.5" width="9" height="9" rx="2.5"/></>, (_h) => <><path d="M7 4.5H5A2.5 2.5 0 0 0 2.5 7v4A2.5 2.5 0 0 0 5 13.5h4a2.5 2.5 0 0 0 2.5-2.5V9"/><path d="M9.75 2.5h3.75v3.75"/><path d="M13.25 2.75 8 8"/></>);
// Line glyph. Takes `strong` in 600 text (✓ Going).
export const CheckIcon = icon("check", null, (_h) => <><path d="M3.25 8.5 6.5 11.75 12.75 5"/></>);
// Open arc with a solid wedge head: the 'heavy end' rule for arrows.
export const RefreshIcon = icon("refresh", null, (_h) => <><path d="M13 8.5A5 5 0 1 1 11.25 4.4"/><path fill="currentColor" d="M13.5 2.75v3.5H10z"/></>);
// New in the working tree (event suggestions). Two runs, solid wedge heads.
export const RepeatIcon = icon("repeat", null, (_h) => <><path d="M3 8.25V7.5A2.75 2.75 0 0 1 5.75 4.75H11.5"/><path fill="currentColor" d="M11 2.75l2.5 2-2.5 2z"/><path d="M13 7.75v.75a2.75 2.75 0 0 1-2.75 2.75H4.5"/><path fill="currentColor" d="M5 9.25l-2.5 2 2.5 2z"/></>);
// The glass is washed, the handle is heavy: the lens reads as glass, not a ring.
export const SearchIcon = icon("search", () => <><circle cx="7" cy="7" r="4.75"/></>, (h) => <><circle cx="7" cy="7" r="4.75"/><path stroke-width={h} d="M10.6 10.6 13.5 13.5"/></>);
// Six round nubs rather than a traced cog outline: a washed wheel, readable at 14px.
export const SettingsIcon = icon("settings", () => <><circle cx="8" cy="8" r="4"/></>, (_h) => <><circle cx="8" cy="8" r="4"/><circle cx="8" cy="8" r="1.5"/><path d="M12.5 8H14M10.25 11.9l.75 1.3M5.75 11.9 5 13.2M3.5 8H2M5.75 4.1 5 2.8M10.25 4.1 11 2.8"/></>);
// Board of paint washed; three solid wells.
export const PaletteIcon = icon("palette", () => <><path d="M8 1.75a6.25 6.25 0 0 0 0 12.5c.9 0 1.5-.6 1.5-1.35 0-.4-.15-.75-.4-1.05-.25-.3-.4-.65-.4-1.05 0-.8.65-1.4 1.45-1.4h1.4a2.75 2.75 0 0 0 2.75-2.75c0-2.9-2.8-4.9-6.3-4.9z"/></>, (_h) => <><path d="M8 1.75a6.25 6.25 0 0 0 0 12.5c.9 0 1.5-.6 1.5-1.35 0-.4-.15-.75-.4-1.05-.25-.3-.4-.65-.4-1.05 0-.8.65-1.4 1.45-1.4h1.4a2.75 2.75 0 0 0 2.75-2.75c0-2.9-2.8-4.9-6.3-4.9z"/><circle fill="currentColor" stroke="none" cx="4.9" cy="8.1" r="1.25"/><circle fill="currentColor" stroke="none" cx="6.1" cy="5" r="1.25"/><circle fill="currentColor" stroke="none" cx="9.6" cy="4.6" r="1.25"/></>);

// -------- Mail
// A pencil writing a line: new words, not a pen-in-a-box. Distinct from Edit.
export const ComposeIcon = icon("compose", () => <><path d="M11.4 2.3a1.8 1.8 0 0 1 2.55 2.55L7.1 11.7l-3.05.6.6-3.05z"/></>, (_h) => <><path d="M11.4 2.3a1.8 1.8 0 0 1 2.55 2.55L7.1 11.7l-3.05.6.6-3.05z"/><path d="M2.25 14.25c1.1-.9 2.1-.9 3.1 0s2.1.9 3.1 0 2.1-.9 3.1 0"/></>);
// Pencil with a ferrule: change what is there.
export const EditIcon = icon("edit", () => <><path d="M10.9 2.55a2.05 2.05 0 0 1 2.9 2.9L6 13.25l-3.6.75.75-3.6z"/></>, (_h) => <><path d="M10.9 2.55a2.05 2.05 0 0 1 2.9 2.9L6 13.25l-3.6.75.75-3.6z"/><path d="M9.5 4l2.5 2.5"/></>);
// One solid silhouette: head and swept tail in one outline, washed. Reads at a glance on the wheel.
export const ReplyIcon = icon("reply", () => <><path d="M6.5 3 1.75 7.75 6.5 12.5V9.5h1.75c2.5 0 4.25 1.25 5.5 3.75 0-4.75-2.75-7.25-7.25-7.25z"/></>, (_h) => <><path d="M6.5 3 1.75 7.75 6.5 12.5V9.5h1.75c2.5 0 4.25 1.25 5.5 3.75 0-4.75-2.75-7.25-7.25-7.25z"/></>);
// Reply silhouette plus a trailing ink chevron.
export const ReplyAllIcon = icon("reply-all", () => <><path d="M9.25 3.25 5 7.75l4.25 4.5V9.5h1c1.75 0 3 1 4 3 0-3.75-1.75-6-5-6z"/></>, (_h) => <><path d="M9.25 3.25 5 7.75l4.25 4.5V9.5h1c1.75 0 3 1 4 3 0-3.75-1.75-6-5-6z"/><path d="M5 4.25 1.5 7.75 5 11.25"/></>);
// Mirror of Reply.
export const ForwardIcon = icon("forward", () => <><path d="M9.5 3l4.75 4.75L9.5 12.5V9.5H7.75c-2.5 0-4.25 1.25-5.5 3.75 0-4.75 2.75-7.25 7.25-7.25z"/></>, (_h) => <><path d="M9.5 3l4.75 4.75L9.5 12.5V9.5H7.75c-2.5 0-4.25 1.25-5.5 3.75 0-4.75 2.75-7.25 7.25-7.25z"/></>);
// Box washed below an ink lid; heavy handle slot.
export const ArchiveIcon = icon("archive", () => <><path d="M3 6.5h10v5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 3 11.5z"/></>, (h) => <><rect x="1.75" y="2.5" width="12.5" height="4" rx="1.5"/><path d="M3 6.5v5a2.5 2.5 0 0 0 2.5 2.5h5a2.5 2.5 0 0 0 2.5-2.5v-5"/><path stroke-width={h} d="M6.75 9.5h2.5"/></>);
// Only the tray floor is washed: mail sitting in it. Empty-card glyph, so it wears the card hue.
export const InboxIcon = icon("inbox", () => <><path d="M1.75 9.25h3.4l1.1 1.75h3.5l1.1-1.75h3.4v2.5a2.5 2.5 0 0 1-2.5 2.5h-7.5a2.5 2.5 0 0 1-2.5-2.5z"/></>, (_h) => <><path d="M4.35 3.3 1.75 9.25v2.5a2.5 2.5 0 0 0 2.5 2.5h7.5a2.5 2.5 0 0 0 2.5-2.5v-2.5L11.65 3.3a1.75 1.75 0 0 0-1.6-1.05h-4.1a1.75 1.75 0 0 0-1.6 1.05z"/><path d="M1.75 9.25h3.4l1.1 1.75h3.5l1.1-1.75h3.4"/></>);
// New in the working tree (event suggestions). Envelope body washed.
export const MailIcon = icon("mail", () => <><path d="M4.75 3h6.5A2.75 2.75 0 0 1 14 5.75v4.5A2.75 2.75 0 0 1 11.25 13h-6.5A2.75 2.75 0 0 1 2 10.25v-4.5A2.75 2.75 0 0 1 4.75 3z"/></>, (_h) => <><path d="M4.75 3h6.5A2.75 2.75 0 0 1 14 5.75v4.5A2.75 2.75 0 0 1 11.25 13h-6.5A2.75 2.75 0 0 1 2 10.25v-4.5A2.75 2.75 0 0 1 4.75 3z"/><path d="M2.75 4.75 8 8.5l5.25-3.75"/></>);
// Fat star: inner radius 0.53 of outer (Feather is 0.38), so the arms are short and soft.
export const StarIcon = icon("star", () => <><path d="M8 2 10 5.65 14.09 6.42 11.23 9.45 11.76 13.58 8 11.8 4.24 13.58 4.77 9.45 1.91 6.42 6 5.65z"/></>, (_h) => <><path d="M8 2 10 5.65 14.09 6.42 11.23 9.45 11.76 13.58 8 11.8 4.24 13.58 4.77 9.45 1.91 6.42 6 5.65z"/></>);
// On state: the wash snaps into register and goes full ink.
export const StarFilledIcon = icon("star-filled", () => <><path d="M8 2 10 5.65 14.09 6.42 11.23 9.45 11.76 13.58 8 11.8 4.24 13.58 4.77 9.45 1.91 6.42 6 5.65z"/></>, (_h) => <><path d="M8 2 10 5.65 14.09 6.42 11.23 9.45 11.76 13.58 8 11.8 4.24 13.58 4.77 9.45 1.91 6.42 6 5.65z"/></>, { on: true });
// Can washed. Danger host turns the wash red on hover.
export const TrashIcon = icon("trash", () => <><path d="M3.5 4.75h9l-.7 7.9a2 2 0 0 1-2 1.85H6.2a2 2 0 0 1-2-1.85z"/></>, (_h) => <><path d="M2.25 4.75h11.5"/><path d="M6 4.75v-1.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M3.5 4.75l.7 7.9a2 2 0 0 0 2 1.85h3.6a2 2 0 0 0 2-1.85l.7-7.9"/></>);
// Octagon washed; heavy bar, solid dot.
export const SpamIcon = icon("spam", () => <><path d="M5.55 1.75h4.9l3.8 3.8v4.9l-3.8 3.8h-4.9l-3.8-3.8v-4.9z"/></>, (_h) => <><path d="M5.55 1.75h4.9l3.8 3.8v4.9l-3.8 3.8h-4.9l-3.8-3.8v-4.9z"/><path d="M8 4.75v3.5"/><circle fill="currentColor" stroke="none" cx="8" cy="11.1" r="1.2"/></>);
// Mail envelope with the corner given to a heavy minus.
export const UnsubscribeIcon = icon("unsubscribe", () => <><path d="M4.75 3h6.5A2.75 2.75 0 0 1 14 5.75v4.5A2.75 2.75 0 0 1 11.25 13h-6.5A2.75 2.75 0 0 1 2 10.25v-4.5A2.75 2.75 0 0 1 4.75 3z"/></>, (h) => <><path d="M14 8V5.75A2.75 2.75 0 0 0 11.25 3h-6.5A2.75 2.75 0 0 0 2 5.75v4.5A2.75 2.75 0 0 0 4.75 13H8.5"/><path d="M2.75 4.75 8 8.5l5.25-3.75"/><path stroke-width={h} d="M11.25 12.25h3"/></>);
// Chunky mitten hand; cuff and hand both washed.
export const ThumbsUpIcon = icon("thumbs-up", () => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>, (_h) => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>);
// On state, in register.
export const ThumbsUpFilledIcon = icon("thumbs-up-filled", () => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>, (_h) => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>, { on: true });
// Thumbs-up flipped vertically (the wash offset is applied after the flip, so it still falls down-right).
export const ThumbsDownIcon = icon("thumbs-down", () => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>, (_h) => <><path d="M5 7.25 7.4 2.5c.95 0 1.85.75 1.85 1.85v2h3.1a1.6 1.6 0 0 1 1.57 1.92l-.8 4a1.6 1.6 0 0 1-1.57 1.28H5z"/><path d="M5 7.25H3.25a1.25 1.25 0 0 0-1.25 1.25v3.9a1.25 1.25 0 0 0 1.25 1.25H5z"/></>, { flip: true });
// Almond washed, big solid pupil (r2.4): friendly, not surveillance.
export const EyeOpenIcon = icon("eye-open", () => <><path d="M1.5 8C3 5 5.25 3.25 8 3.25S13 5 14.5 8C13 11 10.75 12.75 8 12.75S3 11 1.5 8z"/></>, (_h) => <><path d="M1.5 8C3 5 5.25 3.25 8 3.25S13 5 14.5 8C13 11 10.75 12.75 8 12.75S3 11 1.5 8z"/><circle fill="currentColor" stroke="none" cx="8" cy="8" r="2.4"/></>);
// A shut lid with three lashes instead of a slashed eye: sleeping, not forbidden.
export const EyeClosedIcon = icon("eye-closed", null, (_h) => <><path d="M1.75 6.75C3.25 9.25 5.5 10.5 8 10.5s4.75-1.25 6.25-3.75"/><path d="M8 10.5v2.25M4.6 9.6l-1.1 1.6M11.4 9.6l1.1 1.6"/></>);
// Luggage tag, washed, solid eyelet.
export const LabelIcon = icon("label", () => <><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h4.1a1.5 1.5 0 0 1 1.06.44l5.05 5.05a1.5 1.5 0 0 1 0 2.12l-4.04 4.04a1.5 1.5 0 0 1-2.12 0L2.44 8.6A1.5 1.5 0 0 1 2 7.54z"/></>, (_h) => <><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h4.1a1.5 1.5 0 0 1 1.06.44l5.05 5.05a1.5 1.5 0 0 1 0 2.12l-4.04 4.04a1.5 1.5 0 0 1-2.12 0L2.44 8.6A1.5 1.5 0 0 1 2 7.54z"/><circle fill="currentColor" stroke="none" cx="5.25" cy="5.25" r="1.35"/></>);
// Upright paperclip: two open loops with wide, even gaps, so it holds at 12px. Line glyph (a clip has no body). Set strong in the mail row for the bolder wire.
export const AttachmentIcon = icon("attachment", null, (_h) => <><path d="M12 5.5v5a4 4 0 0 1-8 0V3.6a2 2 0 0 1 4 0v7.65"/></>);
// New (replaces the 📎 tile). A page whose top-right corner folds down as a solid ink flap; the page is washed.
export const FileIcon = icon("file", () => <><path d="M8.75 1.75H5.5a2.5 2.5 0 0 0-2.5 2.5v7.5a2.5 2.5 0 0 0 2.5 2.5h5a2.5 2.5 0 0 0 2.5-2.5V6z"/></>, (_h) => <><path d="M8.75 1.75H5.5a2.5 2.5 0 0 0-2.5 2.5v7.5a2.5 2.5 0 0 0 2.5 2.5h5a2.5 2.5 0 0 0 2.5-2.5V6z"/><path fill="currentColor" d="M8.75 1.75V6H13z"/></>);
// New (replaces 📄). File with two text lines.
export const FileTextIcon = icon("file-text", () => <><path d="M8.75 1.75H5.5a2.5 2.5 0 0 0-2.5 2.5v7.5a2.5 2.5 0 0 0 2.5 2.5h5a2.5 2.5 0 0 0 2.5-2.5V6z"/></>, (_h) => <><path d="M8.75 1.75H5.5a2.5 2.5 0 0 0-2.5 2.5v7.5a2.5 2.5 0 0 0 2.5 2.5h5a2.5 2.5 0 0 0 2.5-2.5V6z"/><path fill="currentColor" d="M8.75 1.75V6H13z"/><path d="M5.75 9.25h4.5M5.75 11.75h2.5"/></>);
// New (replaces 🖼️). A washed frame with a solid sun and solid mountains.
export const ImageIcon = icon("image", () => <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5"/></>, (_h) => <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5"/><circle fill="currentColor" stroke="none" cx="5.2" cy="6" r="1.35"/><path fill="currentColor" d="M4.25 10.75 7.4 7.1l2.05 2.2 1.2-1.1 1.6 2.55z"/></>);

// -------- Calendar
// Signature glyph. Solid ink header band, heavy ring nubs, one solid 'day' dot; the page below is washed in the card's hue.
export const CalendarIcon = icon("calendar", () => <><path d="M5 3h6a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/></>, (h) => <><path d="M5 3h6a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path fill="currentColor" d="M2 6.75V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v.75z"/><path stroke-width={h} d="M5.25 1.5v1.75M10.75 1.5v1.75"/><circle fill="currentColor" stroke="none" cx="10.25" cy="10.5" r="1.55"/></>);
// Calendar with a wedge-headed arrow entering the corner.
export const MoveToCalendarIcon = icon("move-to-calendar", () => <><path d="M5 3h6a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/></>, (h) => <><path d="M14 8.25V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h3.25"/><path fill="currentColor" d="M2 6.75V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v.75z"/><path stroke-width={h} d="M5.25 1.5v1.75M10.75 1.5v1.75"/><path d="M10.5 11.75h3.5"/><path fill="currentColor" d="M12.5 9.75l2 2-2 2z"/></>);
// Face washed, heavy hands.
export const ClockIcon = icon("clock", () => <><circle cx="8" cy="8" r="6.25"/></>, (h) => <><circle cx="8" cy="8" r="6.25"/><path stroke-width={h} d="M8 4.75V8l2.25 1.5"/></>);
// Fat drop (head r5, Feather r4.75 on 24 is thinner); hole left as paper.
export const LocationIcon = icon("location", () => <><path d="M8 14.5s5-4.3 5-8.25a5 5 0 0 0-10 0c0 3.95 5 8.25 5 8.25z"/></>, (_h) => <><path d="M8 14.5s5-4.3 5-8.25a5 5 0 0 0-10 0c0 3.95 5 8.25 5 8.25z"/><circle cx="8" cy="6.25" r="1.75"/></>);
// Rounded camera body plus a closed lens horn, both washed.
export const VideoIcon = icon("video", () => <><path d="M4.25 3.75h4.5A2.75 2.75 0 0 1 11.5 6.5v3A2.75 2.75 0 0 1 8.75 12.25h-4.5A2.75 2.75 0 0 1 1.5 9.5v-3a2.75 2.75 0 0 1 2.75-2.75z"/><path d="M11.5 7 14.5 5.1v5.8L11.5 9z"/></>, (_h) => <><path d="M4.25 3.75h4.5A2.75 2.75 0 0 1 11.5 6.5v3A2.75 2.75 0 0 1 8.75 12.25h-4.5A2.75 2.75 0 0 1 1.5 9.5v-3a2.75 2.75 0 0 1 2.75-2.75z"/><path d="M11.5 7 14.5 5.1v5.8L11.5 9z"/></>);
// Going. Wash takes --success.
export const CheckCircleIcon = icon("check-circle", () => <><circle cx="8" cy="8" r="6.25"/></>, (_h) => <><circle cx="8" cy="8" r="6.25"/><path d="M5.25 8.25 7.25 10.25 10.75 6.25"/></>);
// Maybe. Wash takes --warning.
export const QuestionCircleIcon = icon("question-circle", () => <><circle cx="8" cy="8" r="6.25"/></>, (_h) => <><circle cx="8" cy="8" r="6.25"/><path d="M6.1 6.3a1.95 1.95 0 0 1 3.8.55c0 1.3-1.9 1.55-1.9 2.6"/><circle fill="currentColor" stroke="none" cx="8" cy="11.5" r="1.2"/></>);
// Not going. Wash stays neutral (muted).
export const CrossCircleIcon = icon("cross-circle", () => <><circle cx="8" cy="8" r="6.25"/></>, (_h) => <><circle cx="8" cy="8" r="6.25"/><path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2"/></>);
// New (replaces ⚠). Round-cornered triangle, washed amber by its host.
export const WarningIcon = icon("warning", () => <><path d="M6.7 2.75a1.5 1.5 0 0 1 2.6 0l5.25 9.25a1.5 1.5 0 0 1-1.3 2.25H2.75a1.5 1.5 0 0 1-1.3-2.25z"/></>, (h) => <><path d="M6.7 2.75a1.5 1.5 0 0 1 2.6 0l5.25 9.25a1.5 1.5 0 0 1-1.3 2.25H2.75a1.5 1.5 0 0 1-1.3-2.25z"/><path stroke-width={h} d="M8 5.75v2.5"/><circle fill="currentColor" stroke="none" cx="8" cy="11.5" r="1.2"/></>);

// Brand mark, outside the family: fixed colours, one plate, sized by its button
export const GoogleLogo = () => (
  <svg class="brand-mark" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);
