import { describe, expect, it } from "vitest";
import { labelDisplayName } from "./labels";

const label = (id: string, name: string, label_type: string | null) => ({ id, name, label_type });

describe("labelDisplayName", () => {
  it("names Gmail's system labels the way Gmail shows them", () => {
    expect(labelDisplayName(label("INBOX", "INBOX", "system"))).toBe("Inbox");
    expect(labelDisplayName(label("IMPORTANT", "IMPORTANT", "system"))).toBe("Important");
    expect(labelDisplayName(label("DRAFT", "DRAFT", "system"))).toBe("Drafts");
    expect(labelDisplayName(label("CATEGORY_PROMOTIONS", "CATEGORY_PROMOTIONS", "system"))).toBe("Promotions");
  });

  it("keeps a user label's own name, even one spelled like a system label", () => {
    expect(labelDisplayName(label("Label_1", "INBOX", "user"))).toBe("INBOX");
    expect(labelDisplayName(label("Label_2", "follow-up", "user"))).toBe("follow-up");
  });

  it("tidies an unknown system label instead of showing its raw id", () => {
    expect(labelDisplayName(label("CATEGORY_NEWSLETTERS", "CATEGORY_NEWSLETTERS", "system"))).toBe("Newsletters");
    expect(labelDisplayName(label("YELLOW_STAR", "YELLOW_STAR", "system"))).toBe("Yellow star");
  });
});
