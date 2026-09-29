import { describe, it, expect } from "vitest";
import { scriptColorLiteral } from "./colorLiterals";

const sources = Object.entries(
  import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!./**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

// A colour set from script: an inline style or SVG attribute naming a colour
// property, or a colour custom property written onto an element.
const COLOR_STYLE =
  /\bstyle=\{[^}]*["']?\b(background|background-color|backgroundColor|color|border-color|borderColor|outline-color|outlineColor|fill|stroke)\b["']?\s*:|["']--[\w-]*(colou?r|bg|accent)["']\s*:|setProperty\(\s*["']--[\w-]*(colou?r|bg|accent)|\.style\.(background|color|borderColor|fill|stroke)\b/;

// Literals that stay in script, each with the reason the stylesheet's tokens
// can't carry it. Keyed by file and literal.
const ALLOWED: Record<string, string> = {
  // The Google "G" on the sign-in button is a brand mark: Google's guidelines
  // fix its four colours, and it must not follow the theme or a board colour.
  "/components/Icons.tsx #4285F4": "Google brand blue",
  "/components/Icons.tsx #34A853": "Google brand green",
  "/components/Icons.tsx #FBBC05": "Google brand yellow",
  "/components/Icons.tsx #EA4335": "Google brand red",
};

const allowed = (file: string, literal: string) =>
  Object.keys(ALLOWED).some((key) => {
    const [suffix, value] = key.split(" ");
    return file.endsWith(suffix) && value === literal;
  });

function lines() {
  return sources.flatMap(([file, source]) =>
    source.split("\n").map((line, i) => ({ file, line, at: `${file}:${i + 1}` })),
  );
}

describe("inline colour", () => {
  it("reads the sources it checks", () => {
    expect(sources.some(([file]) => file.endsWith("/App.tsx"))).toBe(true);
    expect(sources.some(([file]) => file.endsWith("/shared/constants.ts"))).toBe(true);
  });

  it("recognises colour set from script in each form", () => {
    for (const line of [
      `<div style={{ background: getAvatarColor(name) }}>`,
      `<div style={props.color ? { background: HEX[props.color] } : {}}>`,
      `<div style={{ "background-color": x }}>`,
      `<div style={hex() ? { "--pill-color": hex() } : undefined}>`,
      `<div style={props.focusColor ? { '--message-focused-color': props.focusColor } as any : undefined}>`,
      `root.setProperty("--accent", hex);`,
      `root.setProperty("--app-bg", background);`,
      `el.style.background = "red";`,
    ]) {
      expect(COLOR_STYLE.test(line), line).toBe(true);
    }
    for (const line of [`red: "#E53935",`, `{ light: "rgba(229, 57, 53, 0.18)" }`, `const c = 'oklch(0.5 0.1 250)';`]) {
      expect(scriptColorLiteral(line), line).not.toBeNull();
    }
    for (const line of [
      `<div style={{ width: "10px" }}>`,
      `document.documentElement.style.setProperty("--card-width", \`\${w}px\`);`,
      `<a href="#inbox">`,
      `<CardPill color={props.card?.color}>`,
    ]) {
      expect(COLOR_STYLE.test(line) || scriptColorLiteral(line) !== null, line).toBe(false);
    }
  });

  it("leaves colour to the stylesheet's tokens, passing a hue by name", () => {
    const offenders = lines()
      .filter(({ file, line }) => {
        const literal = scriptColorLiteral(line);
        return COLOR_STYLE.test(line) || (literal !== null && !allowed(file, literal));
      })
      .map(({ at, line }) => `${at}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("keeps each allowed literal in use, so the list can't outlive what it excuses", () => {
    for (const key of Object.keys(ALLOWED)) {
      const [suffix, value] = key.split(" ");
      const used = lines().some(({ file, line }) => file.endsWith(suffix) && scriptColorLiteral(line) === value);
      expect(used, key).toBe(true);
    }
  });
});
