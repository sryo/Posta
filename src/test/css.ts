export type Rule = { selectors: string[]; declarations: [string, string][]; context: string };

// Flattens nested at-rules (@media, @supports) into their inner style rules;
// @keyframes blocks are skipped since their "selectors" are percentages.
export function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  function block(skip: boolean, context: string) {
    while (i < text.length) {
      const open = text.indexOf("{", i);
      const close = text.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1;
        return;
      }
      if (open === -1) return;
      const prelude = text.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith("@")) {
        block(skip || prelude.startsWith("@keyframes"), `${context} ${prelude}`.trim());
        continue;
      }
      const end = text.indexOf("}", i);
      const body = text.slice(i, end);
      i = end + 1;
      if (skip) continue;
      const declarations = body
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()] as [string, string];
        });
      rules.push({ selectors: prelude.split(",").map((s) => s.trim()), declarations, context });
    }
  }
  block(false, "");
  return rules;
}

// Every class name a rule's selectors mention.
export function selectorClasses(rules: Rule[]): Set<string> {
  const classes = new Set<string>();
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(m[1]);
    }
  }
  return classes;
}

// @keyframes names that no animation / animation-name declaration uses.
export function unusedKeyframes(css: string): string[] {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const animations = [...css.matchAll(/animation(?:-name)?\s*:([^;}]*)/g)].map((m) => m[1]);
  return names.filter(
    (name) => !animations.some((value) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(value)),
  );
}

type Specificity = [number, number, number];

// [ids, classes/attributes/pseudo-classes, types/pseudo-elements]. Functional
// pseudo-class arguments are ignored, which is enough for App.css.
export function specificity(selector: string): Specificity {
  const s = selector.replace(/\([^)]*\)/g, "");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
  const types = (s.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*|::[\w-]+/g) ?? []).length;
  return [ids, classes, types];
}

// Vendor pseudo-classes jsdom cannot parse can't match a test element anyway.
function matchesSafely(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

const compareSpecificity =(a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The winning value of each property that top-level rules declare on `el`
// itself, by specificity then source order. jsdom's getComputedStyle only
// resolves inherited properties like font-size, not padding or background.
export function cascadedDeclarations(rules: Rule[], el: Element): Map<string, string> {
  const hits: { spec: Specificity; order: number; declarations: [string, string][] }[] = [];
  rules.forEach((rule, order) => {
    if (rule.context) return;
    let best: Specificity | null = null;
    for (const sel of rule.selectors) {
      if (/::|:(hover|focus|active)/.test(sel) || !matchesSafely(el, sel)) continue;
      const spec = specificity(sel);
      if (!best || compareSpecificity(spec, best) > 0) best = spec;
    }
    if (best) hits.push({ spec: best, order, declarations: rule.declarations });
  });
  hits.sort((a, b) => compareSpecificity(a.spec, b.spec) || a.order - b.order);
  const out = new Map<string, string>();
  for (const hit of hits) for (const [prop, value] of hit.declarations) out.set(prop, value);
  return out;
}
