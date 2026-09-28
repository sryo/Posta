// Whether a key event originates from a control that consumes typed characters,
// so single-letter shortcuts must not fire
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // The attribute check covers environments without isContentEditable (jsdom)
  return target.isContentEditable || !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

// Cmd/Ctrl/Alt combos belong to the OS and text editing (select-all, copy),
// never to single-letter app shortcuts
export function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}
