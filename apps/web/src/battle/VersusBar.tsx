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
  return (
    <header className="flex flex-wrap items-center gap-5 border-b border-line bg-panel px-6 py-3">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-2 font-display text-xl font-bold text-you">
            <Avatar id={you.avatar} size={32} frame="#22E6FF" decorative />
            {you.username}{" "}
            <span className="font-mono text-sm font-normal text-muted">{meta(you, null)}</span>
          </span>
          <span className="font-mono">
            {you.bestPassed} / {totalTests}
          </span>
        </div>
        <Segments player={you} total={totalTests} side="you" />
      </div>

      <div
        role="timer"
        aria-label={`${clockLabel} ${formatClock(remainingMs)}`}
        className="flex flex-col items-center px-3"
      >
        <span className="text-[11px] tracking-[0.2em] text-muted uppercase">{clockLabel}</span>
        <span className="font-display text-5xl leading-none font-bold">
          {formatClock(remainingMs)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono">
            {rival.bestPassed} / {totalTests}
          </span>
          <span className="flex items-center justify-end gap-2 text-right font-display text-xl font-bold text-rival">
            <span className="font-mono text-sm font-normal text-muted">
              {meta(rival, rivalOnline)}
            </span>{" "}
            {rival.username}
            <Avatar id={rival.avatar} size={32} frame="#FF2E9A" decorative />
          </span>
        </div>
        <Segments player={rival} total={totalTests} side="rival" />
      </div>
    </header>
  );
}
