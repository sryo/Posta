import { findHeader } from "./messages";
import { parseMailto } from "./mailto";

type Headers = { name: string; value: string }[] | undefined;

export type UnsubscribeMethod =
  | { kind: "oneClick"; url: string }
  | { kind: "mailto"; to: string; subject: string; body: string }
  | { kind: "web"; url: string };

// List-Unsubscribe (RFC 2369) names a mailto: address and/or a web link;
// List-Unsubscribe-Post (RFC 8058) says the https link takes a one-click POST
export function unsubscribeMethod(headers: Headers): UnsubscribeMethod | null {
  const header = findHeader(headers, "List-Unsubscribe");
  if (!header) return null;
  const links = Array.from(header.matchAll(/<([^>]+)>/g), m => m[1].trim());
  const https = links.find(l => /^https:\/\//i.test(l));
  const mailto = links.find(l => /^mailto:/i.test(l));
  const oneClick = /List-Unsubscribe=One-Click/i.test(findHeader(headers, "List-Unsubscribe-Post") ?? "");
  if (https && oneClick) return { kind: "oneClick", url: https };
  if (mailto) {
    const { to, subject, body } = parseMailto(mailto);
    if (to) return { kind: "mailto", to, subject, body };
  }
  return https ? { kind: "web", url: https } : null;
}

export function isMailingList(headers: Headers): boolean {
  if (findHeader(headers, "List-Id") || findHeader(headers, "List-Unsubscribe")) return true;
  const precedence = findHeader(headers, "Precedence")?.trim().toLowerCase();
  return precedence === "list" || precedence === "bulk";
}

export interface UnsubscribeApi {
  sendEmail: (accountId: string, to: string, cc: string, bcc: string, subject: string, body: string) => Promise<void>;
  postOneClick: (url: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
}

// "done" when the request went out; "opened" when the list's page still
// needs the reader to finish there
export async function runUnsubscribe(accountId: string, method: UnsubscribeMethod, api: UnsubscribeApi): Promise<"done" | "opened"> {
  switch (method.kind) {
    case "oneClick":
      await api.postOneClick(method.url);
      return "done";
    case "mailto":
      await api.sendEmail(accountId, method.to, "", "", method.subject || "Unsubscribe", method.body);
      return "done";
    case "web":
      await api.openUrl(method.url);
      return "opened";
  }
}
