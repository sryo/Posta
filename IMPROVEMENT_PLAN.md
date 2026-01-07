# Posta Improvement Plan

## Product Context

Based on interview and codebase analysis.

**Product**: Open source Gmail client built with Tauri + SolidJS
**Primary use**: Your daily email client
**Target users**: Both power users (keyboard efficiency) and casual users (simplicity)

---

## Design Decisions (From Interview)

| Area | Decision | Rationale |
|------|----------|-----------|
| Data model | Hybrid caching | Cache recent/starred/important, not full offline |
| Multi-account | Separate inboxes | Explicit account switching, clearer mental model |
| AI features | Minimal, opt-in | Privacy-conscious, not a differentiator |
| Calendar | Light integration | Show related events, basic links, no AI extraction |
| Compose | Keep inline | Context matters, stay in thread |
| Labels | Full label support | Multiple labels per thread (Gmail model) |
| Search | Server-side only | Gmail search is good enough |
| Threads | Conversations only | Don't offer flat view |
| Notifications | None | Email is async |
| Dark mode | System preference | No manual toggle |
| Error handling | Silent retry | Auto-retry, only show persistent failures |
| Shortcuts | Modifier keys | Always require Cmd/Ctrl |
| Framework | SolidJS | Committed, won't migrate |
| Testing | Manual only | Move fast, no automated tests |

---

## Priority 1: Polish Issues (Your Main Pain Point)

You identified polish issues across visual, interaction, and state bugs as your biggest frustration.

### 1.1 CSS Systematic Overhaul

**Problem**: 5400+ lines in App.css with massive duplication.

**Action items**:

1. Create design tokens in `:root`:
```css
/* Spacing scale */
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 20px;
--space-2xl: 24px;

/* Shadow scale */
--shadow-sm: 0 2px 5px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 8px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.15);

/* Border radius */
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;

/* Font sizes */
--text-xs: 10px;
--text-sm: 11px;
--text-base: 13px;
--text-md: 14px;
```

2. Replace all hardcoded values:
   - 12 occurrences of `border-radius: 12px` → `var(--radius-lg)`
   - 82 transition timings → use existing `--transition-normal`
   - 15+ box shadows → `var(--shadow-sm)` etc.
   - 30+ padding values → `var(--space-*)` scale

3. Extract utility classes:
```css
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-between { display: flex; align-items: center; justify-content: space-between; }
```

**Files**: `src/App.css`

### 1.2 Interaction Bugs to Investigate

Common patterns that cause interaction issues in SolidJS:

1. **Focus management**: After actions like archive/delete, ensure focus moves to next item
2. **Click handlers on nested elements**: Check for event propagation issues
3. **Keyboard navigation**: Verify j/k navigation works consistently across views

### 1.3 State/Data Bugs

1. **Stale closures**: With 70+ signals in App.tsx, closures capturing old values is likely
2. **Optimistic updates not rolling back**: Check `handleThreadAction` error paths
3. **Cache invalidation**: When should cached threads be refreshed?

---

## Priority 2: App.tsx Refactoring (For Solo Dev Speed)

**Problem**: 8100-line monolith with 70+ signals, all logic, all components.

**Goal**: Split for your mental model, not for contributors. Keep it practical.

### 2.1 Extract Inline Components (Quick Wins)

These can be moved to `src/components/` with minimal changes:

| Component | Lines | Complexity |
|-----------|-------|------------|
| MessageBody | 18-110 | Low - self-contained |
| ActionsWheel | 5737-6023 | Medium - needs props |
| ThreadView | 1141-1791 | High - many dependencies |
| EventView | 1793-2193 | Medium |
| ComposeForm | 396-626 | Medium |
| CreateEventForm | 628-1009 | Medium |

**Start with**: MessageBody, ActionsWheel (least dependencies)

### 2.2 Extract Duplicated Functions (30 min each)

Create `src/utils/messageParser.ts`:
```typescript
// findContent - duplicated at lines 1399, 1743, 4389
export function findContent(parts: MessagePart[] | undefined, mimeType: string): string | null

// findCidImages - duplicated at lines 27, 1461, 5503
export function findCidImages(parts: MessagePart[], messageId: string): CidImageInfo[]

// Response status label - duplicated 5+ times
export function getResponseStatusLabel(status: string | null): string
```

### 2.3 Group Related Signals into Stores (Later)

When you have time, consolidate related signals:

```typescript
// Instead of 12 separate compose signals:
const [composeState, setComposeState] = createStore({
  isOpen: false,
  to: "", cc: "", bcc: "",
  subject: "", body: "",
  attachments: [],
  // ...
});
```

**Don't do this all at once** - migrate one group at a time as you touch that code.

---

## Priority 3: Missing Features

### 3.1 Undo Send (5 second delay)

**Implementation**:
1. When user clicks Send, start 5-second countdown
2. Show toast with "Sending... Undo" button
3. If countdown completes, actually send
4. If Undo clicked, cancel and return to compose

**Files**: `src/App.tsx` (handleSendEmail function), `src-tauri/src/commands.rs`

### 3.2 Per-Account Signatures

**Implementation**:
1. Add `signature: Option<String>` to Account struct
2. Add signature field in Settings per account
3. Auto-append when composing new email or reply

**Files**:
- `src-tauri/src/cache/sqlite.rs` (schema)
- `src-tauri/src/commands.rs`
- `src/App.tsx` (Settings UI, compose logic)

### 3.3 Smart Caching

Current caching is basic. Implement:
1. Cache recent threads (last 7 days) fully
2. Cache starred/important threads
3. Expire old cached data after 30 days
4. Background refresh on app start

**Files**: `src-tauri/src/cache/sqlite.rs`

---

## Priority 4: Performance Optimizations

### 4.1 Backend: Parallelize Attachment Fetching

**Problem**: `fetch_attachments` fetches one at a time.

**Fix** in `src-tauri/src/commands.rs`:
```rust
// Instead of:
for attachment in &message.attachments { ... }

// Use:
let futures: Vec<_> = message.attachments.iter()
    .map(|att| async { ... })
    .collect();
let results = futures::future::join_all(futures).await;
```

### 4.2 Backend: Batch Database Operations

**Problem**: Card reorder does N separate queries.

**Fix**: Add batch update method in `src-tauri/src/cache/sqlite.rs`:
```rust
pub fn batch_update_card_positions(&self, updates: Vec<(String, i32)>) -> Result<()> {
    let tx = self.conn.transaction()?;
    // Single transaction, N updates
    tx.commit()
}
```

### 4.3 Frontend: Reduce 1-Second Interval Re-renders

**Problem**: Clock update causes global re-render every second.

**Fix**: Isolate clock to its own component that doesn't affect parent:
```typescript
// In a separate component
const Clock = () => {
  const [time, setTime] = createSignal(new Date());
  setInterval(() => setTime(new Date()), 1000);
  return <span>{formatTime(time())}</span>;
};
```

---

## Priority 5: Security Fixes

### 5.1 Enable CSP (Critical)

**File**: `src-tauri/tauri.conf.json`

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com"
}
```

### 5.2 Sanitize Calendar Event Descriptions

**File**: `src/App.tsx` line ~2005

The `innerHTML` for event descriptions should sanitize untrusted content. Consider using DOMPurify or a simple text-only fallback.

### 5.3 Remove Plaintext Token Fallback

**File**: `src-tauri/src/auth/oauth2.rs`

The code has a fallback that writes tokens to plaintext file when keyring fails. Remove this - if keyring fails, fail the auth flow.

---

## Won't Do (Based on Interview)

These were explicitly deprioritized:

- [ ] Other email providers (Gmail only)
- [ ] Deep AI integration (minimal, opt-in)
- [ ] Notification system (email is async)
- [ ] Local full-text search (server-side is enough)
- [ ] Flat message view (conversations only)
- [ ] Automated testing (manual is enough)
- [ ] Mobile/responsive (desktop focus)
- [ ] Advanced attachment handling (download only)
- [ ] Templates (signatures only)
- [ ] Manual dark mode toggle (system preference)

---

## Implementation Order

### Phase 1: Polish (Now)
1. CSS design tokens and variable replacement
2. Fix most obvious interaction/state bugs as found
3. Extract MessageBody and ActionsWheel components

### Phase 2: Features
1. Undo send (5 sec delay)
2. Per-account signatures
3. Security fixes (CSP, sanitization)

### Phase 3: Performance
1. Parallelize attachment fetching
2. Batch database operations
3. Isolate clock component

### Phase 4: Continued Refactoring
1. Extract remaining inline components
2. Consolidate signals into stores (as touched)
3. More CSS cleanup

---

## Notes

- **No time estimates** - work on items as they fit
- **Cards feature** - uncertain, watch for usage patterns before expanding
- **Drag-drop** - undecided, evaluate later based on workflow
- **iCloud sync** - nice-to-have, don't invest in conflict resolution
