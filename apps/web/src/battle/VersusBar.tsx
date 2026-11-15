import { LANGUAGE_LABELS } from "@code-wars/shared";
import type { BattlePlayer } from "../lib/api";
import { formatClock, type BattlePhase } from "./useBattle";
import { Avatar } from "../components/Avatar";

function Segments({
  player,
  total,
  side,
}: {
  player: BattlePlayer;
  total: number;
  side: "you" | "rival";
}) {
  const label = `${player.isYou ? "You have" : `${player.username} has`} passed ${player.bestPassed} of ${total} hidden tests`;
  const lit = side === "you" ? "bg-you glow-you" : "bg-rival glow-rival";
  return (
    <div
      role="img"
      aria-label={label}
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => {
        // The rival's bar fills from the outside edge inward, mirroring yours.
        const filled = side === "you" ? i < player.bestPassed : i >= total - player.bestPassed;
        return <div key={i} className={`h-3 ${filled ? lit : "bg-line"}`} />;
      })}
    </div>
  );
}

function meta(player: BattlePlayer, online: boolean | null): string {
  const parts = [
    String(player.ratingBefore),
    player.language ? LANGUAGE_LABELS[player.language] : null,
    `${player.attempts} ${player.attempts === 1 ? "try" : "tries"}`,
    online === null ? null : online ? "online" : "offline",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function VersusBar({
  you,
  rival,
  totalTests,
  phase,
  remainingMs,
  rivalOnline,
}: {
  you: BattlePlayer;
  rival: BattlePlayer;
  totalTests: number;
  phase: BattlePhase;
  remainingMs: number;
  rivalOnline: boolean | null;
}) {
  const clockLabel =
    phase === "ready" ? "Starts in" : phase === "active" ? "Time left" : "Time is up";
  // On phones the three parts share one row (you · clock · rival) and the
  // details move under each name; the bar stays pinned while the page scrolls.
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel px-3 py-2 md:flex-wrap md:gap-5 md:px-6 md:py-3">
      <div className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5 md:basis-72">
        <div className="flex items-center justify-between gap-2 md:items-baseline md:gap-3">
          <span className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-you md:text-xl">
            <span className="hidden flex-none md:inline-flex">
              <Avatar id={you.avatar} size={28} frame="#22E6FF" decorative />
            </span>
            <span className="truncate">{you.username}</span>{" "}
            <span className="hidden font-mono text-sm font-normal text-muted md:inline">
              {meta(you, null)}
            </span>
          </span>
          <span className="flex-none font-mono text-sm md:text-base">
            {you.bestPassed} / {totalTests}
          </span>
        </div>
        <Segments player={you} total={totalTests} side="you" />
      </div>

      <div
        role="timer"
        aria-label={`${clockLabel} ${formatClock(remainingMs)}`}
        className="flex flex-none flex-col items-center md:px-3"
      >
        <span className="text-[10px] tracking-[0.16em] text-muted uppercase md:text-[11px] md:tracking-[0.2em]">
          {clockLabel}
        </span>
        <span className="font-display text-3xl leading-none font-bold md:text-5xl">
          {formatClock(remainingMs)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5 md:basis-72">
        <div className="flex items-center justify-between gap-2 md:items-baseline md:gap-3">
          <span className="flex-none font-mono text-sm md:text-base">
            {rival.bestPassed} / {totalTests}
          </span>
          <span className="flex min-w-0 items-center justify-end gap-2 text-right font-display text-base font-bold text-rival md:text-xl">
            <span className="hidden font-mono text-sm font-normal text-muted md:inline">
              {meta(rival, rivalOnline)}
            </span>{" "}
            <span className="truncate">{rival.username}</span>
            <span className="hidden flex-none md:inline-flex">
              <Avatar id={rival.avatar} size={28} frame="#FF2E9A" decorative />
            </span>
          </span>
        </div>
        <Segments player={rival} total={totalTests} side="rival" />
        {rivalOnline === false ? (
          <span className="text-right font-mono text-[11px] text-muted md:hidden">offline</span>
        ) : null}
      </div>
    </header>
  );
}
