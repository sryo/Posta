// Emoji picker component with categories and search

import { createSignal, For, Show, onCleanup, onMount } from "solid-js";

// Emoji data organized by category
const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [
  {
    name: "Smileys",
    icon: "\ud83d\ude00",
    emojis: [
      "\ud83d\ude00", "\ud83d\ude03", "\ud83d\ude04", "\ud83d\ude01", "\ud83d\ude06", "\ud83d\ude05", "\ud83d\ude02", "\ud83e\udd23",
      "\ud83d\ude0a", "\ud83d\ude07", "\ud83d\ude42", "\ud83d\ude43", "\ud83d\ude09", "\ud83d\ude0c", "\ud83d\ude0d", "\ud83e\udd70",
      "\ud83d\ude18", "\ud83d\ude17", "\ud83d\ude19", "\ud83d\ude1a", "\ud83d\ude0b", "\ud83d\ude1b", "\ud83d\ude1c", "\ud83e\udd2a",
      "\ud83d\ude1d", "\ud83e\udd11", "\ud83e\udd17", "\ud83e\udd2d", "\ud83e\udd2b", "\ud83e\udd14", "\ud83e\udd10", "\ud83e\udd28",
      "\ud83d\ude10", "\ud83d\ude11", "\ud83d\ude36", "\ud83d\ude0f", "\ud83d\ude12", "\ud83d\ude44", "\ud83d\ude2c", "\ud83e\udd25",
      "\ud83d\ude0c", "\ud83d\ude14", "\ud83d\ude2a", "\ud83e\udd24", "\ud83d\ude34", "\ud83d\ude37", "\ud83e\udd12", "\ud83e\udd15",
      "\ud83e\udd22", "\ud83e\udd2e", "\ud83e\udd27", "\ud83e\udd75", "\ud83e\udd76", "\ud83e\udd74", "\ud83d\ude35", "\ud83e\udd2f",
      "\ud83e\udd20", "\ud83e\udd73", "\ud83d\ude0e", "\ud83e\udd13", "\ud83e\uddd0", "\ud83d\ude15", "\ud83d\ude1f", "\ud83d\ude41",
      "\ud83d\ude2e", "\ud83d\ude2f", "\ud83d\ude32", "\ud83d\ude33", "\ud83e\udd7a", "\ud83d\ude26", "\ud83d\ude27", "\ud83d\ude28",
      "\ud83d\ude30", "\ud83d\ude25", "\ud83d\ude22", "\ud83d\ude2d", "\ud83d\ude31", "\ud83d\ude16", "\ud83d\ude23", "\ud83d\ude1e",
      "\ud83d\ude13", "\ud83d\ude29", "\ud83d\ude2b", "\ud83e\udd71", "\ud83d\ude24", "\ud83d\ude21", "\ud83d\ude20", "\ud83e\udd2c",
      "\ud83d\ude08", "\ud83d\udc7f", "\ud83d\udc80", "\u2620\ufe0f", "\ud83d\udca9", "\ud83e\udd21", "\ud83d\udc79", "\ud83d\udc7a",
      "\ud83d\udc7b", "\ud83d\udc7d", "\ud83d\udc7e", "\ud83e\udd16", "\ud83d\ude3a", "\ud83d\ude38", "\ud83d\ude39", "\ud83d\ude3b",
    ],
  },
  {
    name: "Gestures",
    icon: "\ud83d\udc4d",
    emojis: [
      "\ud83d\udc4d", "\ud83d\udc4e", "\ud83d\udc4a", "\u270a", "\ud83e\udd1b", "\ud83e\udd1c", "\ud83e\udd1e", "\u270c\ufe0f",
      "\ud83e\udd1f", "\ud83e\udd18", "\ud83d\udc4c", "\ud83e\udd0f", "\ud83d\udc48", "\ud83d\udc49", "\ud83d\udc46", "\ud83d\udc47",
      "\u261d\ufe0f", "\u270b", "\ud83e\udd1a", "\ud83d\udd90\ufe0f", "\ud83d\udd96", "\ud83d\udc4b", "\ud83e\udd19", "\ud83d\udcaa",
      "\ud83d\ude4f", "\u270d\ufe0f", "\ud83d\udc85", "\ud83e\udd33", "\ud83d\udc4f", "\ud83d\ude4c", "\ud83d\udc50", "\ud83e\udd32",
    ],
  },
  {
    name: "Hearts",
    icon: "\u2764\ufe0f",
    emojis: [
      "\u2764\ufe0f", "\ud83e\udde1", "\ud83d\udc9b", "\ud83d\udc9a", "\ud83d\udc99", "\ud83d\udc9c", "\ud83e\udd0e", "\ud83d\udda4",
      "\ud83e\udd0d", "\ud83d\udc94", "\u2763\ufe0f", "\ud83d\udc95", "\ud83d\udc9e", "\ud83d\udc93", "\ud83d\udc97", "\ud83d\udc96",
      "\ud83d\udc98", "\ud83d\udc9d", "\ud83d\udc9f", "\u2665\ufe0f", "\ud83d\udc8b", "\ud83d\udc8c", "\ud83d\udc8d", "\ud83d\udc8e",
    ],
  },
  {
    name: "Celebration",
    icon: "\ud83c\udf89",
    emojis: [
      "\ud83c\udf89", "\ud83c\udf8a", "\ud83c\udf88", "\ud83c\udf81", "\ud83c\udf80", "\ud83c\udf8a", "\u2728", "\ud83c\udf1f",
      "\ud83d\udcab", "\ud83d\udca5", "\ud83c\udf86", "\ud83c\udf87", "\ud83e\udde8", "\ud83c\udf90", "\ud83c\udf8f", "\ud83c\udfee",
      "\ud83c\udfb0", "\ud83c\udfb2", "\ud83c\udfaf", "\ud83c\udfb3", "\ud83c\udfc6", "\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49",
    ],
  },
  {
    name: "Nature",
    icon: "\ud83c\udf1e",
    emojis: [
      "\ud83c\udf1e", "\ud83c\udf1d", "\ud83c\udf1b", "\ud83c\udf1c", "\ud83c\udf1a", "\ud83c\udf15", "\ud83c\udf16", "\ud83c\udf17",
      "\ud83c\udf18", "\ud83c\udf11", "\ud83c\udf12", "\ud83c\udf13", "\ud83c\udf14", "\ud83c\udf19", "\u2b50", "\ud83c\udf1f",
      "\ud83d\udcab", "\u2600\ufe0f", "\u26c5", "\ud83c\udf24\ufe0f", "\ud83c\udf25\ufe0f", "\ud83c\udf26\ufe0f", "\u2601\ufe0f", "\ud83c\udf27\ufe0f",
      "\u26c8\ufe0f", "\ud83c\udf29\ufe0f", "\ud83c\udf28\ufe0f", "\u2744\ufe0f", "\u2603\ufe0f", "\u26c4", "\ud83c\udf2c\ufe0f", "\ud83c\udf2b\ufe0f",
      "\ud83c\udf08", "\ud83c\udf3a", "\ud83c\udf39", "\ud83c\udf3b", "\ud83c\udf3c", "\ud83c\udf37", "\ud83c\udf38", "\ud83c\udf32",
      "\ud83c\udf33", "\ud83c\udf34", "\ud83c\udf35", "\ud83c\udf31", "\ud83c\udf3f", "\u2618\ufe0f", "\ud83c\udf40", "\ud83c\udf41",
    ],
  },
  {
    name: "Food",
    icon: "\ud83c\udf55",
    emojis: [
      "\ud83c\udf4e", "\ud83c\udf4f", "\ud83c\udf4a", "\ud83c\udf4b", "\ud83c\udf4c", "\ud83c\udf49", "\ud83c\udf47", "\ud83c\udf53",
      "\ud83c\udf48", "\ud83c\udf52", "\ud83c\udf51", "\ud83e\udd6d", "\ud83c\udf4d", "\ud83e\udd65", "\ud83e\udd5d", "\ud83c\udf45",
      "\ud83c\udf46", "\ud83e\udd51", "\ud83e\udd52", "\ud83e\udd55", "\ud83c\udf3d", "\ud83c\udf36\ufe0f", "\ud83e\udd54", "\ud83c\udf60",
      "\ud83c\udf5e", "\ud83e\udd50", "\ud83e\udd56", "\ud83e\udd68", "\ud83e\udd6f", "\ud83e\uddc0", "\ud83c\udf73", "\ud83e\udd5a",
      "\ud83e\udd5e", "\ud83e\udd69", "\ud83c\udf56", "\ud83c\udf57", "\ud83e\udd6a", "\ud83c\udf54", "\ud83c\udf5f", "\ud83c\udf55",
      "\ud83c\udf2e", "\ud83c\udf2f", "\ud83e\udd59", "\ud83c\udf5d", "\ud83c\udf5c", "\ud83c\udf72", "\ud83c\udf5b", "\ud83c\udf63",
      "\ud83c\udf71", "\ud83c\udf58", "\ud83c\udf59", "\ud83c\udf5a", "\ud83c\udf66", "\ud83c\udf70", "\ud83c\udf82", "\ud83c\udf6e",
      "\ud83c\udf6d", "\ud83c\udf6c", "\ud83c\udf6b", "\ud83c\udf7f", "\ud83c\udf69", "\ud83c\udf6a", "\ud83e\udd5b", "\ud83c\udf75",
    ],
  },
  {
    name: "Objects",
    icon: "\ud83d\udcbb",
    emojis: [
      "\ud83d\udcbb", "\ud83d\udda5\ufe0f", "\ud83d\udda8\ufe0f", "\ud83d\udcf1", "\ud83d\udcf2", "\u260e\ufe0f", "\ud83d\udcde", "\ud83d\udce7",
      "\u2709\ufe0f", "\ud83d\udce8", "\ud83d\udce9", "\ud83d\udcec", "\ud83d\udced", "\ud83d\udcef", "\ud83d\udcee", "\ud83d\udce6",
      "\ud83d\udcdd", "\ud83d\udcc4", "\ud83d\udcd1", "\ud83d\udcc8", "\ud83d\udcc9", "\ud83d\udcca", "\ud83d\udcc5", "\ud83d\udcc6",
      "\ud83d\uddd3\ufe0f", "\ud83d\udcc7", "\ud83d\udccb", "\ud83d\udcd3", "\ud83d\udcd4", "\ud83d\udcd2", "\ud83d\udcd5", "\ud83d\udcd7",
      "\ud83d\udcd8", "\ud83d\udcd9", "\ud83d\udcda", "\ud83d\udcd6", "\ud83d\udd17", "\ud83d\udcce", "\ud83d\udd87\ufe0f", "\u2702\ufe0f",
      "\ud83d\udccc", "\ud83d\udccd", "\ud83d\udd12", "\ud83d\udd13", "\ud83d\udd10", "\ud83d\udd11", "\ud83d\udee0\ufe0f", "\ud83d\udd28",
    ],
  },
  {
    name: "Symbols",
    icon: "\u2705",
    emojis: [
      "\u2705", "\u2714\ufe0f", "\u2611\ufe0f", "\u2716\ufe0f", "\u274c", "\u274e", "\u2795", "\u2796", "\u2797",
      "\u27b0", "\u27bf", "\u2049\ufe0f", "\u2753", "\u2754", "\u2755", "\u2757", "\u3030\ufe0f", "\u00a9\ufe0f",
      "\u00ae\ufe0f", "\u2122\ufe0f", "\ud83d\udd1f", "\ud83d\udd20", "\ud83d\udd21", "\ud83d\udd22", "\ud83d\udd23", "\ud83d\udd24",
      "\ud83c\udd70\ufe0f", "\ud83c\udd71\ufe0f", "\ud83c\udd8e", "\ud83c\udd91", "\ud83c\udd92", "\ud83c\udd93", "\ud83c\udd94", "\ud83c\udd95",
      "\ud83c\udd96", "\ud83c\udd97", "\ud83c\udd98", "\ud83c\udd99", "\ud83c\udd9a", "\ud83c\ude01", "\ud83c\ude02\ufe0f", "\ud83c\ude32",
      "\ud83c\ude33", "\ud83c\ude34", "\ud83c\ude35", "\ud83c\ude36", "\ud83c\ude37\ufe0f", "\ud83c\ude38", "\ud83c\ude39", "\ud83c\ude3a",
    ],
  },
];

// Frequently used emojis (customizable later)
const FREQUENT_EMOJIS = [
  "\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\ude2e", "\ud83d\ude22", "\ud83c\udf89", "\ud83d\ude4f", "\ud83d\udd25",
  "\ud83d\udc4f", "\u2705", "\ud83d\ude0d", "\ud83e\udd14", "\ud83d\ude0a", "\ud83d\ude01", "\ud83d\udc4c", "\ud83d\udcaf",
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const EmojiPicker = (props: EmojiPickerProps) => {
  const [search, setSearch] = createSignal("");
  const [activeCategory, setActiveCategory] = createSignal(0);
  let containerRef: HTMLDivElement | undefined;

  // Close on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  // Close on Escape
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Filter emojis based on search
  const filteredEmojis = () => {
    const q = search().toLowerCase();
    if (!q) return null;

    const results: string[] = [];
    for (const cat of EMOJI_CATEGORIES) {
      for (const emoji of cat.emojis) {
        // Simple search - just include all if query is non-empty
        // (proper search would need emoji names/keywords)
        if (results.length < 50) {
          results.push(emoji);
        }
      }
    }
    return results;
  };

  const handleEmojiClick = (emoji: string) => {
    props.onSelect(emoji);
    props.onClose();
  };

  return (
    <div class="emoji-picker" ref={containerRef}>
      <div class="emoji-picker-header">
        <input
          type="text"
          class="emoji-search"
          placeholder="Search emoji..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          autofocus
        />
      </div>

      <Show when={!search()}>
        <div class="emoji-categories-tabs">
          <For each={EMOJI_CATEGORIES}>
            {(cat, i) => (
              <button
                class={`emoji-category-tab ${activeCategory() === i() ? "active" : ""}`}
                onClick={() => setActiveCategory(i())}
                title={cat.name}
              >
                {cat.icon}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="emoji-grid-container">
        <Show when={search() && filteredEmojis()}>
          <div class="emoji-grid">
            <For each={filteredEmojis()}>
              {(emoji) => (
                <button class="emoji-btn" onClick={() => handleEmojiClick(emoji)}>
                  {emoji}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={!search()}>
          <div class="emoji-section">
            <div class="emoji-section-title">Frequently Used</div>
            <div class="emoji-grid">
              <For each={FREQUENT_EMOJIS}>
                {(emoji) => (
                  <button class="emoji-btn" onClick={() => handleEmojiClick(emoji)}>
                    {emoji}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="emoji-section">
            <div class="emoji-section-title">{EMOJI_CATEGORIES[activeCategory()].name}</div>
            <div class="emoji-grid">
              <For each={EMOJI_CATEGORIES[activeCategory()].emojis}>
                {(emoji) => (
                  <button class="emoji-btn" onClick={() => handleEmojiClick(emoji)}>
                    {emoji}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
