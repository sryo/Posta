import { describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import type { Account } from "../api/tauri";
import { getAvatarColor } from "../utils";
import { CardAccountBadge } from "./CardAccountBadge";

const account = (id: string, email: string): Account => ({ id, email, picture: null, signature: null });
const accounts = [account("a", "ana@x.com"), account("b", "bo@work.com")];

describe("CardAccountBadge", () => {
  it("shows the initial of the card's account in its color, naming it", () => {
    render(() => <CardAccountBadge accountId="b" accounts={accounts} />);
    const badge = screen.getByTitle("bo@work.com");
    expect(badge).toHaveTextContent("B");
    expect(badge).toHaveAccessibleName("bo@work.com");
    const expected = document.createElement("span");
    expected.style.background = getAvatarColor("bo@work.com");
    expect(badge.style.background).toBe(expected.style.background);
  });

  it("gives two accounts whose addresses hash alike different colours", () => {
    const alike = [account("a", "mateo@posta.test"), account("b", "mateo.work@acme.test")];
    expect(getAvatarColor(alike[0].email)).toBe(getAvatarColor(alike[1].email));
    render(() => <><CardAccountBadge accountId="a" accounts={alike} /><CardAccountBadge accountId="b" accounts={alike} /></>);
    const first = screen.getByTitle("mateo@posta.test").style.background;
    const second = screen.getByTitle("mateo.work@acme.test").style.background;
    expect(first).not.toBe(second);
  });

  it("shows the account's photo when it has one", () => {
    const withPhoto = [account("a", "ana@x.com"), { ...account("b", "bo@work.com"), picture: "https://example.test/bo.png" }];
    render(() => <CardAccountBadge accountId="b" accounts={withPhoto} />);
    expect(screen.getByTitle("bo@work.com").querySelector("img")?.getAttribute("src")).toBe("https://example.test/bo.png");
  });

  it("says All on an all-inboxes card", () => {
    render(() => <CardAccountBadge accountId="all" accounts={accounts} />);
    expect(screen.getByTitle("All inboxes")).toHaveTextContent("All");
  });

  it("shows nothing with one account signed in", () => {
    const { container } = render(() => <CardAccountBadge accountId="a" accounts={accounts.slice(0, 1)} />);
    expect(container).toBeEmptyDOMElement();
  });
});
