import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { NoticesSetting } from "./NoticesSetting";
import { noticesEnabled, setNoticesEnabled } from "../app/notices";

describe("NoticesSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    setNoticesEnabled(true);
  });

  it("is a switch, on until turned off, that remembers its state", () => {
    render(() => <NoticesSetting />);
    const toggle = screen.getByRole("switch", { name: "Point out things Posta notices" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(noticesEnabled()).toBe(false);
    expect(localStorage.getItem("noticesEnabled")).toBe("false");

    fireEvent.click(toggle);
    expect(noticesEnabled()).toBe(true);
  });
});
