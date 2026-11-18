import { describe, expect, it } from "vitest";
import { finishedState, RIVAL } from "../test/fakeServices";
import { roastsFor } from "./roasts";

const at = (ms: number) => new Date(Date.parse("2026-11-18T10:00:00Z") + ms).toISOString();

/** A finished 15-minute battle that started at 10:00. */
function battle(
  you: Parameters<typeof finishedState>[0],
  rival: Parameters<typeof finishedState>[1],
  extra: Parameters<typeof finishedState>[2] = {},
) {
  return finishedState(you, rival, {
    startsAt: at(0),
    endsAt: at(15 * 60_000),
    finishReason: "solved",
    winnerId: "user-1",
    ...extra,
  });
}
const ids = (state: ReturnType<typeof battle>, isYou: boolean) =>
  roastsFor(
    state,
    state.players.find((p) => p.isYou === isYou)!,
  ).map((r) => r.id);

describe("battle roasts", () => {
  it("a fast first-try win against a 0 is flawless and a speedrun; the loser flatlines", () => {
    const state = battle(
      { result: "win", bestPassed: 5, attempts: 1 },
      { result: "loss", bestPassed: 0, attempts: 2 },
      { firstSolvedAt: at(72_000) },
    );
    const mine = roastsFor(state, state.players[0]!);
    expect(mine.map((r) => r.id)).toEqual(["flawless", "speedrun"]);
    expect(mine[0]!.line).toBe(`First try, and ${RIVAL.username} scored 0.`);
    expect(mine[1]!.line).toBe("You solved it in 01:12.");
    expect(ids(state, false)).toEqual(["flatline"]);
  });

  it("first try is a headshot; many submissions and 4 of 5 roast the loser", () => {
    const state = battle(
      { result: "win", bestPassed: 5, attempts: 1 },
      { result: "loss", bestPassed: 4, attempts: 7 },
      { firstSolvedAt: at(8 * 60_000) },
    );
    expect(ids(state, true)).toEqual(["headshot"]);
    const theirs = roastsFor(state, state.players[1]!);
    expect(theirs.map((r) => r.id)).toEqual(["masher", "soclose"]);
    expect(theirs[0]!.line).toBe(`${RIVAL.username} submitted 7 times.`);
    expect(theirs[1]!.line).toBe("4 of 5 tests. One away.");
  });

  it("solving in the last minute is clutch", () => {
    const state = battle(
      { result: "win", bestPassed: 5, attempts: 3 },
      { result: "loss", bestPassed: 2, attempts: 2 },
      { firstSolvedAt: at(15 * 60_000 - 9_000) },
    );
    expect(roastsFor(state, state.players[0]!)[0]!.line).toBe("You solved it with 00:09 left.");
  });

  it("a forfeit is a rage quit; never submitting is AFK", () => {
    const state = battle(
      { result: "win", bestPassed: 3, attempts: 2 },
      { result: "loss", bestPassed: 0, attempts: 0 },
      { finishReason: "forfeit", finishedAt: at(125_000) },
    );
    const theirs = roastsFor(state, state.players[1]!);
    expect(theirs.map((r) => r.id)).toEqual(["ragequit", "afk"]);
    expect(theirs[0]!.line).toBe(`${RIVAL.username} forfeited after 02:05.`);
    expect(ids(state, true)).toEqual([]);
  });

  it("solving in overtime makes an overtime hero", () => {
    const state = battle(
      { result: "loss", bestPassed: 5, attempts: 2, solvedInOvertime: true },
      { result: "win", bestPassed: 5, attempts: 4 },
      { winnerId: "user-2", firstSolvedAt: at(10 * 60_000) },
    );
    expect(ids(state, true)).toEqual(["overtime"]);
    expect(ids(state, false)).toEqual([]);
  });
});
