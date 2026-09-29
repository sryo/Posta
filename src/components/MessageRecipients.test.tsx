import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { MessageRecipients } from "./MessageRecipients";

describe("MessageRecipients", () => {
  it("names the first recipients briefly, the user as me, and counts the rest", () => {
    render(() => (
      <MessageRecipients
        to='Ana Pérez <ana@x.com>, "Martin, Jules" <jules@x.com>, me@x.com'
        cc="Sofía Gómez <sofia@x.com>, lucas@x.com"
        currentUserEmail="ME@x.com"
      />
    ));
    const toggle = screen.getByRole("button", { name: /^to Ana, Jules \+3$/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/sofia@x.com/)).toBeNull();
  });

  it("lists every To and Cc address in full once opened", () => {
    render(() => <MessageRecipients to="Ana Pérez <ana@x.com>" cc="lucas@x.com" currentUserEmail="me@x.com" />);
    fireEvent.click(screen.getByRole("button", { name: /to Ana/ }));
    expect(screen.getByRole("button", { name: /to Ana/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("lucas@x.com")).toBeInTheDocument();
    expect(screen.getByText("Cc")).toBeInTheDocument();
  });

  it("writes an opened recipient as a name with its address beside it, like the sender", () => {
    const { container } = render(() => <MessageRecipients to={'"Martin, Jules" <jules@x.com>, lucas@x.com'} />);
    fireEvent.click(screen.getByRole("button", { name: /to Jules/ }));
    const [named, bare] = Array.from(container.querySelectorAll(".message-recipient"));
    expect(named.querySelector(".message-recipient-name")?.textContent).toBe("Martin, Jules");
    expect(named.querySelector(".message-recipient-address")?.textContent).toBe("jules@x.com");
    expect(container.textContent).not.toContain("<");
    expect(bare.querySelector(".message-recipient-name")?.textContent).toBe("lucas@x.com");
    expect(bare.querySelector(".message-recipient-address")).toBeNull();
  });

  it("renders nothing when the message names no recipients", () => {
    const { container } = render(() => <MessageRecipients to="" cc="" />);
    expect(container.innerHTML).toBe("");
  });
});
