/**
 * A tiny LIFO stack of Escape handlers so a nested overlay can intercept Esc BEFORE the
 * modal it lives in. `ModalShell` registers its Escape on `document` in the capture phase
 * with `stopPropagation`, so a child listener can never win the race — it consults this
 * stack instead: if a handler is registered, the topmost one runs and the modal is spared.
 */
const stack: Array<() => void> = [];

/** Register an Escape handler; returns an unsubscribe to pop it (call in effect cleanup). */
export function pushEscape(fn: () => void): () => void {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Run the topmost handler if any. Returns true when Escape was consumed. */
export function handleEscape(): boolean {
  const top = stack[stack.length - 1];
  if (top) {
    top();
    return true;
  }
  return false;
}
