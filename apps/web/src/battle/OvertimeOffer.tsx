import { formatClock } from "./useBattle";

/** Half of a (negative) rating change, rounded in the player's favour, as the server does. */
export function halfLoss(fullDelta: number): number {
  return Math.trunc(fullDelta / 2);
}

function signed(delta: number): string {
  return delta === 0 ? "0" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
}

/**
 * Shown to the player who has not solved it yet, once the other player has.
 * It sits above the editor rather than over it, so no seconds are lost: the
 * overtime clock runs whether or not they answer.
 */
export function OvertimeOffer({
  rival,
  rivalSolveMs,
  passed,
  total,
  fullDelta,
  rated,
  leftMs,
  answered,
  onKeepCoding,
  onGiveUp,
  busy,
}: {
  rival: string;
  /** How long the rival took, from the start of the battle. */
  rivalSolveMs: number;
  passed: number;
  total: number;
  /** Rating change if overtime is not solved (negative; 0 when unrated). */
  fullDelta: number;
  rated: boolean;
  leftMs: number;
  /** After "Keep coding" the offer shrinks to a one-line reminder. */
  answered: boolean;
  onKeepCoding: () => void;
  onGiveUp: () => void;
  busy: boolean;
}) {
  const half = halfLoss(fullDelta);
  const stakes = rated
    ? `Solve it to halve your rating loss: ${signed(half)} instead of ${signed(fullDelta)}.`
    : "No rating at stake: finish it for bragging rights.";

  if (answered) {
    return (
      <p
        role="status"
        className="m-0 flex flex-wrap items-center justify-between gap-2 border-b border-rival/60 bg-rival/10 px-3 py-2 text-sm md:px-6"
      >
        <span>
          <b className="font-display tracking-widest text-rival uppercase">Overtime</b>{" "}
          {formatClock(leftMs)} · {stakes}
        </span>
        <button
          type="button"
          onClick={onGiveUp}
          disabled={busy}
          className="h-9 cursor-pointer border border-line-strong bg-transparent px-3 font-display text-xs font-semibold tracking-widest text-soft uppercase hover:border-muted disabled:opacity-50"
        >
          Give up
        </button>
      </p>
    );
  }

  return (
    // Deliberately not a modal and never takes focus: the player may be typing.
    <section
      aria-labelledby="overtime-title"
      aria-live="assertive"
      className="flex flex-col gap-3 border-b-2 border-rival bg-panel px-4 py-4 shadow-[0_0_24px_rgba(255,46,154,0.25)] md:flex-row md:items-center md:justify-between md:px-6"
    >
      <div className="flex flex-col gap-1">
        <p id="overtime-title" className="m-0 font-display text-xl font-bold">
          <span className="text-rival">{rival}</span> solved it in {formatClock(rivalSolveMs)}.
        </p>
        <p className="m-0 text-sm text-soft">
          You've passed {passed} of {total} tests.{" "}
          <b className="text-ink">Overtime: {formatClock(leftMs)} left.</b>
        </p>
        <p className="m-0 text-sm text-soft">{stakes}</p>
      </div>
      <div className="flex flex-none gap-2">
        <button
          type="button"
          onClick={onKeepCoding}
          className="cut glow-you h-12 flex-1 cursor-pointer border-0 bg-you px-6 font-display font-bold tracking-widest text-ground uppercase md:flex-none"
        >
          Keep coding
        </button>
        <button
          type="button"
          onClick={onGiveUp}
          disabled={busy}
          className="h-12 flex-1 cursor-pointer border border-line-strong bg-transparent px-6 font-display font-semibold tracking-widest text-ink uppercase hover:border-muted disabled:opacity-50 md:flex-none"
        >
          {busy ? "Giving up…" : "Give up"}
        </button>
      </div>
    </section>
  );
}
