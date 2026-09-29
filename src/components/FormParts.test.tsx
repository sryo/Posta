import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { CancelButton, FieldRow, FormFooter, SubmitButton, TitleField } from "./FormParts";

describe("FieldRow", () => {
  it("names its control with its label", () => {
    const { getByLabelText, container } = render(() => (
      <FieldRow label="Location" for="where"><input id="where" /></FieldRow>
    ));
    expect(getByLabelText("Location")).toBe(container.querySelector("#where"));
    expect(container.firstElementChild).toHaveClass("form-field-row");
  });

  it("can go without a label", () => {
    const { container } = render(() => <FieldRow><span>Has a Google Meet link</span></FieldRow>);
    expect(container.querySelector("label")).toBeNull();
    expect(container.firstElementChild).toHaveTextContent("Has a Google Meet link");
  });
});

describe("TitleField", () => {
  it("is a large borderless input named by its placeholder's words", () => {
    const onInput = vi.fn();
    const { getByRole } = render(() => <TitleField value="Lunch" placeholder="Event title" onInput={onInput} />);
    const input = getByRole("textbox", { name: "Event title" }) as HTMLInputElement;
    expect(input).toHaveClass("form-title-field");
    expect(input).toHaveValue("Lunch");
    fireEvent.input(input, { target: { value: "Dinner" } });
    expect(onInput).toHaveBeenCalledWith("Dinner");
  });
});

describe("SubmitButton", () => {
  it("shows its label with the ⌘↵ shortcut and runs on click", () => {
    const onClick = vi.fn();
    const { getByRole } = render(() => <SubmitButton label="Save" onClick={onClick} />);
    const button = getByRole("button", { name: /Save/ });
    expect(button).toHaveClass("btn", "btn-primary");
    expect(button.querySelector(".shortcut-hint")).toHaveTextContent("⌘↵");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("says what it is doing and can't be pressed again while busy", () => {
    const { getByRole } = render(() => <SubmitButton label="Send" busy busyLabel="Sending..." onClick={vi.fn()} />);
    const button = getByRole("button", { name: "Sending..." });
    expect(button).toBeDisabled();
  });

  it("can be disabled", () => {
    const { getByRole } = render(() => <SubmitButton label="Save" disabled onClick={vi.fn()} />);
    expect(getByRole("button", { name: /Save/ })).toBeDisabled();
  });
});

describe("CancelButton", () => {
  it("shows the Escape shortcut", () => {
    const onClick = vi.fn();
    const { getByRole } = render(() => <CancelButton onClick={onClick} />);
    const button = getByRole("button", { name: /Cancel/ });
    expect(button.querySelector(".shortcut-hint")).toHaveTextContent("ESC");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("FormFooter", () => {
  it("puts what leads on the left, then a status, then its buttons on the right", () => {
    const { container } = render(() => (
      <FormFooter class="compose-footer" leading={<button>Attach</button>} status="Draft saved">
        <SubmitButton label="Send" onClick={vi.fn()} />
      </FormFooter>
    ));
    const footer = container.firstElementChild as HTMLElement;
    expect(footer).toHaveClass("form-footer", "compose-footer");
    const parts = [...footer.children].map(el => el.className || el.tagName);
    expect(parts).toEqual(["BUTTON", "form-footer-status", "form-footer-actions"]);
    expect(footer.querySelector(".form-footer-status")).toHaveTextContent("Draft saved");
  });

  it("shows an error in place of the status, announced", () => {
    const { container } = render(() => (
      <FormFooter error="Couldn't send the reply." status="Draft saved">
        <SubmitButton label="Send" onClick={vi.fn()} />
      </FormFooter>
    ));
    const status = container.querySelector(".form-footer-status")!;
    expect(status).toHaveTextContent("Couldn't send the reply.");
    expect(status).not.toHaveTextContent("Draft saved");
    expect(status.querySelector('[role="alert"]')).toHaveClass("compose-error");
  });
});
