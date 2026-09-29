import { describe, expect, it } from "vitest";
import { clientIdProblem, clientSecretProblem, credentialsValid, parseClientSecretFile, shortClientId } from "./googleCredentials";

const ID = `${"1234567890"}-abcdefghijklmnop0123456789ab.apps.googleusercontent.com`;
const SECRET = "GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz12";

describe("clientIdProblem", () => {
  it("accepts a Google OAuth client ID, ignoring surrounding spaces", () => {
    expect(clientIdProblem(ID)).toBeNull();
    expect(clientIdProblem(`  ${ID}\n`)).toBeNull();
  });

  it("says nothing while the field is empty", () => {
    expect(clientIdProblem("")).toBeNull();
    expect(clientIdProblem("   ")).toBeNull();
  });

  it("explains what a client ID looks like when the value isn't one", () => {
    expect(clientIdProblem("GOCSPX-abc")).toMatch(/ends in \.apps\.googleusercontent\.com/);
    expect(clientIdProblem("1234.apps.googleusercontent.com.evil")).not.toBeNull();
    expect(clientIdProblem("my project")).not.toBeNull();
  });
});

describe("clientSecretProblem", () => {
  it("accepts current and older client secrets", () => {
    expect(clientSecretProblem(SECRET)).toBeNull();
    expect(clientSecretProblem("aBcD1234eFgH5678iJkL9012")).toBeNull();
  });

  it("says nothing while the field is empty", () => {
    expect(clientSecretProblem("")).toBeNull();
  });

  it("flags a pasted client ID or a value with spaces", () => {
    expect(clientSecretProblem(ID)).toMatch(/client ID/);
    expect(clientSecretProblem("GOCSPX-abc def")).not.toBeNull();
    expect(clientSecretProblem("short")).not.toBeNull();
  });
});

describe("credentialsValid", () => {
  it("needs both values present and well formed", () => {
    expect(credentialsValid(ID, SECRET)).toBe(true);
    expect(credentialsValid(ID, "")).toBe(false);
    expect(credentialsValid("", SECRET)).toBe(false);
    expect(credentialsValid("nope", SECRET)).toBe(false);
  });
});

describe("parseClientSecretFile", () => {
  it("reads a Desktop app client downloaded from the Cloud Console", () => {
    const file = JSON.stringify({ installed: { client_id: ID, client_secret: SECRET, redirect_uris: ["http://localhost"] } });
    expect(parseClientSecretFile(file)).toEqual({ clientId: ID, clientSecret: SECRET });
  });

  it("asks for a Desktop app client when the file holds a web client", () => {
    const file = JSON.stringify({ web: { client_id: ID, client_secret: SECRET } });
    expect(() => parseClientSecretFile(file)).toThrow(/Desktop app/);
  });

  it("says the file isn't a client secret file when it is anything else", () => {
    expect(() => parseClientSecretFile("not json")).toThrow(/client_secret/);
    expect(() => parseClientSecretFile(JSON.stringify({ installed: { client_id: ID } }))).toThrow(/client_secret/);
  });
});

describe("shortClientId", () => {
  it("keeps the start of the project number and the Google domain", () => {
    expect(shortClientId(ID)).toBe("1234…apps.googleusercontent.com");
  });

  it("leaves an unexpected value short but recognisable", () => {
    expect(shortClientId("abc")).toBe("abc");
  });
});
