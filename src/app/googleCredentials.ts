// Checks on the OAuth client a user copies out of the Google Cloud Console,
// so a swapped or truncated value is caught before sign-in fails on it

const CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const GOOGLE_DOMAIN = "apps.googleusercontent.com";

export function clientIdProblem(value: string): string | null {
  const id = value.trim();
  if (!id || CLIENT_ID.test(id)) return null;
  return "A client ID ends in .apps.googleusercontent.com";
}

export function clientSecretProblem(value: string): string | null {
  const secret = value.trim();
  if (!secret) return null;
  if (secret.endsWith(GOOGLE_DOMAIN)) return "That's the client ID; the secret is the value below it";
  if (/\s/.test(secret) || secret.length < 20) return "Paste the whole client secret; it usually starts with GOCSPX-";
  return null;
}

export function credentialsValid(clientId: string, clientSecret: string): boolean {
  return !!clientId.trim() && !!clientSecret.trim() && !clientIdProblem(clientId) && !clientSecretProblem(clientSecret);
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

type ClientBlock = { client_id?: unknown; client_secret?: unknown };

// The client_secret_*.json file the Cloud Console downloads for a client
export function parseClientSecretFile(text: string): ClientCredentials {
  const notAClientFile = new Error("That isn't a client_secret file from the Google Cloud Console");
  let parsed: { installed?: ClientBlock; web?: ClientBlock };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notAClientFile;
  }
  if (!parsed?.installed && parsed?.web) throw new Error("That file is for a web client; create a Desktop app client instead");
  const block = parsed?.installed;
  if (typeof block?.client_id !== "string" || typeof block?.client_secret !== "string") throw notAClientFile;
  return { clientId: block.client_id, clientSecret: block.client_secret };
}
