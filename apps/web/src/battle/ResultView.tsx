import { LANGUAGE_LABELS } from "@code-wars/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BattlePlayer, BattleState } from "../lib/api";
import type { FinalSubmission } from "../lib/live";
import { useServices } from "../services";
import { Avatar } from "../components/Avatar";
import { formatClock } from "./useBattle";
import { RematchBanner, useRematch, WhatNext } from "./WhatNext";
import { EmoteBubble, SaySomething, type EmotesView } from "./Emotes";
import { AFTER_BATTLE_EMOTES } from "./emoteList";
import { BattleRoasts } from "./BattleRoasts";

/** What happened in the overtime after the first solve, if there was one. */
function overtimeText(state: BattleState, you: BattlePlayer, rival: BattlePlayer): string {
  const youWon = you.result === "win";
  switch (state.battle.overtimeOutcome) {
    case "solved":
      if (youWon) return `${rival.username} also solved it in overtime.`;
      return state.battle.isRated
        ? "You solved it in overtime: your rating loss was halved."
        : "You also solved it in overtime.";
    case "gave_up":
      return youWon ? `${rival.username} gave up in overtime.` : "You gave up in overtime.";
    case "timeout":
      return youWon ? `${rival.username} ran out of overtime.` : "Overtime ran out.";
    default:
      return "";
  }
}

function reasonText(state: BattleState, you: BattlePlayer, rival: BattlePlayer): string {
  const youWon = you.result === "win";
  // The winner's view while the other player is still in overtime.
  if (state.battle.status === "active" && youWon) return "You passed every hidden test first.";
  switch (state.battle.finishReason) {
    case "solved":
      return [
        youWon
          ? "You passed every hidden test first."
          : `${rival.username} passed every hidden test first.`,
        overtimeText(state, you, rival),
      ]
        .filter(Boolean)
        .join(" ");
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
  rated,
  blitz = false,
}: {
  blitz?: boolean;
  player: BattlePlayer;
  total: number;
  side: "you" | "rival";
  /** Custom matches show no rating change. */
  rated: boolean;
}) {
  const accent = side === "you" ? "text-you" : "text-rival";
  const edge = side === "you" ? "border-b-you" : "border-b-rival";
  const outcome =
    player.result === "win"
      ? "Winner"
      : player.result === "loss"
        ? player.solvedInOvertime
          ? "Defeated · solved in overtime"
          : "Defeated"
        : player.result === "draw"
          ? "Draw"
          : "In overtime";
  const delta = player.ratingAfter === null ? null : player.ratingAfter - player.ratingBefore;
  return (
    <div
      className={`flex min-w-0 flex-1 basis-80 flex-col gap-2 border-b-[3px] bg-panel px-4 py-6 md:px-[5%] md:py-8 ${edge} ${side === "rival" ? "items-end text-right" : ""}`}
    >
      <p className={`m-0 font-mono text-xs tracking-widest uppercase ${accent}`}>
        {outcome}
        {player.isYou ? " · you" : ""}
      </p>
      <Link
        to={`/u/${player.username}`}
        className={`flex max-w-full min-w-0 items-center gap-3 font-display text-2xl font-bold text-ink no-underline md:text-3xl ${side === "rival" ? "flex-row-reverse" : ""}`}
      >
        <Avatar
          id={player.avatar}
          size={56}
          frame={side === "you" ? "#22E6FF" : "#FF2E9A"}
          decorative
        />
        <span className="min-w-0 break-all">{player.username}</span>
      </Link>
      {rated && player.ratingAfter !== null && delta !== null ? (
        <p
          className="m-0 flex items-baseline gap-3 font-display font-bold"
          aria-label={`${blitz ? "Blitz rating" : "Rating"} ${player.ratingBefore} to ${player.ratingAfter}, change ${delta >= 0 ? "plus" : "minus"} ${Math.abs(delta)}`}
        >
          <span className="text-2xl text-muted">{player.ratingBefore}</span>
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <span className="text-5xl leading-none md:text-6xl">{player.ratingAfter}</span>
          <span className={`text-2xl md:text-3xl ${accent}`}>
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

export function ResultView({
  state,
  overtimeLeftMs = 0,
  rivalHere = null,
  emotes,
}: {
  /** Quick emotes (absent in places that only show a result). */
  emotes?: EmotesView;
  state: BattleState;
  /** While the opponent is in overtime: how long they have left. */
  overtimeLeftMs?: number;
  /** Whether the opponent is still on the battle page (null: unknown). */
  rivalHere?: boolean | null;
}) {
  const { data } = useServices();
  const you = state.players.find((p) => p.isYou)!;
  const rival = state.players.find((p) => !p.isYou)!;
  const [solutions, setSolutions] = useState<FinalSubmission[] | "loading" | "error">("loading");
  const [tab, setTab] = useState<"you" | "rival">("you");
  const rated = state.battle.isRated !== false;
  const blitz = state.battle.mode === "blitz";

  useEffect(() => {
    let active = true;
    data.getFinalSubmissions(state.battle.id).then(
      (rows) => active && setSolutions(rows),
      () => active && setSolutions("error"),
    );
    return () => {
      active = false;
    };
    // Refetch when an overtime ends: the opponent's code becomes readable then.
  }, [data, state.battle.id, state.battle.status]);

  const inOvertime = state.battle.status === "active";
  const rematch = useRematch(state.battle.id, !inOvertime);

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
      <RematchBanner view={rematch} rival={rival.username} />
      <section className="border-b border-line px-4 pt-7 pb-6 text-center md:px-[5%] md:pt-10 md:pb-7">
        <p className="m-0 font-mono text-xs tracking-[0.2em] text-muted uppercase">
          {blitz
            ? "⚡ Blitz · battle over"
            : rated
              ? "Battle over"
              : `Custom match${state.battle.roomCode ? ` · ${state.battle.roomCode}` : ""}`}
        </p>
        <h1
          className={`mt-2 mb-0 font-display text-6xl leading-none font-bold tracking-wider uppercase italic sm:text-7xl md:text-9xl ${headlineStyle}`}
        >
          {headline}
        </h1>
        <p className="mt-2 mb-0 text-lg text-soft">{reasonText(state, you, rival)}</p>
        {inOvertime ? (
          <p
            role="status"
            className="mx-auto mt-4 mb-0 inline-flex max-w-xl flex-wrap items-center justify-center gap-x-2 border border-rival bg-rival/10 px-4 py-2 text-soft"
          >
            <b className="font-display tracking-widest text-rival uppercase">Overtime</b>
            <span>
              {rival.username} has {formatClock(overtimeLeftMs)} left.{" "}
              {rated ? "If they solve it, their loss is halved." : "They can still solve it."} Your
              win is safe.
            </span>
          </p>
        ) : null}
        {rated ? null : (
          <p className="mt-3 mb-0">
            <span className="inline-block border border-[#5CF2C2] px-2 py-0.5 font-mono text-[11px] tracking-[0.12em] text-[#5CF2C2]">
              RATING UNCHANGED
            </span>
          </p>
        )}
      </section>

      <section className="relative flex flex-wrap items-stretch">
        <PlayerCard player={you} total={state.totalTests} side="you" rated={rated} blitz={blitz} />
        <PlayerCard
          player={rival}
          total={state.totalTests}
          side="rival"
          rated={rated}
          blitz={blitz}
        />
        {emotes ? (
          <>
            <EmoteBubble emote={emotes.mine} side="you" who="You" className="-top-4 left-3" />
            <EmoteBubble
              emote={emotes.theirs}
              side="rival"
              who={rival.username}
              className="-top-4 right-3"
            />
          </>
        ) : null}
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:w-[90%] md:px-0 md:py-8">
        <BattleRoasts state={state} you={you} rival={rival} />
        {emotes ? (
          <SaySomething view={emotes} rival={rival.username} quick={AFTER_BATTLE_EMOTES} />
        ) : null}
        {inOvertime ? (
          <div className="flex flex-col items-center gap-3">
            <p className="m-0 text-center text-muted">Rematch opens when the overtime ends.</p>
            <Link
              to={blitz ? "/arena?mode=blitz" : rated ? "/arena" : "/arena?mode=custom"}
              className="inline-flex h-12 items-center border border-line-strong px-6 font-display font-semibold tracking-widest text-ink uppercase no-underline hover:border-muted"
            >
              Find new battle
            </Link>
          </div>
        ) : (
          <WhatNext
            view={rematch}
            rival={rival.username}
            rivalHere={rivalHere}
            rated={rated}
            blitz={blitz}
          />
        )}

        <section aria-label="Solutions" className="border border-line bg-panel">
          <div role="tablist" className="flex flex-wrap border-b border-line">
            {(["you", "rival"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-12 min-w-0 flex-1 cursor-pointer border-0 border-b-2 bg-transparent px-3 py-2 font-display text-sm font-semibold tracking-widest break-all uppercase md:flex-none md:px-6 md:text-base ${
                  tab === key ? "border-you text-you" : "border-transparent text-muted"
                }`}
              >
                {key === "you" ? "Your solution" : `${rival.username}'s solution`}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="p-4 md:p-5">
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
