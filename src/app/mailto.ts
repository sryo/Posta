import type { MailtoData } from "../api/tauri";

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function appendRecipients(field: string, recipients: string): string {
  if (!recipients) return field;
  return field ? `${field}, ${recipients}` : recipients;
}

// A mailto: link (RFC 6068), read the same way as the ones macOS hands the app
export function parseMailto(url: string): MailtoData {
  const data: MailtoData = { to: "", cc: "", bcc: "", subject: "", body: "" };
  const rest = url.replace(/^mailto:/i, "");
  const query = rest.indexOf("?");
  data.to = decode(query === -1 ? rest : rest.slice(0, query));
  if (query === -1) return data;
  for (const param of rest.slice(query + 1).split("&")) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    const value = decode(param.slice(eq + 1));
    switch (param.slice(0, eq).toLowerCase()) {
      case "to": data.to = appendRecipients(data.to, value); break;
      case "cc": data.cc = appendRecipients(data.cc, value); break;
      case "bcc": data.bcc = appendRecipients(data.bcc, value); break;
      case "subject": data.subject = value; break;
      case "body": data.body = value; break;
    }
  }
  return data;
}
