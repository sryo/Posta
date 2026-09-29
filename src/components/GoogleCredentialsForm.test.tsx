import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { GoogleCredentialsForm } from "./GoogleCredentialsForm";

const ID = `${"1234567890"}-abcdefghijklmnop.apps.googleusercontent.com`;
const SECRET = "GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz12";

function renderForm(opts: { showPortHint?: boolean; onSubmit?: () => void } = {}) {
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  render(() => (
    <GoogleCredentialsForm
      idPrefix="test"
      clientId={clientId()}
      clientSecret={clientSecret()}
      onClientId={setClientId}
      onClientSecret={setClientSecret}
      onSubmit={opts.onSubmit}
      showPortHint={opts.showPortHint}
    />
  ));
  return { clientId, clientSecret };
}

const jsonFile = (content: unknown) =>
  new File([typeof content === "string" ? content : JSON.stringify(content)], "client_secret_123.json", { type: "application/json" });

describe("GoogleCredentialsForm", () => {
  it("walks through the Cloud Console steps with links to each page", () => {
    renderForm();
    const steps = screen.getAllByRole("listitem").map(li => li.textContent);
    expect(steps.join(" ")).toMatch(/Desktop app/);
    expect(steps.join(" ")).toMatch(/Gmail.*Calendar.*People/);
    expect(steps.join(" ")).toMatch(/test user/);
    expect(screen.getByRole("link", { name: "Credentials" })).toHaveAttribute("href", "https://console.cloud.google.com/apis/credentials");
    expect(screen.getByRole("link", { name: "Gmail" })).toHaveAttribute("href", "https://console.cloud.google.com/apis/library/gmail.googleapis.com");
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("href", "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com");
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "https://console.cloud.google.com/apis/library/people.googleapis.com");
    expect(screen.getByRole("link", { name: "Audience" })).toHaveAttribute("href", "https://console.cloud.google.com/auth/audience");
  });

  it("labels the fields in Google's terms and hides the secret", () => {
    renderForm();
    expect(screen.getByLabelText("OAuth client ID")).toHaveAttribute("placeholder", "xxxx.apps.googleusercontent.com");
    expect(screen.getByLabelText("OAuth client secret")).toHaveAttribute("type", "password");
  });

  it("says what is wrong with a value inline and ties the message to its field", () => {
    renderForm();
    const id = screen.getByLabelText("OAuth client ID");
    fireEvent.input(id, { target: { value: "GOCSPX-oops" } });
    const message = screen.getByText(/ends in \.apps\.googleusercontent\.com/);
    expect(id).toHaveAttribute("aria-invalid", "true");
    expect(id.getAttribute("aria-describedby")).toBe(message.id);

    fireEvent.input(id, { target: { value: ID } });
    expect(screen.queryByText(/ends in \.apps\.googleusercontent\.com/)).not.toBeInTheDocument();
    expect(id).not.toHaveAttribute("aria-invalid");
  });

  it("fills both fields from a dropped client_secret file", async () => {
    const values = renderForm();
    const zone = screen.getByText(/Drop client_secret/).closest(".credentials-drop-zone")!;
    fireEvent.dragOver(zone, { dataTransfer: { files: [], types: ["Files"] } });
    expect(zone).toHaveClass("dragging");
    fireEvent.drop(zone, { dataTransfer: { files: [jsonFile({ installed: { client_id: ID, client_secret: SECRET } })] } });

    await waitFor(() => expect(values.clientId()).toBe(ID));
    expect(values.clientSecret()).toBe(SECRET);
    expect(zone).not.toHaveClass("dragging");
  });

  it("fills both fields from a chosen file, and says when the file isn't a client file", async () => {
    const values = renderForm();
    const input = screen.getByLabelText(/choose the file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [jsonFile({ web: { client_id: ID, client_secret: SECRET } })] } });
    expect(await screen.findByText(/web client/)).toBeInTheDocument();
    expect(values.clientId()).toBe("");

    fireEvent.change(input, { target: { files: [jsonFile({ installed: { client_id: ID, client_secret: SECRET } })] } });
    await waitFor(() => expect(values.clientId()).toBe(ID));
    expect(screen.queryByText(/web client/)).not.toBeInTheDocument();
  });

  it("submits on Enter only once both values are valid", () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    const id = screen.getByLabelText("OAuth client ID");
    fireEvent.input(id, { target: { value: ID } });
    fireEvent.keyDown(id, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    const secret = screen.getByLabelText("OAuth client secret");
    fireEvent.input(secret, { target: { value: SECRET } });
    fireEvent.keyDown(secret, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves out the local sign-in port while nothing has failed", () => {
    renderForm();
    expect(screen.queryByText(/8420/)).not.toBeInTheDocument();
  });

  it("mentions the local sign-in port after a sign-in failed", () => {
    renderForm({ showPortHint: true });
    expect(screen.getByText(/8420/)).toBeInTheDocument();
  });
});
