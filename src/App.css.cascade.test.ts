import { describe, it, expect } from "vitest";
import { cascadedDeclarations, parseRules, specificity } from "./test/css";
import { readRepoFile } from "./test/files";

const rules = parseRules(readRepoFile("src/App.css").replace(/\/\*[\s\S]*?\*\//g, ""));

describe("App.css cascade", () => {
  it("sizes code inside a preformatted block like the block itself", () => {
    document.body.innerHTML =
      '<div class="message-body"><pre><code id="block">x</code></pre><p><code id="inline">y</code></p></div>';
    const size = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!).get("font-size");
    expect(size("block")).toBe("inherit");
    expect(size("inline")).toBe("var(--size-13)");
  });

  it("gives code inside a preformatted block no chip padding or background of its own", () => {
    document.body.innerHTML =
      '<div class="message-body"><pre><code id="block">x</code></pre><p><code id="inline">y</code></p></div>';
    const decl = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!);
    expect(decl("inline").get("padding")).toBe("var(--space-xs) var(--space-md)");
    expect(decl("inline").get("background")).toBe("var(--bg-hover)");
    expect(decl("block").get("padding")).toBe("0");
    expect(decl("block").get("background")).toBe("none");
  });

  it("keeps an email's fixed or absolutely positioned content inside the message", () => {
    document.body.innerHTML =
      '<div class="message-body" id="body"><div style="position:fixed;inset:0;z-index:2147483647">x</div></div>';
    const decl = cascadedDeclarations(rules, document.getElementById("body")!);
    // Layout containment makes the message the containing block and stacking
    // context for positioned descendants; the overflow rule clips them to it.
    expect(decl.get("contain") ?? "").toMatch(/\b(layout|strict|content)\b/);
    expect(decl.get("overflow-x")).toBe("auto");
  });

  it("keeps the gap under the header the same for an email that opens with a paragraph", () => {
    document.body.innerHTML = '<div class="message-body"><p id="first">a</p><p id="second">b</p></div>';
    const marginTop = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!).get("margin-top");
    expect(marginTop("first")).toBe("0");
    expect(marginTop("second")).toBeUndefined();
  });

  it("keeps the gap under the header the same when the opening paragraph sits in wrapper divs", () => {
    document.body.innerHTML = `<div class="message-body"><div dir="ltr" id="outer"><div id="inner">
        <p id="first">a</p><p id="second">b</p></div></div></div>`;
    const marginTop = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!).get("margin-top");
    for (const id of ["outer", "inner", "first"]) expect(marginTop(id), id).toBe("0");
    expect(marginTop("second")).toBeUndefined();
  });

  it("rings every keyboard-reachable control on keyboard focus, inset on list rows", () => {
    document.body.innerHTML = `<button class="card-title-btn" id="collapse"></button>
      <a href="#" id="link">x</a>
      <div class="compose-suggestion-avatar" role="button" tabindex="0" id="suggestion"></div>
      <div class="color-picker-selected" role="button" tabindex="0" id="swatch"></div>
      <div class="scheduler-day-card" role="button" tabindex="0" id="day"></div>
      <div class="scheduler-option" role="option" tabindex="0" id="option"></div>
      <div class="attachment-thumb" role="button" tabindex="0" id="thumb"></div>
      <div class="message-body"><a href="#" id="email-link">x</a></div>
      <div class="card"><div class="thread" role="article" tabindex="0" id="thread"></div>
      <div class="calendar-event-item" tabindex="0" id="event"></div></div>`;
    // The winning declarations among rules that apply only while :focus-visible.
    const focusRing = (el: Element) => {
      const hits: { spec: [number, number, number]; order: number; decl: [string, string][] }[] = [];
      rules.forEach((rule, order) => {
        if (rule.context) return;
        for (const sel of rule.selectors) {
          if (!sel.endsWith(":focus-visible")) continue;
          if (!el.matches(sel.slice(0, -":focus-visible".length))) continue;
          hits.push({ spec: specificity(sel), order, decl: rule.declarations });
        }
      });
      hits.sort((a, b) => a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2] || a.order - b.order);
      const out = new Map<string, string>();
      for (const hit of hits) for (const [prop, value] of hit.decl) out.set(prop, value);
      return out;
    };
    for (const id of ["collapse", "link", "suggestion", "swatch", "day", "option", "thumb", "email-link", "thread", "event"]) {
      const ring = focusRing(document.getElementById(id)!);
      expect(ring.get("outline"), id).toMatch(/^2px solid var\(--accent\)$/);
    }
    // Rows sit flush in scrolling cards, and a message body scrolls wide
    // content sideways; either would clip an outset ring.
    for (const id of ["thread", "event", "email-link"]) {
      expect(focusRing(document.getElementById(id)!).get("outline-offset"), id).toMatch(/^-/);
    }
  });

  it("draws an event's Join video call button like the row's other links", () => {
    document.body.innerHTML = '<div class="event-info-row"><button type="button" class="link-btn" id="join">Join</button></div>';
    const decl = cascadedDeclarations(rules, document.getElementById("join")!);
    expect(decl.get("text-decoration")).toBe("none");
    expect(decl.get("color")).toBe("var(--accent)");
  });

  it("draws a message's dividers in a border token so they show in dark mode too", () => {
    document.body.innerHTML =
      '<div class="message-card"><div class="message-header" id="header"></div><div class="message-attachments" id="attachments"></div></div>';
    const decl = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!);
    expect(decl("header").get("border-bottom")).toMatch(/var\(--border-(light|color)\)/);
    expect(decl("attachments").get("border-top")).toMatch(/var\(--border-(light|color)\)/);
  });

  it("floats the app's error banner below the window drag strip, on its own surface", () => {
    document.body.innerHTML =
      '<div class="app"><div class="drag-region"></div><div class="auth-error" id="banner">Oops<button class="btn">×</button></div></div>';
    const decl = cascadedDeclarations(rules, document.getElementById("banner")!);
    expect(decl.get("position")).toBe("fixed");
    // The drag strip sits above everything and swallows clicks in its band.
    expect(decl.get("top")).toMatch(/var\(--drag-region-height\)/);
    expect(decl.get("background")).toMatch(/^var\(--bg-/);
    expect(decl.get("display")).toMatch(/flex/);
    expect(decl.get("gap")).toBeDefined();
  });

  it("spaces a settings section's intro hint from its fields, and widens its submit button", () => {
    document.body.innerHTML = `<div class="settings-section">
        <div class="settings-section-title">Google API</div>
        <p class="settings-hint" id="intro">Intro</p>
        <div class="settings-form-group"></div>
        <p class="settings-hint" id="note">Note</p>
        <button class="btn btn-primary" id="submit">Connect</button>
      </div>`;
    const decl = (id: string) => cascadedDeclarations(rules, document.getElementById(id)!);
    expect(decl("intro").get("margin-bottom")).toBe("var(--space-lg)");
    expect(decl("note").get("margin-bottom")).toBeUndefined();
    expect(decl("submit").get("width")).toBe("100%");
    expect(decl("submit").get("margin-top")).toBe("var(--space-lg)");
  });

  it("stills entrances and transitions under reduced motion but keeps loading and countdown indicators moving", () => {
    document.body.innerHTML = `<button class="icon-btn spinning"><svg id="refresh"></svg></button>
      <div class="auth-spinner" id="auth"></div><div class="spinner-sm" id="small"></div>
      <div class="skeleton-avatar" id="avatar"></div><div class="skeleton-line" id="line"></div>
      <div class="undo-toast"><div class="toast-progress" id="countdown"></div></div>
      <div class="thread-overlay" id="panel"></div>`;
    const indicators = ["refresh", "auth", "small", "avatar", "line", "countdown"].map(
      (id) => document.getElementById(id)!,
    );
    const moving = (el: Element) => cascadedDeclarations(rules, el).get("animation") ?? "";
    for (const el of indicators) expect(moving(el)).toMatch(/infinite|forwards/);
    // Any looping animation must be one of the indicators above.
    for (const rule of rules) {
      const animation = new Map(rule.declarations).get("animation") ?? "";
      if (rule.context || !/infinite/.test(animation)) continue;
      expect(rule.selectors.some((sel) => indicators.some((el) => el.matches(sel)))).toBe(true);
    }

    const reduced = rules.filter((r) => r.context.includes("prefers-reduced-motion: reduce"));
    const calming = reduced.find((r) => {
      const decl = new Map(r.declarations);
      return /!important/.test(decl.get("animation-duration") ?? "") && /!important/.test(decl.get("transition-duration") ?? "");
    });
    expect(calming).toBeDefined();
    const calmed = (el: Element) => calming!.selectors.some((sel) => el.matches(sel));
    expect(calmed(document.getElementById("panel")!)).toBe(true);
    expect(calming!.selectors).toEqual(expect.arrayContaining(["*::before", "*::after"]));
    expect(indicators.filter(calmed).map((el) => el.id)).toEqual([]);
  });
});
