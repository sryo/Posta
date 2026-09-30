import { EMOJI_NAMES } from "./emojiNames";

// The emoji whose names hold every typed word as the start of one of theirs:
// those with a typed word whole first ("fire" finds 🔥 before 🎆 fireworks),
// each in the order given; then what a category named for the query holds
export function searchEmoji(query: string, categories: { name: string; emojis: string[] }[], limit = 50): string[] {
  const typed = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length === 0) return [];
  const whole: string[] = [];
  const started: string[] = [];
  const seen = new Set<string>();
  for (const cat of categories) {
    for (const emoji of cat.emojis) {
      if (seen.has(emoji)) continue;
      const words = (EMOJI_NAMES[emoji] ?? "").split(" ");
      if (!typed.every(t => words.some(w => w.startsWith(t)))) continue;
      seen.add(emoji);
      (typed.some(t => words.includes(t)) ? whole : started).push(emoji);
    }
  }
  const results = [...whole, ...started];
  const phrase = typed.join(" ");
  for (const cat of categories) {
    if (!cat.name.toLowerCase().includes(phrase)) continue;
    for (const emoji of cat.emojis) if (!seen.has(emoji)) { seen.add(emoji); results.push(emoji); }
  }
  return results.slice(0, limit);
}
