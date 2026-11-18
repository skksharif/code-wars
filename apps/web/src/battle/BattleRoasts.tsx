import type { BattlePlayer, BattleState } from "../lib/api";
import { roastsFor, type Roast, type RoastId } from "./roasts";

const TONE: Record<Roast["tone"], string> = {
  you: "#22E6FF",
  rival: "#FF2E9A",
  gold: "#FFC83D",
  mint: "#5CF2C2",
  soft: "#C3CAE0",
};

/** Neon outline icons (24 × 24, drawn with the current colour). */
const PATHS: Record<RoastId, React.ReactNode> = {
  headshot: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" />
    </>
  ),
  speedrun: <path d="M13.5 2 4.5 13.5h6.5L9.5 22 19.5 9.5H13z" strokeLinejoin="round" />,
  masher: (
    <>
      <circle cx="12" cy="5.5" r="3.2" />
      <path d="M12 8.7V15" />
      <rect x="3" y="15" width="18" height="6" rx="1.5" />
      <circle cx="7.5" cy="18" r="1" fill="currentColor" />
      <circle cx="16.5" cy="18" r="1" fill="currentColor" />
    </>
  ),
  clutch: (
    <>
      <circle cx="10.5" cy="14" r="7" />
      <path d="M15.5 9 18 6.5M17 3.5l1.5 1.5M20.5 4l-1 1M21 7.5h-1.5" />
      <path d="M8 12.5a3 3 0 0 1 2.5-2" />
    </>
  ),
  overtime: (
    <path d="M6 2.5h12M6 21.5h12M7 2.5c0 5 10 5 10 9.5S7 16.5 7 21.5M17 2.5c0 5-10 5-10 9.5s10 4.5 10 9.5M9.5 19h5" />
  ),
  flatline: (
    <>
      <path d="M12 2.5c-5 0-8 3.4-8 7.8 0 2.7 1.2 4.4 2.7 5.4V19h10.6v-3.3c1.5-1 2.7-2.7 2.7-5.4 0-4.4-3-7.8-8-7.8z" />
      <circle cx="8.8" cy="11" r="1.8" fill="currentColor" />
      <circle cx="15.2" cy="11" r="1.8" fill="currentColor" />
      <path d="M10 19v2.5M14 19v2.5M12 14l-1 2h2z" />
    </>
  ),
  soclose: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M14.5 2 19 6.5M19 2v4.5h4M21 3l-6.4 6.4" />
    </>
  ),
  flawless: (
    <>
      <path d="M3 18.5h18L19.5 7l-4.5 4L12 4.5 9 11 4.5 7z" strokeLinejoin="round" />
      <path d="M4 21.5h16" />
    </>
  ),
  ragequit: <path d="M14 3H5v18h9M10 12h11M17.5 8.5 21 12l-3.5 3.5M5 3l5 2v16" />,
  afk: (
    <>
      <rect x="2" y="9" width="20" height="10" rx="5" />
      <path d="M7 12v4M5 14h4M14 2.5h4l-4 4h4" />
      <circle cx="16" cy="13" r="1" fill="currentColor" />
      <circle cx="18" cy="15.5" r="1" fill="currentColor" />
    </>
  ),
};

export function RoastIcon({ id, color, size = 34 }: { id: RoastId; color: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      style={{ color, filter: `drop-shadow(0 0 6px ${color}99)` }}
    >
      {PATHS[id]}
    </svg>
  );
}

function RoastCard({ roast, side }: { roast: Roast; side: "you" | "rival" }) {
  const color = TONE[roast.tone];
  return (
    <li
      className={`flex items-center gap-3 border border-line bg-panel px-3 py-2 ${
        side === "you" ? "border-l-[3px] border-l-you" : "border-l-[3px] border-l-rival"
      }`}
    >
      <span className="flex h-11 w-12 flex-none items-center justify-center">
        <RoastIcon id={roast.id} color={color} />
      </span>
      <span className="min-w-0">
        <span
          className="block font-display text-[15px] font-bold tracking-[0.08em] uppercase"
          style={{ color }}
        >
          {roast.title}
        </span>
        <span className="block text-sm text-soft">{roast.line}</span>
      </span>
    </li>
  );
}

/** Funny stats from the battle: up to 2 for each player, yours left, theirs right. */
export function BattleRoasts({
  state,
  you,
  rival,
}: {
  state: BattleState;
  you: BattlePlayer;
  rival: BattlePlayer;
}) {
  const mine = roastsFor(state, you);
  const theirs = roastsFor(state, rival);
  if (mine.length === 0 && theirs.length === 0) return null;
  return (
    <section aria-label="Battle roasts" className="flex flex-col gap-2">
      <h2 className="m-0 text-xs font-normal tracking-[0.14em] text-muted uppercase">
        Battle roasts
      </h2>
      <div className="grid gap-2 md:grid-cols-2 md:gap-x-6">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {mine.map((r) => (
            <RoastCard key={r.id} roast={r} side="you" />
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {theirs.map((r) => (
            <RoastCard key={r.id} roast={r} side="rival" />
          ))}
        </ul>
      </div>
    </section>
  );
}
