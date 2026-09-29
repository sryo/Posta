import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render, screen } from "@solidjs/testing-library";
import { CardEmpty, PostmarkDefs } from "./CardStates";
import { createPostmarkLedger } from "../app/postmark";

const cleared = new Date(2026, 8, 29, 14, 14);

function setup(overrides: Partial<Parameters<typeof CardEmpty>[0]> = {}) {
  const ledger = createPostmarkLedger(() => cleared);
  const props = {
    cardId: "card-a",
    name: "Hot",
    query: "is:important newer_than:1d",
    kind: "mail" as const,
    plain: false,
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

  it("says plainly that nothing matches while the query is being previewed", () => {
    render(() => <CardEmpty {...setup({ plain: true, query: "is:typo" })} />);
    expect(document.querySelector(".empty")).toHaveTextContent("Nothing matches is:typo");
    expect(document.querySelector(".postmark")).toBeNull();
  });

  it("switches between the plain line and the stamp as the preview starts and ends", () => {
    const [plain, setPlain] = createSignal(true);
    const props = setup();
    render(() => <CardEmpty {...props} plain={plain()} />);
    expect(document.querySelector(".postmark")).toBeNull();
    setPlain(false);
    expect(document.querySelector(".postmark")).not.toBeNull();
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
