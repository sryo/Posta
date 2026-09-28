import type { CardColor } from "../shared/constants";

export interface CardPreset {
  name: string;
  query: string;
  color?: CardColor;
}

export const PRESETS: Record<string, { label: string; description: string; cards: CardPreset[] }> = {
  posta: {
    label: "Posta",
    description: "Focus on what matters",
    cards: [
      { name: "Hot", query: "is:important newer_than:1d", color: "blue" },
      { name: "Meh", query: "category:promotions OR category:updates OR category:social -is:important -is:starred", color: "red" },
      { name: "Files", query: "has:attachment", color: "purple" },
      { name: "Today", query: "calendar:today" },
    ],
  },
  traditional: {
    label: "Traditional",
    description: "The familiar setup",
    cards: [
      { name: "Inbox", query: "is:inbox", color: "blue" },
      { name: "Starred", query: "is:starred", color: "yellow" },
      { name: "Drafts", query: "is:draft", color: "orange" },
      { name: "Sent", query: "in:sent", color: "green" },
    ],
  },
  power: {
    label: "Power User",
    description: "Track everything",
    cards: [
      { name: "Hot", query: "is:important newer_than:1d", color: "blue" },
      { name: "Waiting", query: "in:sent newer_than:7d", color: "yellow" },
      { name: "Drafts", query: "is:draft", color: "orange" },
      { name: "Meh", query: "category:promotions OR category:updates OR category:social -is:important -is:starred", color: "red" },
    ],
  },
  empty: {
    label: "Blank",
    description: "Build from scratch",
    cards: [],
  },
};
