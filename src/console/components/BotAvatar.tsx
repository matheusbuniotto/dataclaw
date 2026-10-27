import React from "react";

export const SHAPES = [
  "circle",
  "blob",
  "square",
  "star4",
  "flower",
  "heart",
  "star6",
  "egg",
  "pill",
  "triangle",
  "pentagon",
  "gear",
  "hexagon",
  "orange",
] as const;
export type Shape = (typeof SHAPES)[number];

export const COLORS = [
  "black",
  "brown",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;
export type BotColor = (typeof COLORS)[number];

function star(points: number, outer: number, inner: number, rot = -90) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    return `${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`;
  }).join(" ");
}

function ShapeBody({ shape }: { shape: Shape }) {
  const round = { strokeWidth: 14, strokeLinejoin: "round" as const };
  switch (shape) {
    case "circle":
    case "orange":
      return <circle cx="50" cy="52" r="42" />;
    case "blob":
      return <path d="M50 10c18 0 22 12 32 18s10 26 0 38-22 24-38 22S10 76 10 56s22-46 40-46z" />;
    case "square":
      return <rect x="16" y="16" width="68" height="68" rx="14" transform="rotate(-15 50 50)" />;
    case "star4":
      return <polygon points={star(4, 40, 20, -90)} {...round} />;
    case "flower":
      return <polygon points={star(6, 38, 28)} strokeWidth={22} strokeLinejoin="round" />;
    case "heart":
      return <path d="M12 40c0-18 22-26 38-14 16-12 38-4 38 14 0 22-24 40-38 46C36 80 12 62 12 40z" />;
    case "star6":
      return <polygon points={star(6, 40, 24)} {...round} />;
    case "egg":
      return <ellipse cx="50" cy="54" rx="36" ry="40" transform="rotate(-12 50 50)" />;
    case "pill":
      return <rect x="8" y="24" width="84" height="56" rx="28" transform="rotate(-10 50 50)" />;
    case "triangle":
      return <polygon points="20,18 86,58 26,86" {...round} />;
    case "pentagon":
      return <polygon points={star(5, 38, 31, -60)} {...round} />;
    case "gear":
      return <polygon points={star(8, 40, 32)} {...round} />;
    case "hexagon":
      return <polygon points={star(3, 38, 34, -30)} {...round} />;
    default:
      return <circle cx="50" cy="52" r="42" />;
  }
}

export function BotAvatar({
  shape,
  color,
  size = 40,
}: {
  shape: Shape;
  color: BotColor;
  size?: number;
}) {
  const fill = `var(--bot-${color})`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ fill, stroke: fill, flexShrink: 0 }}>
      <g strokeWidth={0}>
        <ShapeBody shape={shape} />
      </g>
      {shape === "orange" && (
        <path
          d="M50 12 C48 4 54 0 58 2"
          strokeWidth={4}
          fill="none"
          style={{ stroke: "var(--bot-black)" }}
        />
      )}
      <g style={{ fill: "var(--background)" }} strokeWidth={0}>
        <rect x="38" y="36" width="9" height="20" rx="4.5" transform="rotate(-12 42 46)" />
        <rect x="55" y="34" width="9" height="20" rx="4.5" transform="rotate(-12 59 44)" />
      </g>
    </svg>
  );
}

/** Map roster hex colors to token bot palette names. */
export function hexToBotColor(hex?: string): BotColor {
  if (!hex) return "blue";
  const h = hex.toLowerCase();
  if (h.includes("ef44") || h.includes("e11d") || h.includes("dc26")) return "red";
  if (h.includes("1d4ed8") || h.includes("3b82") || h.includes("2563")) return "blue";
  if (h.includes("06b6") || h.includes("14b8")) return "teal";
  if (h.includes("f59e") || h.includes("d977")) return "amber";
  if (h.includes("10b981") || h.includes("22c55")) return "green";
  if (h.includes("8b5cf6") || h.includes("a855")) return "purple";
  if (h.includes("6b728") || h.includes("64748")) return "gray";
  return "red";
}
