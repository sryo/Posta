// Reaction button: a wheel of the eight reactions, and every emoji behind it

import { createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { EMOJI_PICKER_SIZE, EmojiPicker } from "./EmojiPicker";
import { RadialMenu, type RadialItem } from "./RadialMenu";
import { placeBelowAnchor } from "../app/popoverPlacement";
import { useLayer } from "../app/layers";
import { loadReactionState, recordReaction, saveReactionState, togglePin, wheelReactions } from "../app/reactions";
import { hasCommandModifier, isImeComposing, isTypingTarget } from "../shared/keyboard";
import { MoreIcon, PlusIcon } from "./Icons";

const RADIUS = 46;
const PETAL = 32;
// How far from the window's edges the centre stays, so no petal is cut off
const EDGE = RADIUS + PETAL;
// A whole ring, the first reaction at the top: every reaction keeps its place
const RING = { start: -90, span: 360 - 360 / 8 };

type Open =
  | { kind: "wheel"; x: number; y: number }
  | { kind: "grid"; top: number; left: number; search: string };

interface ReactionButtonProps {
  onSelect: (emoji: string) => void;
  sending?: boolean;
}

export const ReactionButton = (props: ReactionButtonProps) => {
  const [open, setOpen] = createSignal<Open | null>(null);
  const [reactions, setReactions] = createSignal(loadReactionState());
  let buttonRef: HTMLButtonElement | undefined;
  let host: HTMLDivElement | undefined;
  const close = () => setOpen(null);

  // Both float fixed to the viewport, so they would drift off the button
  // when the thread scrolls underneath
  const closeOnOutsideScroll = (e: Event) => {
    if (e.target instanceof Node && host?.contains(e.target)) return;
    close();
  };
  document.addEventListener("scroll", closeOnOutsideScroll, true);
  onCleanup(() => document.removeEventListener("scroll", closeOnOutsideScroll, true));

  const choose = (emoji: string) => {
    const next = recordReaction(loadReactionState(), emoji);
    saveReactionState(next);
    setReactions(next);
    close();
    props.onSelect(emoji);
  };

  const openWheel = (fromKeyboard: boolean) => {
    setReactions(loadReactionState());
    const r = buttonRef!.getBoundingClientRect();
    const x = Math.min(Math.max((r.left + r.right) / 2, EDGE), window.innerWidth - EDGE);
    const y = Math.min(Math.max((r.top + r.bottom) / 2, EDGE), window.innerHeight - EDGE);
    setOpen({ kind: "wheel", x, y });
    if (fromKeyboard) queueMicrotask(() => host?.querySelector<HTMLElement>(".radial-petal")?.focus());
  };
  const openGrid = (search = "") => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setOpen({ kind: "grid", search, ...placeBelowAnchor(buttonRef!.getBoundingClientRect(), EMOJI_PICKER_SIZE, viewport) });
  };

  const wheel = () => {
    const o = open();
    return o?.kind === "wheel" ? o : null;
  };
  const grid = () => {
    const o = open();
    return o?.kind === "grid" ? o : null;
  };

  // A pinned reaction is ringed and never gives its place up
  const items = (): RadialItem[] => wheelReactions(reactions()).map((r, i) => ({
    id: r.emoji,
    label: r.pinned ? `${r.label}, pinned` : r.label,
    hint: String(i + 1),
    glyph: r.emoji,
    selected: r.pinned,
    onSelect: () => choose(r.emoji),
  }));

  // Right-click, or the menu key, pins a petal or lets it go
  const pinAt = (e: MouseEvent) => {
    e.preventDefault();
    const petal = (e.target as Element).closest(".radial-petal");
    const i = petal ? Array.from(host?.querySelectorAll(".radial-petal") ?? []).indexOf(petal) : -1;
    if (i < 0) return;
    const next = togglePin(loadReactionState(), items()[i].id);
    saveReactionState(next);
    setReactions(next);
  };

  // The grid holds its own Escape; the wheel's closes it alone
  useLayer(() => !!wheel(), close);

  // On the wheel, 1–8 react and any other letter starts a search of every
  // emoji; none of it reaches the thread's single-letter shortcuts
  const onKeyDown = (e: KeyboardEvent) => {
    if (!wheel() || e.key.length !== 1 || e.key === " " || hasCommandModifier(e) || isImeComposing(e) || isTypingTarget(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const slot = Number(e.key);
    if (Number.isInteger(slot) && slot >= 1 && slot <= items().length) choose(items()[slot - 1].id);
    else openGrid(e.key);
  };
  // A press anywhere but the wheel or its button puts it away
  const onPointerDown = (e: PointerEvent) => {
    if (!wheel()) return;
    const target = e.target as Node;
    if (host?.contains(target) || buttonRef?.contains(target)) return;
    close();
  };
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  });

  return (
    <div class="reaction-btn-container">
      <button
        ref={buttonRef}
        class="add-reaction-btn"
        // Native listener: keeps the grid's outside-mousedown handler from
        // closing it just before this click would toggle it open again
        on:mousedown={(e) => { if (open()) e.stopPropagation(); }}
        onClick={(e) => {
          e.stopPropagation();
          if (props.sending) return;
          if (open()) close();
          // A click from Enter or Space has no pointer behind it
          else openWheel(e.detail === 0);
        }}
        disabled={props.sending}
        title="Add reaction"
      >
        <PlusIcon size="meta" />
      </button>
      {/* Out of the message card: a sticky card is its own stacking context
          and, beside an inline reply, narrow and scrolling */}
      <Show when={wheel()}>
        {(at) => (
          <Portal ref={host}>
            <div class="reaction-wheel" style={{ left: `${at().x}px`, top: `${at().y}px` }} onContextMenu={pinAt}>
              <button type="button" class="reaction-wheel-more" title="Every emoji" aria-label="Every emoji" onClick={() => openGrid()}>
                <MoreIcon size="ui" />
              </button>
              <RadialMenu
                label="Reactions"
                open={true}
                items={items()}
                arc={RING}
                radius={RADIUS}
                itemSize={PETAL}
                hints="always"
                clickOnly
              />
            </div>
          </Portal>
        )}
      </Show>
      <Show when={grid()}>
        {(at) => (
          <Portal ref={host}>
            <EmojiPicker
              at={{ top: at().top, left: at().left }}
              initialSearch={at().search}
              onSelect={choose}
              onClose={close}
            />
          </Portal>
        )}
      </Show>
    </div>
  );
};
