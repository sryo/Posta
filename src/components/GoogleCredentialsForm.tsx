import { createSignal, Show } from "solid-js";
import { clientIdProblem, clientSecretProblem, credentialsValid, parseClientSecretFile } from "../app/googleCredentials";

const CONSOLE = "https://console.cloud.google.com";

// The Cloud Console steps that give Posta an OAuth client, with a link to
// each page
export function GoogleSetupSteps() {
  return (
    <ol class="credentials-steps">
      <li>
        Open <a href={`${CONSOLE}/apis/credentials`} class="settings-link">Credentials</a> and create an OAuth client of type "Desktop app".
      </li>
      <li>
        Enable the <a href={`${CONSOLE}/apis/library/gmail.googleapis.com`} class="settings-link">Gmail</a>,{" "}
        <a href={`${CONSOLE}/apis/library/calendar-json.googleapis.com`} class="settings-link">Calendar</a> and{" "}
        <a href={`${CONSOLE}/apis/library/people.googleapis.com`} class="settings-link">People</a> APIs.
      </li>
      <li>
        In <a href={`${CONSOLE}/auth/audience`} class="settings-link">Audience</a>, add your Google address as a test user.
      </li>
      <li>Paste the client ID and secret below, or drop the downloaded file.</li>
    </ol>
  );
}

export function GoogleCredentialsForm(props: {
  idPrefix: string;
  clientId: string;
  clientSecret: string;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onSubmit?: () => void;
  onEscape?: () => void;
  showPortHint?: boolean;
}) {
  const [dragging, setDragging] = createSignal(false);
  const [fileError, setFileError] = createSignal<string | null>(null);
  const idProblem = () => clientIdProblem(props.clientId);
  const secretProblem = () => clientSecretProblem(props.clientSecret);
  const idMessageId = `${props.idPrefix}-client-id-problem`;
  const secretMessageId = `${props.idPrefix}-client-secret-problem`;

  async function readFile(file: File | undefined) {
    if (!file) return;
    try {
      const { clientId, clientSecret } = parseClientSecretFile(await file.text());
      setFileError(null);
      props.onClientId(clientId);
      props.onClientSecret(clientSecret);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onEscape?.();
    else if (e.key === "Enter" && credentialsValid(props.clientId, props.clientSecret)) props.onSubmit?.();
  };

  return (
    <div class="credentials-form">
      <GoogleSetupSteps />
      <div
        class={`credentials-drop-zone ${dragging() ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFile(e.dataTransfer?.files?.[0]);
        }}
      >
        <span>Drop client_secret.json here</span>
        <label class="link-btn">
          or choose the file
          <input
            type="file"
            accept="application/json,.json"
            class="visually-hidden"
            onChange={(e) => { readFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}
          />
        </label>
      </div>
      <Show when={fileError()}>
        <p class="field-problem" role="alert">{fileError()}</p>
      </Show>
      <div class="settings-form-group">
        <label for={`${props.idPrefix}-client-id`}>OAuth client ID</label>
        <input
          id={`${props.idPrefix}-client-id`}
          type="text"
          spellcheck={false}
          value={props.clientId}
          onInput={(e) => props.onClientId(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="xxxx.apps.googleusercontent.com"
          aria-invalid={idProblem() ? "true" : undefined}
          aria-describedby={idProblem() ? idMessageId : undefined}
        />
        <Show when={idProblem()}>
          <p class="field-problem" id={idMessageId}>{idProblem()}</p>
        </Show>
      </div>
      <div class="settings-form-group">
        <label for={`${props.idPrefix}-client-secret`}>OAuth client secret</label>
        <input
          id={`${props.idPrefix}-client-secret`}
          type="password"
          value={props.clientSecret}
          onInput={(e) => props.onClientSecret(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="GOCSPX-..."
          aria-invalid={secretProblem() ? "true" : undefined}
          aria-describedby={secretProblem() ? secretMessageId : undefined}
        />
        <Show when={secretProblem()}>
          <p class="field-problem" id={secretMessageId}>{secretProblem()}</p>
        </Show>
      </div>
      <Show when={props.showPortHint}>
        <p class="settings-hint">
          Sign-in listens on <code>localhost</code> port 8420; another app using that port keeps it from finishing.
        </p>
      </Show>
    </div>
  );
}
