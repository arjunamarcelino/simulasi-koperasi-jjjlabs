/** Prominent pixel close button (matches the mading boards' ✕). */
export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pixel-raise active:pixel-press absolute -right-2 -top-2 z-10 flex h-8 w-8 select-none items-center justify-center bg-mustard font-display text-[11px] text-ink focus-visible:pixel-focus focus-visible:outline-none"
    >
      ✕
    </button>
  );
}
