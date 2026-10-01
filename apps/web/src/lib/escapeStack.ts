/**
 * A single Escape-handler slot so a nested overlay can intercept Esc BEFORE the modal it
 * lives in. `ModalShell` registers its Escape on `document` in the capture phase with
 * `stopPropagation`, so a child listener can never win the race — it consults this slot
 * instead: if a handler is registered, it runs and the modal is spared.
 *
 * Only one overlay tree relies on this at a time (the history detail). If real nesting is
 * ever needed, promote this back to a LIFO stack.
 */
let current: (() => void) | undefined;

/** Register the Escape handler; returns an unsubscribe to clear it (call in effect cleanup). */
export function pushEscape(fn: () => void): () => void {
  current = fn;
  return () => {
    if (current === fn) current = undefined;
  };
}

/**
 * Run the registered handler if any, clearing it first so a second Escape in the same tick
 * falls through to the modal (back out one layer, then close). Returns true when consumed.
 */
export function handleEscape(): boolean {
  const fn = current;
  if (!fn) return false;
  current = undefined;
  fn();
  return true;
}
