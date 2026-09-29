import { createSignal, Show } from "solid-js";
import { credentialsValid } from "../app/googleCredentials";
import { GoogleCredentialsForm } from "./GoogleCredentialsForm";
import { GoogleLogo } from "./Icons";

// The signed-out screen: first-run setup of the user's own OAuth client, or a
// single sign-in once one is stored. hasClient is undefined while the stored
// client couldn't be read, and sign-in then reports why.
export function AuthScreen(props: {
  hasClient: boolean | undefined;
  clientId: string;
  clientSecret: string;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onSignIn: () => void;
  onSaveAndSignIn: () => void;
  showPortHint: boolean;
}) {
  const [changing, setChanging] = createSignal(false);
  const settingUp = () => props.hasClient === false || changing();
  const valid = () => credentialsValid(props.clientId, props.clientSecret);
  const saveAndSignIn = () => {
    if (!valid()) return;
    setChanging(false);
    props.onSaveAndSignIn();
  };

  return (
    <Show
      when={settingUp()}
      fallback={
        <div class="auth-screen">
          <h1>Posta</h1>
          <p>Your inbox, organized</p>
          <button class="auth-btn" onClick={() => props.onSignIn()}>
            <GoogleLogo />
            Sign in with Google
          </button>
          <button class="auth-settings-btn" onClick={() => setChanging(true)}>Change credentials</button>
        </div>
      }
    >
      <div class="auth-screen auth-setup">
        <h1>Set up Posta</h1>
        <p>Posta talks to Gmail through your own Google Cloud project. About 5 minutes, once.</p>
        <section class="auth-step">
          <h2><span class="auth-step-number">1</span> Add Google credentials</h2>
          <GoogleCredentialsForm
            idPrefix="setup"
            clientId={props.clientId}
            clientSecret={props.clientSecret}
            onClientId={props.onClientId}
            onClientSecret={props.onClientSecret}
            onSubmit={saveAndSignIn}
            showPortHint={props.showPortHint}
          />
        </section>
        <section class="auth-step">
          <h2><span class="auth-step-number">2</span> Sign in with Google</h2>
          <button class="auth-btn" disabled={!valid()} onClick={saveAndSignIn}>
            <GoogleLogo />
            Sign in with Google
          </button>
        </section>
        <Show when={changing()}>
          <button class="auth-settings-btn" onClick={() => setChanging(false)}>Keep current credentials</button>
        </Show>
      </div>
    </Show>
  );
}
