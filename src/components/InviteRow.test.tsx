import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { CalendarEvent } from "../api/tauri";
import { stripLayout } from "../app/dayStrip";
import { InviteAnswerMenu, InviteRowLines, InviteWhen } from "./InviteRow";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const NOW = new Date(2026, 8, 29, 10).getTime();

const invite = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: "q4@google.com", title: "Q4 kickoff", start_time: at(1, 10, 30), end_time: at(1, 11, 30), all_day: false,
  location: "Studio 2", description: null, organizer: null, attendees: [], method: "REQUEST", status: null,
  response_status: null, conference_url: null, ...over,
});

const menuButton = () => screen.getByRole("button", { name: /^Your response/ });
const items = () => screen.getAllByRole("menuitemradio");

describe("InviteAnswerMenu", () => {
  it("asks quietly when the user has not answered", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} />);
    const button = menuButton();
    expect(button).toHaveAccessibleName("Your response: not answered");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveTextContent("Going?");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the answer in its colour once given", () => {
    const { unmount } = render(() => <InviteAnswerMenu value="accepted" onAnswer={vi.fn()} />);
    expect(menuButton()).toHaveAccessibleName("Your response: Going");
    expect(menuButton()).toHaveClass("accepted");
    expect(menuButton()).toHaveTextContent("Going");
    unmount();
    render(() => <InviteAnswerMenu value="tentative" onAnswer={vi.fn()} />);
    expect(menuButton()).toHaveClass("tentative");
    expect(menuButton()).toHaveTextContent("Maybe");
  });

  it("shows the answer keys on a focused row", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} showKeys />);
    expect(menuButton()).toHaveTextContent("Y ⇧M N");
  });

  it("opens a menu of the three answers outside the card, its click still reaching the board", () => {
    // The board closes its other popups on the click; the row itself leaves a
    // click on the answer alone (App regressions)
    const onRowClick = vi.fn();
    render(() => <div class="card"><div class="thread" onClick={onRowClick}><InviteAnswerMenu value="accepted" onAnswer={vi.fn()} /></div></div>);
    fireEvent.click(menuButton());
    expect(onRowClick).toHaveBeenCalled();
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Your response" });
    expect(menu.closest(".card")).toBeNull();
    expect(items().map(i => [i.textContent?.includes("Going"), i.getAttribute("aria-checked"), i.getAttribute("aria-keyshortcuts")]))
      .toEqual([[true, "true", "y"], [false, "false", "Shift+M"], [false, "false", "n"]]);
  });

  it("marks each answer with its own icon rather than a coloured dot", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={() => {}} />);
    fireEvent.click(menuButton());
    expect(items().map(i => i.querySelector(".invite-answer-icon")?.getAttribute("data-icon"))).toEqual(["going", "maybe", "not-going"]);
    expect(items().every(i => i.querySelector(".invite-answer-icon svg"))).toBe(true);
    expect(items().some(i => i.querySelector(".invite-answer-dot"))).toBe(false);
  });

  it("answers from the menu and closes it, handing focus back", () => {
    const onAnswer = vi.fn();
    render(() => <InviteAnswerMenu value={undefined} onAnswer={onAnswer} />);
    fireEvent.click(menuButton());
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: /Maybe/ }));
    expect(onAnswer).toHaveBeenCalledWith("tentative");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it("does not send the answer the user already gave", () => {
    const onAnswer = vi.fn();
    render(() => <InviteAnswerMenu value="accepted" onAnswer={onAnswer} />);
    fireEvent.click(menuButton());
    fireEvent.click(items()[0]);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens with Enter or Space on the checked answer, moves with the arrows and closes with Escape", async () => {
    render(() => <InviteAnswerMenu value="tentative" onAnswer={vi.fn()} />);
    const button = menuButton();
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(button, { key: " " });
    expect(document.activeElement).toBe(items()[1]);
  });

  it("opens on the first answer when there is none yet", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} />);
    menuButton().focus();
    fireEvent.keyDown(menuButton(), { key: "Enter" });
    expect(document.activeElement).toBe(items()[0]);
  });

  it("leaves the arrow keys to the board, which moves between rows with them", () => {
    const board = vi.fn();
    document.addEventListener("keydown", board);
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} />);
    menuButton().focus();
    fireEvent.keyDown(menuButton(), { key: "ArrowDown" });
    document.removeEventListener("keydown", board);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(board).toHaveBeenCalled();
  });

  it("answers with the answer keys while open, without the board seeing them", () => {
    const onAnswer = vi.fn();
    const board = vi.fn();
    document.addEventListener("keydown", board);
    render(() => <InviteAnswerMenu value={undefined} onAnswer={onAnswer} />);
    fireEvent.click(menuButton());
    fireEvent.keyDown(document.activeElement!, { key: "n" });
    document.removeEventListener("keydown", board);
    expect(onAnswer).toHaveBeenCalledWith("declined");
    expect(board).not.toHaveBeenCalled();
  });

  it("closes when the user clicks elsewhere", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} />);
    fireEvent.click(menuButton());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("cannot be opened while an answer is being sent, and keeps focus meanwhile", () => {
    render(() => <InviteAnswerMenu value={undefined} onAnswer={vi.fn()} disabled />);
    const button = menuButton();
    expect(button).toHaveAttribute("aria-disabled", "true");
    button.focus();
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe("InviteWhen", () => {
  it("shows when the event is", () => {
    render(() => <InviteWhen invite={invite()} state="unanswered" now={NOW} locale="en-GB" />);
    const chip = screen.getByText("Thu 1 Oct, 10:30").closest(".invite-when")!;
    expect(chip).not.toHaveClass("struck");
  });

  it("strikes the time through when the user is not going or the event was cancelled", () => {
    const { unmount } = render(() => <InviteWhen invite={invite()} state="declined" now={NOW} locale="en-GB" />);
    expect(document.querySelector(".invite-when")).toHaveClass("struck");
    unmount();
    render(() => <InviteWhen invite={invite()} state="cancelled" now={NOW} locale="en-GB" />);
    expect(document.querySelector(".invite-when")).toHaveClass("struck");
  });

  it("mutes a past event", () => {
    render(() => <InviteWhen invite={invite()} state="past" now={NOW} locale="en-GB" />);
    expect(document.querySelector(".invite-when")).toHaveClass("past");
  });

  it("says until when a running meeting lasts", () => {
    render(() => <InviteWhen invite={invite()} state="accepted" now={at(1, 10, 40)} live locale="en-GB" />);
    expect(document.querySelector(".invite-when")).toHaveTextContent("until 11:30");
  });
});

describe("InviteRowLines", () => {
  const lines = (over: Partial<Parameters<typeof InviteRowLines>[0]> = {}) => (
    <InviteRowLines invite={invite()} rsvp={undefined} now={NOW} onAnswer={vi.fn()} {...over} />
  );

  it("puts when, how long and where under the title, and the answer under them", () => {
    render(() => lines());
    expect(document.querySelector(".invite-meta")).toHaveTextContent(/·1 hr·Studio 2$/);
    expect(document.querySelector(".invite-meta .invite-when")).not.toBeNull();
    expect(document.querySelector(".invite-place-call")).toBeNull();
    expect(within(document.querySelector(".invite-foot") as HTMLElement).getByRole("button", { name: "Your response: not answered" })).toBeInTheDocument();
  });

  it("gives a call link the video icon", () => {
    render(() => lines({ invite: invite({ location: null, conference_url: "https://meet.google.com/x" }) }));
    expect(document.querySelector(".invite-place-call")).toHaveTextContent("Google Meet");
  });

  it("offers no answer once the event is over, or for a cancellation", () => {
    const { unmount } = render(() => lines({ now: at(2, 9) }));
    expect(screen.queryByRole("button", { name: /Your response/ })).toBeNull();
    unmount();
    render(() => lines({ invite: invite({ method: "CANCEL" }) }));
    expect(screen.queryByRole("button", { name: /Your response/ })).toBeNull();
    expect(document.querySelector(".invite-foot")).toHaveTextContent("Cancelled");
  });

  it("shows the day strip on an unanswered invite, hidden from assistive tech, with the clash named", () => {
    const strip = stripLayout({ start: at(1, 10, 30), end: at(1, 11, 30) }, [
      { title: "Dentist", start: at(1, 11), end: at(1, 12) },
      { title: "Lunch", start: at(1, 13), end: at(1, 14) },
    ], NOW);
    render(() => lines({ strip }));
    const el = document.querySelector(".invite-strip")!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.querySelectorAll(".invite-strip-busy")).toHaveLength(2);
    expect(el.querySelectorAll(".invite-strip-busy.overlap")).toHaveLength(1);
    expect(document.querySelector(".invite-clash")).toHaveTextContent("Dentist");
  });

  it("warns of a clash with a drawn icon, its title in a span that can ellipsise beside the place", () => {
    const strip = stripLayout({ start: at(1, 10, 30), end: at(1, 11, 30) }, [
      { title: "Design review — Posta v3 with the whole product team", start: at(1, 11), end: at(1, 12) },
    ], NOW);
    render(() => lines({ strip }));
    const clash = document.querySelector(".invite-clash")!;
    expect(clash.textContent).not.toMatch(/⚠/);
    expect(clash.querySelector("svg.icon-meta[data-icon=warning]")).not.toBeNull();
    expect(clash.querySelector(".invite-clash-title")).toHaveTextContent("Design review — Posta v3 with the whole product team");
    expect(document.querySelector(".invite-place svg.icon-meta")).not.toBeNull();
  });

  it("sets every glyph in the row's metadata, time and answer at the meta size", () => {
    const strip = stripLayout({ start: at(1, 10, 30), end: at(1, 11, 30) }, [{ title: "Dentist", start: at(1, 11), end: at(1, 12) }], NOW);
    const { unmount } = render(() => lines({ strip }));
    const glyphs = () => [...document.querySelectorAll(".invite-meta svg, .invite-when svg, .invite-answer svg")];
    expect(glyphs().length).toBeGreaterThanOrEqual(2);
    expect(glyphs().filter(svg => !svg.classList.contains("icon-meta"))).toEqual([]);
    unmount();
    render(() => lines({ rsvp: "accepted" }));
    expect(glyphs().length).toBeGreaterThanOrEqual(2);
    expect(glyphs().filter(svg => !svg.classList.contains("icon-meta"))).toEqual([]);
  });

  it("hides the strip once answered", () => {
    const strip = stripLayout({ start: at(1, 10, 30), end: at(1, 11, 30) }, [], NOW);
    render(() => lines({ strip, rsvp: "accepted" }));
    expect(document.querySelector(".invite-strip")).toBeNull();
  });

  it("draws the now-line and the past on today's strip", () => {
    const strip = stripLayout({ start: NOW + 3_600_000, end: NOW + 7_200_000 }, [], NOW);
    render(() => lines({ strip, invite: invite({ start_time: NOW + 3_600_000, end_time: NOW + 7_200_000 }) }));
    expect(document.querySelector(".invite-strip-now")).not.toBeNull();
    expect(document.querySelector(".invite-strip-past")).not.toBeNull();
  });

  it("shows a running meeting's progress and a Join button for its call", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const onRowClick = vi.fn();
    const live = invite({ start_time: at(1, 10), end_time: at(1, 10, 15), conference_url: "https://meet.google.com/abc" });
    render(() => <div onClick={onRowClick}>{lines({ invite: live, now: at(1, 10, 2), live: true })}</div>);
    const bar = screen.getByRole("progressbar", { name: "Meeting progress" });
    expect(bar).toHaveAttribute("aria-valuetext", "2 of 15 minutes");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "15");
    fireEvent.click(screen.getByRole("button", { name: "Join Google Meet" }));
    expect(openUrl).toHaveBeenCalledWith("https://meet.google.com/abc");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("has no Join button for a meeting without a call", () => {
    const live = invite({ start_time: at(1, 10), end_time: at(1, 10, 15) });
    render(() => lines({ invite: live, now: at(1, 10, 2), live: true }));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Join/ })).toBeNull();
  });

  it("follows the answer as it changes", () => {
    const [rsvp, setRsvp] = createSignal<string | undefined>(undefined);
    render(() => <InviteRowLines invite={invite()} rsvp={rsvp()} now={NOW} onAnswer={vi.fn()} />);
    expect(menuButton()).toHaveAccessibleName("Your response: not answered");
    setRsvp("declined");
    expect(menuButton()).toHaveAccessibleName("Your response: Not going");
  });
});
