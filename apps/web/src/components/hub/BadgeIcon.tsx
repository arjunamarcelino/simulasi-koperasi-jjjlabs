import type { BadgeIconKind } from "../../content/badges";

/** Palette hexes (tilemap). Ink outline on silhouettes; detail rects unstroked. */
const INK = "#2B2016";

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={34} height={34} shapeRendering="crispEdges" aria-hidden="true">
      {children}
    </svg>
  );
}

function assertNever(x: never): never {
  throw new Error(`Unhandled BadgeIconKind: ${String(x)}`);
}

/** A single pixel-art badge icon (16x16). Locked/greyscale is applied by the caller. */
export function BadgeIcon({ kind }: { kind: BadgeIconKind }) {
  switch (kind) {
    case "medal":
      return (
        <Svg>
          <rect x="5" y="1" width="2" height="5" fill="#1F5D3A" />
          <rect x="9" y="1" width="2" height="5" fill="#E07A3C" />
          <rect x="4" y="6" width="8" height="8" fill="#D9A521" stroke={INK} strokeWidth="1" />
          <rect x="6" y="8" width="4" height="1" fill="#FBF3DE" />
          <rect x="7" y="9" width="2" height="3" fill="#FBF3DE" />
        </Svg>
      );
    case "book":
      return (
        <Svg>
          <rect x="2" y="3" width="12" height="10" fill="#7A4E2D" stroke={INK} strokeWidth="1" />
          <rect x="3" y="4" width="5" height="8" fill="#F4E6C8" />
          <rect x="8" y="4" width="5" height="8" fill="#FBF3DE" />
          <rect x="7" y="3" width="2" height="10" fill="#5A3A20" />
          <rect x="4" y="6" width="3" height="1" fill="#7A4E2D" />
          <rect x="4" y="8" width="3" height="1" fill="#7A4E2D" />
          <rect x="9" y="6" width="3" height="1" fill="#7A4E2D" />
          <rect x="9" y="8" width="3" height="1" fill="#7A4E2D" />
        </Svg>
      );
    case "ticket":
      return (
        <Svg>
          <rect x="2" y="4" width="12" height="8" fill="#E07A3C" stroke={INK} strokeWidth="1" />
          <rect x="8" y="4" width="1" height="8" fill={INK} />
          <rect x="8" y="5" width="1" height="1" fill="#E07A3C" />
          <rect x="8" y="7" width="1" height="1" fill="#E07A3C" />
          <rect x="8" y="9" width="1" height="1" fill="#E07A3C" />
          <rect x="3" y="6" width="4" height="1" fill="#FBF3DE" />
          <rect x="3" y="8" width="4" height="1" fill="#FBF3DE" />
          <rect x="10" y="7" width="3" height="2" fill="#F4E6C8" />
        </Svg>
      );
    case "compass":
      return (
        <Svg>
          <rect x="4" y="2" width="8" height="8" fill="#F4E6C8" stroke={INK} strokeWidth="1" />
          <rect x="5" y="1" width="6" height="1" fill={INK} />
          <rect x="5" y="10" width="6" height="1" fill={INK} />
          <rect x="7" y="3" width="2" height="4" fill="#E07A3C" />
          <rect x="7" y="6" width="2" height="3" fill="#1F5D3A" />
          <rect x="7" y="6" width="2" height="1" fill={INK} />
          <rect x="3" y="11" width="3" height="3" fill="#7A4E2D" stroke={INK} strokeWidth="1" />
          <rect x="10" y="11" width="3" height="3" fill="#7A4E2D" stroke={INK} strokeWidth="1" />
        </Svg>
      );
    case "coin":
      return (
        <Svg>
          <rect x="3" y="3" width="10" height="10" fill="#D9A521" stroke={INK} strokeWidth="1" />
          <rect x="4" y="2" width="8" height="1" fill={INK} />
          <rect x="4" y="13" width="8" height="1" fill={INK} />
          <rect x="5" y="5" width="6" height="6" fill="#FBF3DE" />
          <rect x="7" y="6" width="2" height="4" fill="#7A4E2D" />
          <rect x="6" y="7" width="4" height="1" fill="#7A4E2D" />
        </Svg>
      );
    case "flag":
      return (
        <Svg>
          <rect x="4" y="1" width="1" height="13" fill="#5A3A20" />
          <rect x="5" y="2" width="8" height="6" fill="#1F5D3A" stroke={INK} strokeWidth="1" />
          <rect x="6" y="4" width="2" height="2" fill="#D9A521" />
          <rect x="9" y="3" width="3" height="1" fill="#164429" />
          <rect x="9" y="6" width="3" height="1" fill="#164429" />
          <rect x="3" y="13" width="4" height="2" fill="#7A4E2D" stroke={INK} strokeWidth="1" />
        </Svg>
      );
    case "trophy":
      return (
        <Svg>
          <rect x="5" y="2" width="6" height="5" fill="#D9A521" stroke={INK} strokeWidth="1" />
          <rect x="3" y="3" width="2" height="3" fill="#D9A521" stroke={INK} strokeWidth="1" />
          <rect x="11" y="3" width="2" height="3" fill="#D9A521" stroke={INK} strokeWidth="1" />
          <rect x="6" y="4" width="2" height="2" fill="#FBF3DE" />
          <rect x="7" y="7" width="2" height="2" fill="#7A4E2D" />
          <rect x="4" y="9" width="8" height="2" fill="#7A4E2D" stroke={INK} strokeWidth="1" />
          <rect x="5" y="11" width="6" height="2" fill="#5A3A20" stroke={INK} strokeWidth="1" />
        </Svg>
      );
    case "piggy":
      return (
        <Svg>
          <rect x="3" y="5" width="10" height="6" fill="#E07A3C" stroke={INK} strokeWidth="1" />
          <rect x="4" y="4" width="6" height="1" fill="#E07A3C" />
          <rect x="12" y="6" width="2" height="2" fill="#E07A3C" />
          <rect x="12" y="6" width="1" height="1" fill={INK} />
          <rect x="6" y="4" width="2" height="1" fill={INK} />
          <rect x="6" y="2" width="1" height="2" fill="#D9A521" />
          <rect x="5" y="6" width="1" height="1" fill="#FBF3DE" />
          <rect x="4" y="11" width="2" height="2" fill="#7A4E2D" />
          <rect x="9" y="11" width="2" height="2" fill="#7A4E2D" />
        </Svg>
      );
    case "check":
      return (
        <Svg>
          <rect x="3" y="3" width="10" height="10" fill="#1F5D3A" stroke={INK} strokeWidth="1" />
          <rect x="4" y="2" width="8" height="1" fill={INK} />
          <rect x="4" y="13" width="8" height="1" fill={INK} />
          <rect x="5" y="5" width="6" height="6" fill="#164429" />
          <rect x="6" y="8" width="2" height="2" fill="#F4E6C8" />
          <rect x="7" y="9" width="2" height="1" fill="#F4E6C8" />
          <rect x="8" y="7" width="1" height="2" fill="#F4E6C8" />
          <rect x="9" y="5" width="1" height="2" fill="#F4E6C8" />
        </Svg>
      );
    default:
      return assertNever(kind);
  }
}
