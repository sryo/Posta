import { describe, it, expect } from "vitest";

const sources = Object.entries(
  import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!./**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

// A size, weight, leading, tracking or family set from script, as a style
// property (camelCase or dashed), an SVG attribute, or a font shorthand.
const TYPE_STYLE =
  /\b(font-size|fontSize|font-weight|fontWeight|line-height|lineHeight|letter-spacing|letterSpacing|font-family|fontFamily)\b|["']font["']\s*:|\.style\.font\b/;

// The postmarks' lettering is drawn in each stamp's viewBox units, so its
// sizes scale with the SVG rather than sitting on the type scale.
const isPostmarkText = (file: string, line: string) =>
  (file.endsWith("/components/CardStates.tsx") || file.endsWith("/components/TransitGap.tsx")) &&/^\s*(\{\(meridiem\) => )?<text\b/.test(line);

describe("inline type", () => {
  it("reads the sources it checks", () => {
    expect(sources.some(([file]) => file.endsWith("/App.tsx"))).toBe(true);
    expect(sources.some(([file]) => file.endsWith("/components/CardStates.tsx"))).toBe(true);
  });

  it("recognises type set from script in each form", () => {
    for (const line of [
      `<span style={{ "font-size": "12px" }}>`,
      `<span style={{ fontWeight: 500 }}>`,
      `<span style="line-height: 1.4">`,
      `el.style.font = "600 12px system-ui";`,
      `<text font-size="7">`,
    ]) {
      expect(TYPE_STYLE.test(line), line).toBe(true);
    }
  });

  it("leaves size, weight and leading to the stylesheet's type roles", () => {
    const offenders = sources.flatMap(([file, source]) =>
      source
        .split("\n")
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => TYPE_STYLE.test(line) && !isPostmarkText(file, line))
        .map(({ line, at }) => `${at}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
