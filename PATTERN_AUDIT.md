# Pattern Audit & Consolidation Plan

## 1. Key Hint Inconsistencies

### Current State
| Location | Text | Class |
|----------|------|-------|
| Toast undo | `z` | `shortcut-hint` |
| Actions wheel | `r`, `a`, `s`, etc. | `action-key-hint` |
| Actions wheel clear | `esc` | `action-key-hint` |
| Thread close | `ESC` | `shortcut-hint` |
| Card cancel | `ESC` | `shortcut-hint` |
| Quick reply cancel | `ESC` | `shortcut-hint` |
| New card cancel | `Esc` | `shortcut-hint` |
| Compose send | `⌘↵` | `shortcut-hint` |
| Filter hint | `ESC to close` | `filter-hint` |

### Issues
1. **Capitalization inconsistent**: `ESC` vs `Esc` vs `esc`
2. **Two different CSS classes**: `shortcut-hint` vs `action-key-hint`
3. **Different styling**: `action-key-hint` has background, `shortcut-hint` is plain text

### Fix
- Standardize on **uppercase** for special keys: `ESC`, `TAB`, `ENTER`
- Standardize on **lowercase** for letter keys: `z`, `r`, `a`
- Use single class `shortcut-hint` everywhere
- Create variant `.shortcut-hint.badge` for the action wheel style

---

## 2. Close Button Inconsistencies

### Current State
| Component | Class | Has Icon | Has Hint |
|-----------|-------|----------|----------|
| Thread view | `close-thread-btn` | Yes | `ESC` |
| Compose | `compose-close` | Yes | `ESC` |
| Label drawer | `label-drawer-close` | Yes | No |
| Settings | `settings-close` | Yes | `ESC` |
| Shortcuts modal | `shortcuts-close` | Yes | No |
| Toast | `toast-close-btn` | Yes (inline SVG) | No |
| Batch reply | `close-thread-btn` | Yes | `ESC` |

### Issues
1. **6 different class names** for essentially the same button
2. **Inconsistent hint display**: Some show ESC, some don't
3. **Toast uses inline SVG** instead of `CloseIcon` component

### Fix
- Create shared `CloseButton` component with props:
  - `onClick`
  - `showHint?: boolean` (default true)
  - `title?: string`
  - `class?: string` (for positioning overrides)
- Use `CloseIcon` component everywhere
- Always show ESC hint for closeable panels

---

## 3. Button Class Inconsistencies

### Current State
| Type | Classes Used |
|------|--------------|
| Primary action | `btn btn-primary` |
| Secondary/Cancel | `btn` |
| Danger | `btn btn-danger` |
| Icon only | `icon-btn` |
| Toolbar | `toolbar-btn`, `thread-toolbar-btn` |
| Small | `btn-sm` |
| Auth | `auth-btn` |
| Sign out | `signout-btn` |
| Retry | `retry-btn` |
| Add card | `add-card-btn` |
| Compose attach | `compose-attach-btn` |
| Group by | `group-by-btn` |

### Issues
1. **Too many one-off button classes**
2. **Inconsistent naming**: some use `btn-*`, others use `*-btn`

### Fix
- Consolidate to core button system:
  - `.btn` - base
  - `.btn-primary` - primary action
  - `.btn-danger` - destructive action
  - `.btn-ghost` - transparent background (for icon buttons in toolbars)
  - `.btn-sm` - small size
  - `.btn-icon` - icon-only button
- Remove one-off classes, use composition

---

## 4. Overlay/Modal Inconsistencies

### Current State
| Component | Overlay Class | Panel Class |
|-----------|--------------|-------------|
| Thread view | `thread-overlay` | (same element) |
| Settings | `settings-overlay` | `settings-sidebar` |
| Label drawer | `label-drawer-overlay` | `label-drawer` |
| Shortcuts | `shortcuts-overlay` | `shortcuts-modal` |
| Preset | `preset-overlay` | `preset-modal` |

### Issues
1. **No shared overlay component**
2. **Different z-index values scattered in CSS**
3. **Thread view combines overlay and content**

### Fix
- Create shared `Overlay` component with:
  - `onClick` for backdrop clicks
  - `zIndex` prop or tier system (`modal`, `drawer`, `popup`)
- Create shared `Modal` component
- Create shared `Drawer` component (slides from side)

---

## 5. Icon Inconsistencies

### Current State
- 27 icon components defined at top of file
- Some icons have filled variants (`StarIcon`/`StarFilledIcon`)
- Some toggles don't have filled variants (`ThumbsUpIcon`/`ThumbsUpFilledIcon` exists but not used consistently)

### Issues
1. **All icons inline in App.tsx** - should be separate file
2. **Inconsistent filled/outline usage for toggle states**

### Fix
- Move icons to `src/components/Icons.tsx`
- Standardize toggle pattern: outline = off, filled = on
- Consider using icon library or sprite sheet

---

## 6. Form Input Inconsistencies

### Current State
- `ComposeTextarea` shared component exists
- Regular `<textarea>` still used in compose body
- Various input styling for card forms, settings, etc.

### Issues
1. **Compose body textarea not using shared component**
2. **Input styling varies across forms**

### Fix
- Use `ComposeTextarea` for all message composition
- Create shared `Input` component for form fields
- Standardize focus styles

---

## 7. Loading State Inconsistencies

### Current State
| Location | Pattern |
|----------|---------|
| Cards | `loadingThreads()[cardId]` |
| Thread view | `loadingThreadDetails()` |
| Quick reply | `quickReplySending()` |
| Batch reply | `batchReplySending()[threadId]` |
| Compose | `sending()` |
| Labels | `labelsLoading()` |

### Issues
1. **No shared loading spinner component**
2. **Button disable patterns vary**

### Fix
- Create shared `Spinner` component
- Create shared `LoadingButton` component or use `ComposeSendButton` pattern everywhere

---

## Implementation Priority

### Phase 1: Quick Wins (Low Risk) ✅ COMPLETED
1. ✅ Fix key hint capitalization (ESC vs esc) - Added `text-transform: uppercase` to `.shortcut-hint`
2. ✅ Replace toast inline SVG with CloseIcon
3. ✅ Add missing ESC hints to close buttons (label-drawer, shortcuts modal)

### Phase 2: Component Extraction ✅ COMPLETED
1. ✅ Create `CloseButton` component - Shared component with icon + hint
2. ⏸️ Create `Overlay` component - Deferred (each overlay has unique behavior)
3. ✅ Move icons to separate file - `src/components/Icons.tsx` with 28 icons

### Phase 3: Button System 📋 ANALYZED
**Status**: The core button system (`btn`, `btn-primary`, `btn-danger`, `btn-sm`) is consistent. One-off classes serve specific visual purposes:
- `add-card-btn` - Circular FAB with ring border
- `auth-btn` - Google-branded sign-in button
- `compose-attach-btn` - Attachment button with specific positioning
- `group-by-btn` - Toggle button group styling
- `toolbar-btn`, `thread-toolbar-btn` - Toolbar-specific icon buttons

**Recommendation**: Keep context-specific button classes. Full consolidation risks visual regressions without careful testing. Future work could:
1. Add `.btn-ghost` variant for transparent buttons
2. Rename `retry-btn`, `signout-btn` to use base `.btn` with modifiers

### Phase 4: Form Components 📋 PENDING
1. Extend `ComposeTextarea` usage
2. Create shared `Input` component
3. Standardize focus styles

---

# Extended Audit (December 2025)

## 8. Z-Index Chaos

### Current State
CSS variables defined but rarely used:
```css
--z-dropdown: 100;
--z-modal: 200;
--z-overlay: 300;
--z-tooltip: 400;
--z-toast: 500;
```

**Hardcoded z-index values found:**
| Value | Location |
|-------|----------|
| 10 | thread-content elements |
| 20 | autocomplete, preview |
| 30, 40 | card form overlay |
| 50 | compose panel |
| 55 | batch reply panel |
| 98, 99 | toolbar elements |
| 100 | thread-overlay, autocomplete, error |
| 102 | settings sidebar |
| 110 | card form header |
| 1000 | thread-overlay, shortcuts |
| 1001 | compose/batch header |
| 1100 | label-drawer-overlay |
| 1101 | label-drawer |
| 10000 | undo-toast |

### Issues
1. **CSS variables exist but are ignored** - only 3 uses of `var(--z-*)`
2. **Values scattered randomly** - no clear hierarchy
3. **Toast at 10000** while CSS var says 500

### Fix
- Define clear z-index tiers in CSS vars
- Replace ALL hardcoded values with vars
- Suggested hierarchy:
  - `--z-base: 0`
  - `--z-dropdown: 100`
  - `--z-overlay: 200`
  - `--z-modal: 300`
  - `--z-drawer: 400`
  - `--z-toast: 500`

---

## 9. Hardcoded Colors

### Current State
Many colors hardcoded instead of using CSS variables:
| Hardcoded | Should Use |
|-----------|------------|
| `#666` | `var(--text-muted)` |
| `#d32f2f` | `var(--danger)` |
| `#ffebee` | `var(--danger-bg)` |
| `#323232` (toast) | Should be CSS var |
| `#43a047` (success) | Need `--success` var |
| `#fb8c00` (warning) | Need `--warning` var |
| `#00acc1` (info) | Need `--info` var |
| `#ffffff`, `#444444` | Should use `var(--bg-*)` |

### Fix
- Add missing color vars: `--success`, `--warning`, `--info`, `--success-bg`, `--warning-bg`, `--info-bg`
- Replace hardcoded hex values with CSS variables
- Ensure dark mode compatibility

---

## 10. Loading/Spinner Inconsistencies

### Current State
| Component | Class | Style |
|-----------|-------|-------|
| Auth flow | `.auth-spinner` | Border spinner, accent color |
| Thread content | `.loading-spinner` | Flex container, hardcoded `#666` |
| Send button | Text "Sending..." | No spinner |

### Issues
1. **Two different spinner classes** with different implementations
2. **`.loading-spinner` uses hardcoded color** `#666`
3. **No reusable Spinner component**

### Fix
- Create single `.spinner` class with size variants (`.spinner-sm`, `.spinner-lg`)
- Use CSS variables for colors
- Create `<Spinner />` component

---

## 11. Error State Inconsistencies

### Current State
| Location | Class | Colors |
|----------|-------|--------|
| Thread view | `.error-message` | Hardcoded `#d32f2f`, `#ffebee` |
| Card errors | `.card-error` | Uses emoji ⚠ |
| Auth error | `.auth-error` | Different styling |
| Compose error | `.compose-error` | Inline in compose panel |

### Issues
1. **Hardcoded colors** instead of CSS vars
2. **Different error patterns** across components
3. **No shared error component**

### Fix
- Create `.error-banner` component with consistent styling
- Use `var(--danger)` and `var(--danger-bg)`
- Create `<ErrorBanner />` component

---

## 12. Transition/Animation Patterns

### Current State
**Transition durations used:**
- `0.1s` - hover states
- `0.15s` - most common (buttons, hovers)
- `0.2s` - panels, transforms
- `0.25s` - complex animations
- `0.3s` - width changes

**Easing functions:**
- `ease` - generic
- `ease-out` - some animations
- `cubic-bezier(0.34, 1.56, 0.64, 1)` - bouncy (used in several places)

**Keyframe animations:** 16 different animations defined

### Issues
1. **No CSS variables for timing**
2. **Inconsistent duration choices**
3. **Some animations could be simplified**

### Fix
- Define timing vars: `--transition-fast: 0.1s`, `--transition-normal: 0.15s`, `--transition-slow: 0.25s`
- Define easing vars: `--ease-standard: ease`, `--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)`
- Standardize on fewer animation patterns

---

## 13. Label Badge Inconsistencies

### Current State
Labels displayed in various places with different styling:
- Thread list labels
- Thread detail labels
- Label drawer checkboxes
- Filter autocomplete

### Fix
- Create single `.label-badge` component with consistent styling
- Support system vs user label differentiation

---

## Implementation Priority (Extended)

### Phase 5: Z-Index Cleanup ✅ COMPLETED
1. ✅ Updated CSS variables with clear hierarchy (10 tiers from `--z-card-content` to `--z-toast`)
2. ✅ Replaced critical z-index values (overlay, drawer, toast, dropdown)
3. ✅ Low-level values (10-110) kept as-is for internal layout

### Phase 6: Color System ✅ COMPLETED
1. ✅ Added semantic colors: `--success`, `--warning`, `--info` (+ light/dark variants)
2. ✅ Added `--toast-bg` variable
3. ✅ Replaced hardcoded colors in action buttons, bulk buttons, sync status, error messages
4. ✅ Removed redundant dark mode overrides (CSS vars handle it automatically)

### Phase 7: Loading/Error States ✅ COMPLETED
1. ✅ Created shared `.spinner` CSS class with size variants (`.spinner-sm`, `.spinner-lg`)
2. ✅ Created `<Spinner />` component with `size` prop
3. ✅ Error message now uses `var(--danger)` and `var(--danger-bg)`

### Phase 8: Animation System ✅ COMPLETED
1. ✅ Added timing variables: `--transition-fast`, `--transition-normal`, `--transition-slow`
2. ✅ Added easing variables: `--ease-standard`, `--ease-out`, `--ease-bounce`
3. Transition replacements deferred (many existing transitions work well)
