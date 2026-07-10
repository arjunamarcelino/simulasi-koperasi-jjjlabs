import { useEffect, useRef, type ReactNode } from "react";
import { PixelPanel } from "./PixelPanel";

type ModalShellProps = {
  /** id of the heading element inside `children` (for aria-labelledby). */
  titleId: string;
  onClose: () => void;
  /** Extra classes for the panel (e.g. width / max-height). */
  panelClassName?: string;
  children: ReactNode;
};

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A crisp 7×7 pixel-art "X" drawn from unit squares (shape-rendering: crispEdges)
 * so it reads as hard tilemap pixels instead of a smooth font glyph. Inherits the
 * button's text color via currentColor.
 */
function PixelX() {
  const cells: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    cells.push([i, i]);
    if (i !== 3) cells.push([i, 6 - i]); // the other diagonal (skip shared center)
  }
  return (
    <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Backdrop + framed panel shell shared by the mading overlays. Handles the
 * fiddly bits once: role="dialog"/aria-modal, focus move-in + restore, body
 * scroll lock, Escape (capture phase, so it beats Phaser's key polling), a
 * simple Tab focus-trap, and a backdrop click that only closes when the press
 * *and* release both land on the backdrop (so a drag-to-scroll never closes it).
 */
export function ModalShell({
  titleId,
  onClose,
  panelClassName = "",
  children,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const firstItem = items[0]!;
        const lastItem = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && active === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && active === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-ink/50 p-4"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <PixelPanel as="div" className={`relative ${panelClassName}`}>
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="pixel-raise active:pixel-press absolute -top-2 -right-2 z-10 flex h-8 w-8 select-none items-center justify-center bg-mustard text-ink focus-visible:outline-none focus-visible:pixel-focus"
          >
            <PixelX />
          </button>
          {/* Scroll lives on an inner wrapper so the outside ✕ is never clipped. */}
          <div className="max-h-[80vh] overflow-y-auto">{children}</div>
        </div>
      </PixelPanel>
    </div>
  );
}
