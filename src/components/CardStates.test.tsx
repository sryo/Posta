import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { CardEmpty, PostmarkDefs, type NoMatch } from "./CardStates";
import { createPostmarkLedger } from "../app/postmark";

const cleared = new Date(2026, 8, 29, 14, 14);

function setup(overrides: Partial<Parameters<typeof CardEmpty>[0]> = {}) {
  const ledger = createPostmarkLedger(() => cleared);
  const props = {
    cardId: "card-a",
    name: "Hot",
    query: "is:important newer_than:1d",
    kind: "mail" as const,
    noMatch: null as NoMatch | null,
    ledger,
    locale: "en-US",
    ...overrides,
  };
  return props;
}

describe("CardEmpty", () => {
  it("stamps a postmark labelled with the card, the time it emptied and its query", () => {
    render(() => <CardEmpty {...setup()} />);
    const status = screen.getByRole("status", {
      name: "Hot is empty. Cleared at 2:14 p.m. Query: is:important newer_than:1d",
    });
    expect(status.querySelector("svg.postmark")).not.toBeNull();
    expect(status).toHaveTextContent("HOT · POSTA");
    expect(status).toHaveTextContent("29 SEP 2026");
    expect(status).toHaveTextContent("2:14");
    expect(status.querySelector(".empty-line")?.textContent).toMatch(/^(Nothing left to sort\.|All delivered\.|Pile's empty\.)$/);
    expect(status.querySelector(".empty-query")).toHaveTextContent("is:important newer_than:1d");
    expect(status).not.toHaveTextContent("Nothing matches");
  });

  it("uses calendar copy on a calendar card", () => {
    render(() => <CardEmpty {...setup({ kind: "calendar", query: "calendar:tomorrow" })} />);
    expect(screen.getByRole("status").querySelector(".empty-line")).toHaveTextContent("Tomorrow's free.");
  });

  it("returns an edited query that finds nothing to sender, showing the query, not a postmark", () => {
    render(() => <CardEmpty {...setup({ noMatch: { kind: "query" }, query: "is:typo" })} />);
    const status = screen.getByRole("status", { name: "No mail matches is:typo" });
    expect(status).toHaveClass("returned");
    expect(status).toHaveTextContent("RETURN TO");
    expect(status).toHaveTextContent("No such address.");
    expect(status.querySelector(".empty-query")).toHaveTextContent("is:typo");
    expect(status).not.toHaveTextContent("POSTA");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names what the typed filter didn't find, not the card's query, and offers to search all mail or clear it", () => {
    const onSearch = vi.fn();
    const onClear = vi.fn();
    render(() => <CardEmpty {...setup({ noMatch: { kind: "filter", term: "invoice", onSearch, onClear } })} />);
    const status = screen.getByRole("status", { name: "Nothing loaded in Hot matches invoice" });
    expect(status.querySelector(".empty-line")).toHaveTextContent("Nothing loaded for invoice");
    expect(status).not.toHaveTextContent("is:important newer_than:1d");
    fireEvent.click(screen.getByRole("button", { name: "Search all mail" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("says Gmail had nothing on an empty search card", () => {
    render(() => <CardEmpty {...setup({ noMatch: { kind: "search", term: "from:ghost" } })} />);
    expect(screen.getByRole("status", { name: "Gmail has nothing for from:ghost" })).toHaveTextContent("Gmail has nothing for from:ghost");
  });

  it("carries a narrow magnifier stamp beside the wide handstamp, for small cards", () => {
    render(() => <CardEmpty {...setup({ noMatch: { kind: "query" } })} />);
    expect(document.querySelector("svg.returned-wide")).not.toBeNull();
    expect(document.querySelector("svg.returned-narrow")).toHaveTextContent("FOUND");
  });

  it("switches between the returned stamp and the postmark as the preview starts and ends", () => {
    const [noMatch, setNoMatch] = createSignal<NoMatch | null>({ kind: "query" });
    const props = setup();
    render(() => <CardEmpty {...props} noMatch={noMatch()} />);
    expect(document.querySelector(".postmarked")).toBeNull();
    setNoMatch(null);
    expect(document.querySelector(".postmarked")).not.toBeNull();
    expect(document.querySelector(".returned")).toBeNull();
  });

  it("lands the stamp only when the card had threads before", () => {
    const props = setup();
    props.ledger.sawContent(props.cardId, props.query);
    render(() => <CardEmpty {...props} />);
    expect(document.querySelector(".postmark")).toHaveClass("lands");
  });

  it("does not land a stamp on a card empty from the start", () => {
    render(() => <CardEmpty {...setup()} />);
    expect(document.querySelector(".postmark")).not.toHaveClass("lands");
  });

  it("does not land again when the same empty card renders again", () => {
    const props = setup();
    props.ledger.sawContent(props.cardId, props.query);
    const first = render(() => <CardEmpty {...props} />);
    first.unmount();
    render(() => <CardEmpty {...props} />);
    expect(document.querySelector(".postmark")).not.toHaveClass("lands");
  });

  it("tilts the stamp by the card's own angle", () => {
    render(() => <CardEmpty {...setup()} />);
    expect((document.querySelector(".postmark") as SVGElement).style.getPropertyValue("--tilt")).toMatch(/^-?\d+deg$/);
  });

  it("points at the shared stamp defs", () => {
    render(() => (
      <>
        <PostmarkDefs />
        <CardEmpty {...setup()} />
      </>
    ));
    expect(document.querySelectorAll("#postmark-ink")).toHaveLength(1);
    expect(document.querySelector("#postmark-ring-top")).not.toBeNull();
    expect(document.querySelector("#postmark-ring-bottom")).not.toBeNull();
    expect(document.querySelector(".postmark g[filter]")?.getAttribute("filter")).toBe("url(#postmark-ink)");
  });
});
