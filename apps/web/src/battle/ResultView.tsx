import { LANGUAGE_LABELS } from "@code-wars/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BattlePlayer, BattleState } from "../lib/api";
import type { FinalSubmission } from "../lib/live";
import { useServices } from "../services";

function reasonText(state: BattleState, you: BattlePlayer, rival: BattlePlayer): string {
  const youWon = you.result === "win";
  switch (state.battle.finishReason) {
    case "solved":
      return youWon
        ? "You passed every hidden test first."
        : `${rival.username} passed every hidden test first.`;
    case "timeout_score":
      return youWon
        ? "Time ran out. You passed more hidden tests."
        : `Time ran out. ${rival.username} passed more hidden tests.`;
    case "timeout_draw":
      return "Time ran out with equal scores.";
    case "forfeit":
      return youWon ? `${rival.username} forfeited.` : "You forfeited.";
    default:
      return "";
  }
}

function PlayerCard({
  player,
  total,
  side,
}: {
  player: BattlePlayer;
  total: number;
  side: "you" | "rival";
}) {
  const accent = side === "you" ? "text-you" : "text-rival";
  const edge = side === "you" ? "border-b-you" : "border-b-rival";
  const outcome =
    player.result === "win" ? "Winner" : player.result === "loss" ? "Defeated" : "Draw";
  const delta = player.ratingAfter === null ? null : player.ratingAfter - player.ratingBefore;
  return (
    <div
      className={`flex min-w-0 flex-1 basis-80 flex-col gap-2 border-b-[3px] bg-panel px-[5%] py-8 ${edge} ${side === "rival" ? "items-end text-right" : ""}`}
    >
      <p className={`m-0 font-mono text-xs tracking-widest uppercase ${accent}`}>
        {outcome}
        {player.isYou ? " · you" : ""}
      </p>
      <p className="m-0 font-display text-3xl font-bold">{player.username}</p>
      {player.ratingAfter !== null && delta !== null ? (
        <p
          className="m-0 flex items-baseline gap-3 font-display font-bold"
          aria-label={`Rating ${player.ratingBefore} to ${player.ratingAfter}, change ${delta >= 0 ? "plus" : "minus"} ${Math.abs(delta)}`}
        >
          <span className="text-2xl text-muted">{player.ratingBefore}</span>
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <span className="text-6xl leading-none">{player.ratingAfter}</span>
          <span className={`text-3xl ${accent}`}>
            {delta >= 0 ? "+" : "−"}
            {Math.abs(delta)}
          </span>
        </p>
      ) : null}
      <p className="m-0 font-mono text-sm text-muted">
        {[
          player.language ? LANGUAGE_LABELS[player.language] : null,
          `${player.attempts} ${player.attempts === 1 ? "attempt" : "attempts"}`,
          `${player.bestPassed} of ${total} hidden tests`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

export function ResultView({ state }: { state: BattleState }) {
  const { data } = useServices();
  const you = state.players.find((p) => p.isYou)!;
  const rival = state.players.find((p) => !p.isYou)!;
  const [solutions, setSolutions] = useState<FinalSubmission[] | "loading" | "error">("loading");
  const [tab, setTab] = useState<"you" | "rival">("you");

  useEffect(() => {
    let active = true;
    data.getFinalSubmissions(state.battle.id).then(
      (rows) => active && setSolutions(rows),
      () => active && setSolutions("error"),
    );
    return () => {
      active = false;
    };
  }, [data, state.battle.id]);

  const headline = you.result === "win" ? "Victory" : you.result === "loss" ? "Defeat" : "Draw";
  const headlineStyle =
    you.result === "win"
      ? "text-you text-glow-you"
      : you.result === "loss"
        ? "text-rival text-glow-rival"
        : "text-ink";

  const shownPlayer = tab === "you" ? you : rival;
  const shown = Array.isArray(solutions)
    ? solutions.find((s) => s.userId === shownPlayer.userId)
    : undefined;

  return (
    <main className="flex flex-1 flex-col">
      <section className="border-b border-line px-[5%] pt-10 pb-7 text-center">
        <p className="m-0 font-mono text-xs tracking-[0.2em] text-muted uppercase">Battle over</p>
        <h1
          className={`mt-2 mb-0 font-display text-7xl leading-none font-bold tracking-wider uppercase italic md:text-9xl ${headlineStyle}`}
        >
          {headline}
        </h1>
        <p className="mt-2 mb-0 text-lg text-soft">{reasonText(state, you, rival)}</p>
      </section>

      <section className="flex flex-wrap items-stretch">
        <PlayerCard player={you} total={state.totalTests} side="you" />
        <PlayerCard player={rival} total={state.totalTests} side="rival" />
      </section>

      <div className="mx-auto flex w-[90%] max-w-5xl flex-col gap-6 py-8">
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/arena"
            className="cut glow-you inline-flex h-14 items-center bg-you px-11 font-display text-xl font-bold tracking-widest text-ground uppercase no-underline"
          >
            Battle again
          </Link>
        </div>

        <section aria-label="Solutions" className="border border-line bg-panel">
          <div role="tablist" className="flex flex-wrap border-b border-line">
            {(["you", "rival"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`h-12 cursor-pointer border-0 border-b-2 bg-transparent px-6 font-display font-semibold tracking-widest uppercase ${
                  tab === key ? "border-you text-you" : "border-transparent text-muted"
                }`}
              >
                {key === "you" ? "Your solution" : `${rival.username}'s solution`}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="p-5">
            {solutions === "loading" ? (
              <p className="m-0 text-muted">Loading…</p>
            ) : solutions === "error" ? (
              <p role="alert" className="m-0 text-rival">
                Could not load the solutions.
              </p>
            ) : shown ? (
              <pre className="m-0 overflow-x-auto font-mono text-sm leading-relaxed text-soft">
                {shown.sourceCode}
              </pre>
            ) : (
              <p className="m-0 text-muted">
                {tab === "you" ? "You" : rival.username} did not submit a solution.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
