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
