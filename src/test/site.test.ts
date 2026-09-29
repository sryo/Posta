import { describe, it, expect } from "vitest";
import { readRepoFile } from "./files";

const site = readRepoFile("docs/index.html");

// The answer paragraph under the FAQ entry whose summary is `question`.
function faqAnswer(question: string): string {
  const entry = new RegExp(`<summary>${question}</summary>\\s*<p>([\\s\\S]*?)</p>`).exec(site);
  return entry?.[1] ?? "";
}

describe("project site", () => {
  it("says where data leaves the device, including the card layout's iCloud sync", () => {
    const answer = faqAnswer("Where is my data stored\\?");
    expect(answer).toMatch(/Gmail/);
    expect(answer).toMatch(/iCloud/);
  });
});
