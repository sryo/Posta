import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import type { Account } from "../api/tauri";
import { CardAccountQualifier, cardTitleLabel } from "./CardAccountQualifier";

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const accounts = [account("m", "mateo@posta.test"), account("w", "mateo@acme.co")];

describe("CardAccountQualifier", () => {
  it("shows the account's short label at rest and keeps the full address for hover, hidden from screen readers", () => {
    const { container } = render(() => <CardAccountQualifier accountId="m" accounts={accounts} shown problem={null} />);
    const qualifier = container.querySelector(".card-account-qualifier")!;
    expect(qualifier).toHaveAttribute("aria-hidden", "true");
    expect(qualifier.querySelector(".card-account-qualifier-short")).toHaveTextContent("posta.test");
    expect(qualifier.querySelector(".card-account-qualifier-full")).toHaveTextContent("mateo@posta.test");
  });

  it("says nothing at rest on an all-inboxes card, and all accounts on hover", () => {
    const { container } = render(() => <CardAccountQualifier accountId="all" accounts={accounts} shown problem={null} />);
    expect(container.querySelector(".card-account-qualifier-short")).toBeEmptyDOMElement();
    expect(container.querySelector(".card-account-qualifier-full")).toHaveTextContent("all accounts");
  });

  it("shows nothing when every card on the board shows the same account", () => {
    const { container } = render(() => <CardAccountQualifier accountId="m" accounts={accounts} shown={false} problem={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says what came while you were away at rest, and the account on hover", () => {
    const { container } = render(() => <CardAccountQualifier accountId="m" accounts={accounts} shown problem={null} since="6 new since last night" />);
    expect(container.querySelector(".card-account-qualifier-short")).toHaveTextContent("6 new since last night");
    expect(container.querySelector(".card-account-qualifier-full")).toHaveTextContent("mateo@posta.test");
  });

  it("keeps what came while you were away on hover when the board doesn't name accounts", () => {
    const { container } = render(() => <CardAccountQualifier accountId="m" accounts={accounts} shown={false} problem={null} since="3 new since 9:40 AM" />);
    expect(container.querySelector(".card-account-qualifier")).toHaveTextContent("3 new since 9:40 AM");
    expect(container.querySelector(".card-account-qualifier-full")).toBeNull();
  });

  it("gives its place to the word for a sync problem, even on a single-account board", () => {
    const { container } = render(() => <CardAccountQualifier accountId="m" accounts={accounts} shown={false} problem="Offline" />);
    expect(container.querySelector(".card-account-qualifier.problem")).toHaveTextContent("Offline");
    expect(container.querySelector(".card-account-qualifier-full")).toBeNull();
  });
});

describe("cardTitleLabel", () => {
  const label = (over: Partial<Parameters<typeof cardTitleLabel>[0]>) =>
    cardTitleLabel({ name: "Unread", accountId: "m", accounts, shown: true, problem: null, collapsed: false, unread: 0, ...over });

  it("names the card and its account, then what the button does", () => {
    expect(label({})).toBe("Unread, mateo@posta.test. Collapse");
    expect(label({ accountId: "all", name: "All inboxes" })).toBe("All inboxes, all accounts. Collapse");
  });

  it("leaves the account out when the board doesn't mix accounts", () => {
    expect(label({ shown: false })).toBe("Unread. Collapse");
  });

  it("announces the unread count once collapsed, as the strip shows it", () => {
    expect(label({ collapsed: true, unread: 5 })).toBe("Unread, mateo@posta.test, 5 unread. Expand");
    expect(label({ collapsed: true, unread: 0 })).toBe("Unread, mateo@posta.test. Expand");
  });

  it("says what came while you were away after the account", () => {
    expect(label({ since: "6 new since last night" })).toBe("Unread, mateo@posta.test, 6 new since last night. Collapse");
    expect(label({ shown: false, since: "6 new since last night" })).toBe("Unread, 6 new since last night. Collapse");
  });

  it("says what keeps the card from syncing", () => {
    expect(label({ shown: false, problem: "Offline" })).toBe("Unread, offline. Collapse");
  });
});
