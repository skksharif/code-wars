import type { BattlePlayer, BattleState } from "../lib/api";
import { formatClock } from "./useBattle";

export type RoastId =
  | "flawless"
  | "ragequit"
  | "afk"
  | "flatline"
  | "overtime"
  | "clutch"
  | "speedrun"
  | "headshot"
  | "masher"
  | "soclose";

export interface Roast {
  id: RoastId;
  title: string;
  line: string;
  tone: "you" | "rival" | "gold" | "mint" | "soft";
}

/** Solved within this long from the start counts as a speedrun. */
export const SPEEDRUN_MS = 2 * 60_000;
/** Solved with this little time left counts as clutch. */
export const CLUTCH_MS = 60_000;
/** This many submissions or more is button mashing. */
export const MASHER_ATTEMPTS = 5;

/**
 * Up to two roasts for a player, the most striking first, worked out only from
 * what the result already shows. Nothing fits: an empty list.
 */
export function roastsFor(state: BattleState, player: BattlePlayer, limit = 2): Roast[] {
  const { battle, totalTests: total } = state;
  const other = state.players.find((p) => p.userId !== player.userId);
  const you = player.isYou;
  const who = you ? "You" : player.username;
  const startsAt = Date.parse(battle.startsAt);
  const solved = total > 0 && player.bestPassed >= total;
  // The player who solved it first (the race winner), and when.
  const firstSolver =
    solved && battle.firstSolvedAt && !player.solvedInOvertime && player.result === "win";
  const solveMs = firstSolver ? Date.parse(battle.firstSolvedAt!) - startsAt : null;
  const leftMs = firstSolver ? Date.parse(battle.endsAt) - Date.parse(battle.firstSolvedAt!) : null;
  const forfeited = battle.finishReason === "forfeit" && player.result === "loss";

  const found: Roast[] = [];
  const add = (roast: Roast) => found.push(roast);

  if (firstSolver && player.attempts === 1 && other && other.bestPassed === 0) {
    add({
      id: "flawless",
      title: "Flawless",
      line: `First try, and ${other.isYou ? "you" : other.username} scored 0.`,
      tone: "gold",
    });
  }
  if (forfeited) {
    const after = battle.finishedAt ? Date.parse(battle.finishedAt) - startsAt : null;
    add({
      id: "ragequit",
      title: "Rage quit",
      line:
        after !== null && after > 0
          ? `${who} forfeited after ${formatClock(after)}.`
          : `${who} forfeited.`,
      tone: "rival",
    });
  }
  if (player.attempts === 0) {
    add({ id: "afk", title: "AFK", line: `${who} never submitted anything.`, tone: "soft" });
  } else if (player.bestPassed === 0 && total > 0) {
    add({
      id: "flatline",
      title: "Flatline",
      line: `${who} passed 0 of ${total} tests.`,
      tone: "rival",
    });
  }
  if (player.solvedInOvertime) {
    add({
      id: "overtime",
      title: "Overtime hero",
      line: `${who} solved it in overtime.`,
      tone: "mint",
    });
  }
  if (leftMs !== null && leftMs <= CLUTCH_MS) {
    add({
      id: "clutch",
      title: "Clutch",
      line: `${who} solved it with ${formatClock(Math.max(0, leftMs))} left.`,
      tone: "gold",
    });
  }
  if (solveMs !== null && solveMs <= SPEEDRUN_MS) {
    add({
      id: "speedrun",
      title: "Speedrun",
      line: `${who} solved it in ${formatClock(solveMs)}.`,
      tone: "gold",
    });
  }
  if (solved && player.attempts === 1 && !found.some((r) => r.id === "flawless")) {
    add({ id: "headshot", title: "Headshot", line: "Solved on the first try.", tone: "you" });
  }
  if (player.attempts >= MASHER_ATTEMPTS) {
    add({
      id: "masher",
      title: "Button masher",
      line: `${who} submitted ${player.attempts} times.`,
      tone: "rival",
    });
  }
  if (!solved && total > 1 && player.bestPassed === total - 1) {
    add({
      id: "soclose",
      title: "So close",
      line: `${player.bestPassed} of ${total} tests. One away.`,
      tone: "rival",
    });
  }
  return found.slice(0, limit);
}
