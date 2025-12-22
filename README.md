# Posta

A card-based Gmail client that lets you see your inbox your way.

---

## Your inbox, organized into cards

Create custom cards with Gmail search queries. Work emails in one card, newsletters in another, receipts somewhere else. Each card shows exactly what you want to see.

---

## Reply to emails in batches

Select multiple threads, hit Batch Reply, and power through your inbox. See each message with its own reply box. Send one by one, or all at once.

---

## Quick actions without leaving your flow

Hover over any thread to archive, star, reply, or delete. Use keyboard shortcuts for even faster processing. Your hands never leave the keyboard.

---

## Multiple accounts, one window

Connect all your Gmail accounts. Switch between them instantly. Each account has its own cards and colors.

---

## Keyboard-first navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate threads |
| `Enter` | Open thread |
| `a` | Archive |
| `s` | Star |
| `r` | Quick reply |
| `f` | Forward |
| `Escape` | Close |

---

## Fast, even offline

Threads are cached locally. See your emails instantly while fresh data loads in the background. Works even when your connection is spotty.

---

## Built for speed

Native app built with Rust and Tauri. No Electron bloat. Starts in under a second. Uses minimal memory.

---

## Getting Started

1. Install dependencies: `npm install`
2. Run in dev mode: `npm run tauri dev`
3. Build for production: `npm run tauri build`

You'll need to set up Google OAuth credentials in the app settings. [Get credentials here](https://console.cloud.google.com/).

---

## Tech

- **Frontend**: SolidJS + TypeScript
- **Backend**: Rust + Tauri
- **Database**: SQLite
- **API**: Gmail REST API

