import { createMemo, createSignal, For, type JSX, onCleanup, Show, createEffect } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CalendarEvent } from "../api/tauri";
import { formatClock } from "../app/dateFormat";
import type { StripLayout } from "../app/dayStrip";
import { inviteDuration, invitePlace, inviteState, inviteWhen, type InviteState } from "../app/inviteRow";
import { useLayer } from "../app/layers";
import { joinLabel, meetingProgress } from "../app/nowSection";
import { RSVP_ANSWERS, rsvpForKey, type RsvpStatus } from "../app/rsvp";
import { WarningIcon, CalendarIcon, CheckCircleIcon, CheckIcon, ChevronIcon, CrossCircleIcon, LocationIcon, QuestionCircleIcon, VideoIcon } from "./Icons";

// An invite email's row on a card keeps a mail row's three lines: the event's
// time where the arrival time goes, its length and place where the snippet
// goes, and the sender with the user's answer at the end

const ANSWER_ICONS: Record<RsvpStatus, { name: string; icon: () => JSX.Element }> = {
  accepted: { name: "going", icon: CheckCircleIcon },
  tentative: { name: "maybe", icon: QuestionCircleIcon },
  declined: { name: "not-going", icon: CrossCircleIcon },
};

const MENU_GAP = 4;
const MENU_HEIGHT = 96;
const EDGE = 8;

// The user's answer as one quiet menu button; the menu opens in the
// dropdown layer, outside the card, which clips its rows
export const InviteAnswerMenu = (props: {
  value: string | null | undefined;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  showKeys?: boolean;
}) => {
  const [at, setAt] = createSignal<{ top: number; right: number } | null>(null);
  let button: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  const answer = () => RSVP_ANSWERS.find(a => a.status === props.value) ?? null;
  const items = () => Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  const close = (refocus = true) => {
    if (!at()) return;
    setAt(null);
    if (refocus) button?.focus();
  };

  const open = () => {
    if (!button || props.disabled || at()) return;
    const rect = button.getBoundingClientRect();
    const below = rect.bottom + MENU_GAP;
    const top = below + MENU_HEIGHT <= window.innerHeight - EDGE ? below : Math.max(EDGE, rect.top - MENU_GAP - MENU_HEIGHT);
    setAt({ top, right: Math.max(EDGE, window.innerWidth - rect.right) });
    const checked = RSVP_ANSWERS.findIndex(a => a.status === props.value);
    items()[Math.max(0, checked)]?.focus();
  };

  useLayer(() => !!at(), () => close());

  const choose = (status: RsvpStatus) => {
    close();
    if (status !== props.value && !props.disabled) props.onAnswer(status);
  };

  // Enter and Space open the menu; the arrow keys keep moving between rows
  const onButtonKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => { e.preventDefault(); all[(to + all.length) % all.length]?.focus(); };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Tab") close(false);
    else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const status = rsvpForKey(e);
      if (status) {
        e.preventDefault();
        choose(status);
      }
    }
  };

  const dismissOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (menu?.contains(target) || button?.contains(target)) return;
    close(false);
  };
  const dismissOnScroll = (e: Event) => {
    if (e.target instanceof Node && menu?.contains(e.target)) return;
    close(false);
  };
  // Listened for only while the menu is open, not once per row on the board
  createEffect(() => {
    if (!at()) return;
    document.addEventListener("mousedown", dismissOutside);
    document.addEventListener("scroll", dismissOnScroll, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", dismissOutside);
      document.removeEventListener("scroll", dismissOnScroll, true);
    });
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        class="invite-answer"
        classList={{
          accepted: props.value === "accepted",
          tentative: props.value === "tentative",
          declined: props.value === "declined",
        }}
        aria-haspopup="menu"
        aria-expanded={!!at()}
        aria-label={`Your response: ${answer()?.label ?? "not answered"}`}
        // Still focusable while an answer sends, so focus stays where it was
        aria-disabled={props.disabled ? "true" : undefined}
        onClick={() => { if (at()) close(); else open(); }}
        on:keydown={onButtonKeyDown}
      >
        <Show when={props.value === "accepted"}>
          <span class="invite-answer-check" aria-hidden="true"><CheckIcon size="meta" strong /></span>
        </Show>
        {answer()?.label ?? "Going?"}
        <Show when={props.showKeys}>
          <span class="invite-answer-keys" aria-hidden="true">{RSVP_ANSWERS.map(a => a.keyHint).join(" ")}</span>
        </Show>
        <span class="invite-answer-caret" aria-hidden="true"><ChevronIcon size="meta" /></span>
      </button>
      <Show when={at()}>
        {(position) => (
          <Portal>
            <div
              ref={menu}
              class="invite-answer-menu"
              role="menu"
              aria-label="Your response"
              style={{ top: `${position().top}px`, right: `${position().right}px` }}
              onClick={(e) => e.stopPropagation()}
              on:keydown={onMenuKeyDown}
            >
              <For each={RSVP_ANSWERS}>
                {(option) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    class={`invite-answer-item ${option.status}`}
                    aria-checked={props.value === option.status}
                    aria-keyshortcuts={option.ariaKey}
                    tabindex="-1"
                    onClick={() => choose(option.status)}
                  >
                    <span class="invite-answer-icon" data-icon={ANSWER_ICONS[option.status].name} aria-hidden="true">
                      <Dynamic component={ANSWER_ICONS[option.status].icon} />
                    </span>
                    <span class="invite-answer-label">{option.label}</span>
                    <Show when={props.value === option.status}>
                      <span class="invite-answer-tick" aria-hidden="true"><CheckIcon /></span>
                    </Show>
                    <kbd aria-hidden="true">{option.keyHint}</kbd>
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
};

// When the event is, in the timestamp slot; "until 10:15" while it runs
export const InviteWhen = (props: {
  invite: CalendarEvent;
  state: InviteState;
  now: number;
  live?: boolean;
  locale?: string;
}) => {
  const text = () => {
    if (props.live && props.now >= props.invite.start_time && props.invite.end_time) {
      return `until ${formatClock(new Date(props.invite.end_time), props.locale)}`;
    }
    return inviteWhen(props.invite, new Date(props.now), props.locale);
  };
  return (
    <span
      class="invite-when"
      classList={{
        past: props.state === "past",
        "struck": props.state === "declined" || props.state === "cancelled",
        live: !!props.live,
      }}
    >
      <Show when={props.live} fallback={<CalendarIcon size="meta" strong />}>
        <span class="invite-live-dot" aria-hidden="true" />
      </Show>
      {text()}
    </span>
  );
};

const InviteStrip = (props: { layout: StripLayout }) => (
  <div class="invite-strip" aria-hidden="true">
    <Show when={props.layout.noonAt !== null}>
      <span class="invite-strip-noon" style={{ left: `${props.layout.noonAt}%` }} />
    </Show>
    <Show when={props.layout.past !== null}>
      <span class="invite-strip-past" style={{ width: `${props.layout.past}%` }} />
    </Show>
    <For each={props.layout.busy}>
      {(block) => (
        <span
          class="invite-strip-busy"
          classList={{ "overlap": block.overlap }}
          style={{ left: `${block.left}%`, width: `${block.width}%` }}
          title={block.title}
        />
      )}
    </For>
    <span class="invite-strip-slot" style={{ left: `${props.layout.slot.left}%`, width: `${props.layout.slot.width}%` }} />
    <Show when={props.layout.nowAt !== null}>
      <span class="invite-strip-now" style={{ left: `${props.layout.nowAt}%` }} />
    </Show>
  </div>
);

// An invite row's lines under its sender and title: when it is, how long and
// where, then the answer; with the day strip on an unanswered invite and the
// progress and Join button of a meeting happening now
export const InviteRowLines = (props: {
  invite: CalendarEvent;
  rsvp: string | null | undefined;
  now: number;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  showKeys?: boolean;
  strip?: StripLayout | null;
  live?: boolean;
}) => {
  const state = createMemo(() => inviteState(props.invite, props.rsvp, props.now));
  const duration = () => inviteDuration(props.invite);
  const place = () => invitePlace(props.invite);
  const strip = () => (state() === "unanswered" ? props.strip ?? null : null);
  const clashes = () => strip()?.clashes ?? [];
  const progress = () => meetingProgress(props.invite, props.now);
  const answerable = () => ["unanswered", "accepted", "tentative", "declined"].includes(state());

  return (
    <>
      <Show when={props.live}>
        <div
          class="invite-progress"
          role="progressbar"
          aria-label="Meeting progress"
          aria-valuemin={0}
          aria-valuemax={progress().total}
          aria-valuenow={progress().elapsed}
          aria-valuetext={progress().text}
        >
          <span style={{ width: `${progress().percent}%` }} />
        </div>
      </Show>
      <div class="invite-meta">
          <InviteWhen invite={props.invite} state={state()} now={props.now} live={props.live} />
          <Show when={duration()}>
            <span class="invite-sep" aria-hidden="true">·</span>
            <span class="invite-duration">{duration()}</span>
          </Show>
          <Show when={place()}>
            <span class="invite-sep" aria-hidden="true">·</span>
          </Show>
          <Show when={place()}>
            {(where) => (
              <span class="invite-place" classList={{ "invite-place-call": where().isCall }}>
                {where().isCall ? <VideoIcon size="meta" /> : <LocationIcon size="meta" />}
                <span>{where().label}</span>
              </span>
            )}
          </Show>
          <Show when={clashes().length > 0}>
            <span class="invite-clash">
              <WarningIcon size="meta" />
              <span class="invite-clash-title">{clashes()[0].title}{clashes().length > 1 ? ` +${clashes().length - 1}` : ""}</span>
            </span>
          </Show>
      </div>
      <Show when={strip()}>
        {(layout) => <InviteStrip layout={layout()} />}
      </Show>
      <Show when={props.live && props.invite.conference_url}>
        <button
          type="button"
          class="invite-join"
          onClick={(e) => { e.stopPropagation(); openUrl(props.invite.conference_url!); }}
        >
          <VideoIcon />
          {joinLabel(props.invite.conference_url!)}
        </button>
      </Show>
      <Show when={answerable() || state() === "cancelled"}>
        <div class="invite-foot">
          <Show when={answerable()}>
            <InviteAnswerMenu value={props.rsvp} onAnswer={props.onAnswer} disabled={props.disabled} showKeys={props.showKeys} />
          </Show>
          <Show when={state() === "cancelled"}>
            <span class="invite-answer-static">Cancelled</span>
          </Show>
        </div>
      </Show>
    </>
  );
};
