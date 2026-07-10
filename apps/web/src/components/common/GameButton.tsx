import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost";

type GameButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-mustard text-ink hover:brightness-105",
  ghost: "bg-cream text-forest hover:bg-parchment",
};

/** Chunky pressable pixel button. Native <button> — Space/Enter work for free. */
export function GameButton({
  variant = "primary",
  className = "",
  children,
  type = "button",
  ...props
}: GameButtonProps) {
  const base =
    "pixel-raise active:pixel-press font-display text-sm md:text-base tracking-wide " +
    "px-8 py-4 select-none cursor-pointer transition-transform duration-75 " +
    "focus-visible:outline-none focus-visible:pixel-focus disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button
      type={type}
      className={`${base} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
