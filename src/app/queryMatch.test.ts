import { describe, expect, it } from "vitest";
import { cardWouldList, gmailLabelName } from "./queryMatch";

const labelId = (name: string) => ({ receipts: "Label_1", "clients-acme": "Label_2" } as Record<string, string>)[name];

describe("cardWouldList", () => {
  it("lists a thread whose labels answer every word of the query", () => {
    expect(cardWouldList("in:inbox", ["INBOX"], labelId)).toBe(true);
    expect(cardWouldList("is:starred", ["INBOX", "STARRED"], labelId)).toBe(true);
    expect(cardWouldList("label:receipts", ["Label_1"], labelId)).toBe(true);
    expect(cardWouldList("in:inbox is:unread", ["INBOX", "UNREAD"], labelId)).toBe(true);
    expect(cardWouldList("is:important", ["IMPORTANT"], labelId)).toBe(true);
  });

  it("knows a thread a word rules out", () => {
    expect(cardWouldList("in:inbox", ["STARRED"], labelId)).toBe(false);
    expect(cardWouldList("is:starred in:inbox", ["STARRED"], labelId)).toBe(false);
    expect(cardWouldList("-in:inbox", ["INBOX"], labelId)).toBe(false);
    expect(cardWouldList("is:read", ["UNREAD"], labelId)).toBe(false);
  });

  it("reads label names as Gmail writes them in a query", () => {
    expect(cardWouldList("label:Clients/Acme", ["Label_2"], labelId)).toBe(true);
    expect(cardWouldList("label:RECEIPTS", ["Label_1"], labelId)).toBe(true);
  });

  it("can't tell for any word it doesn't read from labels alone", () => {
    expect(cardWouldList("from:ana@x.com", ["INBOX"], labelId)).toBeNull();
    expect(cardWouldList("in:inbox has:attachment", ["INBOX"], labelId)).toBeNull();
    expect(cardWouldList("label:unknown", ["Label_9"], labelId)).toBeNull();
    expect(cardWouldList("invoice", ["INBOX"], labelId)).toBeNull();
    expect(cardWouldList("", ["INBOX"], labelId)).toBeNull();
    expect(cardWouldList("{in:inbox is:starred}", ["INBOX"], labelId)).toBeNull();
  });

  it("still rules a thread out with a word it reads when it can't read another", () => {
    expect(cardWouldList("in:inbox from:ana@x.com", ["STARRED"], labelId)).toBe(false);
  });

  it("leaves spam and trash out unless the query asks for them", () => {
    expect(cardWouldList("is:starred", ["STARRED", "TRASH"], labelId)).toBe(false);
    expect(cardWouldList("in:trash", ["TRASH"], labelId)).toBeNull();
  });
});

describe("gmailLabelName", () => {
  it("writes a label's name the way a query names it", () => {
    expect(gmailLabelName("Clients/Acme")).toBe("clients-acme");
    expect(gmailLabelName("Read later")).toBe("read-later");
  });
});
