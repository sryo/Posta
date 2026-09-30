import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows the initial on the person's own hue, the same wherever they appear", () => {
    const { container } = render(() => <><Avatar email="ana@x.com" name="Ana" size="xs" /><Avatar email="ana@x.com" name="Ana" size="md" /></>);
    const [small, large] = container.querySelectorAll(".avatar");
    expect(small).toHaveTextContent("A");
    expect(small.getAttribute("data-hue")).toBe(large.getAttribute("data-hue"));
    expect([small.getAttribute("data-size"), large.getAttribute("data-size")]).toEqual(["xs", "md"]);
  });

  it("shows a picture when there is one, with no hue behind it", () => {
    const { container } = render(() => <Avatar email="ana@x.com" picture="https://x/a.png" size="lg" />);
    expect(container.querySelector(".avatar img")).toHaveAttribute("src", "https://x/a.png");
    expect(container.querySelector(".avatar")).not.toHaveAttribute("data-hue");
  });
});
