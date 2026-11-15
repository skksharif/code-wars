import { AVATAR_INFO, isAvatarId, type AvatarId } from "@code-wars/shared";
import type { ReactNode } from "react";

/** Shoulders, collar and neck shared by every avatar. */
function Body({
  shirt,
  accent,
  collar,
  neck,
}: {
  shirt: string;
  accent: string;
  collar: string;
  neck: string;
}) {
  return (
    <>
      <path d="M28 220 C28 166 60 150 100 150 C140 150 172 166 172 220 Z" fill={shirt} />
      <path d={collar} fill="none" stroke={accent} strokeWidth="4" />
      <rect x="88" y="120" width="24" height="34" rx="9" fill={neck} />
    </>
  );
}

const eyes = (fill = "#12141C", r = 4.5) => (
  <>
    <circle cx="87" cy="100" r={r} fill={fill} />
    <circle cx="113" cy="100" r={r} fill={fill} />
  </>
);

const smile = (color: string) => (
  <path
    d="M90 122 Q100 129 110 122"
    fill="none"
    stroke={color}
    strokeWidth="3.5"
    strokeLinecap="round"
  />
);

/** Original artwork, 200 × 220. */
const ART: Record<AvatarId, ReactNode> = {
  cipher: (
    <>
      <Body shirt="#1B2033" accent="#5CF2C2" collar="M78 156 L100 176 L122 156" neck="#B9774A" />
      <circle cx="62" cy="98" r="9" fill="#C68642" />
      <circle cx="138" cy="98" r="9" fill="#C68642" />
      <ellipse cx="100" cy="94" rx="38" ry="44" fill="#C68642" />
      <path
        d="M62 86 C58 48 84 38 100 41 C122 38 144 52 138 86 L132 70 L124 80 L116 64 L106 78 L96 62 L86 78 L76 64 L70 80 Z"
        fill="#1A1A22"
      />
      <path
        d="M80 92 L92 90 M108 90 L120 92"
        stroke="#1A1A22"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      {eyes()}
      {smile("#7A3E22")}
      <path
        d="M56 98 C54 42 146 42 144 98"
        fill="none"
        stroke="#5CF2C2"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="46" y="86" width="18" height="30" rx="7" fill="#5CF2C2" />
      <rect x="136" y="86" width="18" height="30" rx="7" fill="#5CF2C2" />
    </>
  ),
  kernel: (
    <>
      <Body
        shirt="#2A1F3D"
        accent="#FF8A3D"
        collar="M70 160 C84 172 116 172 130 160"
        neck="#D9A27A"
      />
      <circle cx="62" cy="98" r="9" fill="#F1C9A5" />
      <circle cx="138" cy="98" r="9" fill="#F1C9A5" />
      <ellipse cx="100" cy="94" rx="38" ry="44" fill="#F1C9A5" />
      <path
        d="M64 100 C66 134 84 142 100 142 C116 142 134 134 136 100 C128 118 118 122 100 122 C82 122 72 118 64 100 Z"
        fill="#6B3A1E"
      />
      <path
        d="M88 116 Q100 112 112 116"
        fill="none"
        stroke="#6B3A1E"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M92 124 Q100 129 108 124"
        fill="none"
        stroke="#3B1E0E"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M80 90 L92 89 M108 89 L120 90"
        stroke="#6B3A1E"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {eyes()}
      <path d="M60 80 C60 34 140 34 140 80 Z" fill="#FF8A3D" />
      <rect x="57" y="72" width="86" height="16" rx="7" fill="#D9682A" />
      <circle cx="100" cy="36" r="9" fill="#FF8A3D" />
    </>
  ),
  vector: (
    <>
      <path d="M28 220 C28 166 60 150 100 150 C140 150 172 166 172 220 Z" fill="#14263D" />
      <rect x="92" y="150" width="16" height="70" fill="#4D8BFF" />
      <rect x="88" y="120" width="24" height="34" rx="9" fill="#6E4320" />
      <circle cx="62" cy="98" r="9" fill="#8D5524" />
      <circle cx="138" cy="98" r="9" fill="#8D5524" />
      <ellipse cx="100" cy="94" rx="38" ry="44" fill="#8D5524" />
      <path
        d="M60 90 C54 46 92 34 118 40 C140 46 148 66 140 90 C132 68 110 60 84 66 C72 69 64 78 60 90 Z"
        fill="#0F0F14"
      />
      <rect
        x="74"
        y="90"
        width="24"
        height="18"
        rx="4"
        fill="none"
        stroke="#4D8BFF"
        strokeWidth="3.5"
      />
      <rect
        x="102"
        y="90"
        width="24"
        height="18"
        rx="4"
        fill="none"
        stroke="#4D8BFF"
        strokeWidth="3.5"
      />
      <path d="M98 97 L102 97" stroke="#4D8BFF" strokeWidth="3.5" />
      {eyes("#12141C", 4)}
      {smile("#3B1E0E")}
    </>
  ),
  nova: (
    <>
      <path d="M54 100 C48 40 152 40 146 100 L154 196 C130 184 70 184 46 196 Z" fill="#3B2A5C" />
      <Body
        shirt="#241A3A"
        accent="#B98CFF"
        collar="M76 158 C88 168 112 168 124 158"
        neck="#C99A6B"
      />
      <ellipse cx="100" cy="94" rx="37" ry="44" fill="#E0AC69" />
      <path
        d="M62 88 C64 50 100 42 122 48 C138 52 142 66 138 86 C122 70 96 66 62 88 Z"
        fill="#4A3470"
      />
      <rect x="66" y="88" width="68" height="20" rx="10" fill="#B98CFF" />
      <rect x="72" y="92" width="22" height="5" rx="2.5" fill="#E9DBFF" />
      {smile("#9A4A3A")}
    </>
  ),
  pixel: (
    <>
      <Body shirt="#12302A" accent="#B6F24A" collar="M74 156 L100 172 L126 156" neck="#E5BE96" />
      <circle cx="64" cy="48" r="19" fill="#1A1A22" />
      <circle cx="136" cy="48" r="19" fill="#1A1A22" />
      <circle cx="62" cy="98" r="8" fill="#FFDBAC" />
      <circle cx="138" cy="98" r="8" fill="#FFDBAC" />
      <ellipse cx="100" cy="94" rx="37" ry="44" fill="#FFDBAC" />
      <path d="M62 88 C58 50 142 50 138 88 C126 70 74 70 62 88 Z" fill="#1A1A22" />
      <path
        d="M80 91 L92 90 M108 90 L120 91"
        stroke="#1A1A22"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse cx="87" cy="100" rx="4.5" ry="5.5" fill="#12141C" />
      <ellipse cx="113" cy="100" rx="4.5" ry="5.5" fill="#12141C" />
      <circle cx="80" cy="112" r="5" fill="#F5A3A3" opacity="0.6" />
      <circle cx="120" cy="112" r="5" fill="#F5A3A3" opacity="0.6" />
      {smile("#A0524A")}
      <rect x="134" y="88" width="12" height="22" rx="5" fill="#B6F24A" />
      <path
        d="M140 108 C142 128 128 132 112 130"
        fill="none"
        stroke="#B6F24A"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="110" cy="130" r="5" fill="#B6F24A" />
    </>
  ),
  echo: (
    <>
      <path d="M28 220 C28 166 60 150 100 150 C140 150 172 166 172 220 Z" fill="#3A1A24" />
      <path d="M80 156 C90 166 110 166 120 156" fill="none" stroke="#FF5C7A" strokeWidth="4" />
      <path d="M54 104 C46 44 154 44 146 104 L148 130 L52 130 Z" fill="#8A3B1E" />
      <rect x="88" y="120" width="24" height="34" rx="9" fill="#7A4A26" />
      <ellipse cx="100" cy="96" rx="36" ry="42" fill="#A0662F" />
      <path
        d="M60 92 C58 52 142 52 140 92 C128 76 120 70 104 70 C96 80 80 86 60 92 Z"
        fill="#A5482A"
      />
      <circle cx="86" cy="101" r="11" fill="none" stroke="#FF5C7A" strokeWidth="3.5" />
      <circle cx="114" cy="101" r="11" fill="none" stroke="#FF5C7A" strokeWidth="3.5" />
      <path d="M97 101 L103 101" stroke="#FF5C7A" strokeWidth="3.5" />
      <circle cx="86" cy="102" r="4" fill="#12141C" />
      <circle cx="114" cy="102" r="4" fill="#12141C" />
      <path
        d="M91 124 Q100 130 109 124"
        fill="none"
        stroke="#4A2412"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </>
  ),
};

const HEXAGON = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

export interface AvatarProps {
  /** Unknown values fall back to Cipher, so old data never breaks a page. */
  id: string | null | undefined;
  /** Width in pixels. */
  size: number;
  /** Frame colour, for example the player's tier colour. */
  frame?: string;
  shape?: "hexagon" | "circle";
  /** Decorative when a name is shown next to it. */
  decorative?: boolean;
}

export function Avatar({
  id,
  size,
  frame = "#3A4160",
  shape = "circle",
  decorative = false,
}: AvatarProps) {
  const avatar: AvatarId = isAvatarId(id) ? id : "cipher";
  const info = AVATAR_INFO[avatar];
  const svg = (
    <svg
      viewBox={shape === "circle" ? "20 30 160 160" : "0 0 200 220"}
      width="100%"
      height="100%"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": `${info.name} avatar: ${info.look}` })}
    >
      {ART[avatar]}
    </svg>
  );

  if (shape === "circle") {
    return (
      <span
        className="inline-block flex-none overflow-hidden rounded-full bg-panel-deep align-middle"
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${frame}` }}
      >
        {svg}
      </span>
    );
  }
  const border = Math.max(2, Math.round(size / 48));
  return (
    <span
      className="inline-block flex-none"
      style={{
        width: size,
        height: size * 1.1,
        background: frame,
        clipPath: HEXAGON,
        padding: border,
        boxSizing: "border-box",
      }}
    >
      <span className="block h-full w-full bg-panel-deep" style={{ clipPath: HEXAGON }}>
        {svg}
      </span>
    </span>
  );
}
