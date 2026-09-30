import { onCleanup, onMount, Show, type JSX } from "solid-js";
import { useLayer } from "../app/layers";

const ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

// A short list of choices over the page, mounted while open: the arrow keys,
// Home and End move between its items, Escape closes it and gives focus back
// to what opened it, and a press outside it, a scroll past it or Tab closes
// it and leaves focus where it goes. `onKey` takes other keys first, such
// as an answer's letter; `opener` is left to toggle the menu itself.
export function Menu(props: {
  label: string;
  title?: string;
  class?: string;
  style?: JSX.CSSProperties;
  initialIndex?: number;
  opener?: () => Element | undefined;
  closeOnScroll?: boolean;
  onKey?: (e: KeyboardEvent) => boolean;
  onClose: () => void;
  onClick?: (e: MouseEvent) => void;
  children: JSX.Element;
}) {
  let menu: HTMLDivElement | undefined;
  // What had focus, or the opener when a click didn't focus it (WebKit)
  const hadFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const returnTo = () => hadFocus ?? (props.opener?.() instanceof HTMLElement ? props.opener?.() as HTMLElement : null);
  let refocus = true;
  const items = () => Array.from(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
  const leave = () => { refocus = false; props.onClose(); };

  useLayer(() => true, () => props.onClose());

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (props.onKey?.(e)) return;
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => { e.preventDefault(); all[(to + all.length) % all.length]?.focus(); };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i < 0 ? all.length - 1 : i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Tab") leave();
  };

  const outside = (target: EventTarget | null) =>
    target instanceof Node && !menu?.contains(target) && !props.opener?.()?.contains(target);
  const onMouseDown = (e: MouseEvent) => { if (outside(e.target)) leave(); };
  const onScroll = (e: Event) => { if (outside(e.target)) leave(); };

  onMount(() => {
    items()[props.initialIndex ?? 0]?.focus();
    document.addEventListener("mousedown", onMouseDown);
    if (props.closeOnScroll) document.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("scroll", onScroll, true);
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || !!menu?.contains(active);
      const back = returnTo();
      if (refocus && lost && back?.isConnected) back.focus();
    });
  });

  return (
    <div
      ref={menu}
      class={`menu${props.class ? ` ${props.class}` : ""}`}
      role="menu"
      aria-label={props.label}
      style={props.style}
      onClick={(e) => props.onClick?.(e)}
      on:keydown={onKeyDown}
    >
      <Show when={props.title}>
        <div class="menu-title" aria-hidden="true">{props.title}</div>
      </Show>
      {props.children}
    </div>
  );
}
