import type { ElementType, ReactNode } from "react";

type PixelPanelProps = {
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

/** Reusable framed container with the retro pixel bevel + hard shadow. */
export function PixelPanel({
  as: Tag = "div",
  className = "",
  children,
}: PixelPanelProps) {
  return (
    <Tag className={`pixel-panel bg-cream-2 p-6 md:p-8 ${className}`}>
      {children}
    </Tag>
  );
}
