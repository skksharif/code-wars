// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { createFakeAuth, TEST_USER } from "../test/fakeAuth";
import {
  BATTLE_ID,
  battleState,
  createFakeServices,
  finishedState,
  player,
  renderWithApp,
  RIVAL,
  type FakeServices,
} from "../test/fakeServices";

// Monaco needs a real browser; a plain text box stands in for it here.
vi.mock("../battle/CodeEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Code editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

let services: FakeServices;
beforeEach(() => {
  window.localStorage.clear();
  services = createFakeServices();
});
afterEach(cleanup);

const open = (path: string) => renderWithApp(createFakeAuth(TEST_USER), services, path);
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("lobby", () => {
  it("shows the player's rating and record", async () => {
    open("/arena");
    expect(await screen.findByText("1 W · 0 L · 0 D")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find Battle" })).toBeEnabled();
  });

  it("resumes a battle that is already in progress", async () => {
    services.api.getActiveBattle.mockResolvedValue(BATTLE_ID);
    open("/arena");
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(services.api.getBattle).toHaveBeenCalledWith(BATTLE_ID);
  });

  it("searches with a heartbeat and enters the battle when matched", async () => {
    // Each stage holds until the test has seen it, so nothing depends on timing.
    services.api.joinMatchmaking.mockResolvedValue({ status: "queued", waitedMs: 0 });
    open("/arena");
    await userEvent.click(await screen.findByRole("button", { name: "Find Battle" }));
    expect(await screen.findByText(/Searching rating 1116 to 1316/)).toBeInTheDocument();

    services.api.joinMatchmaking.mockResolvedValue({ status: "queued", waitedMs: 10_000 });
    expect(await screen.findByText(/Searching rating 1066 to 1366/)).toBeInTheDocument();

    services.api.joinMatchmaking.mockResolvedValue({ status: "matched", battleId: BATTLE_ID });
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(services.api.joinMatchmaking.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("cancels a search and stops the heartbeat", async () => {
    open("/arena");
    await userEvent.click(await screen.findByRole("button", { name: "Find Battle" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(services.api.cancelMatchmaking).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Find Battle" })).toBeInTheDocument();
    const calls = services.api.joinMatchmaking.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(services.api.joinMatchmaking.mock.calls.length).toBe(calls);
  });

  it("tells the player when no opponent was found", async () => {
    services.api.joinMatchmaking.mockResolvedValue({ status: "timeout" });
    open("/arena");
    await userEvent.click(await screen.findByRole("button", { name: "Find Battle" }));
    expect(await screen.findByText(/No opponent found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find Battle" })).toBeInTheDocument();
  });

  it("shows an error if matchmaking fails", async () => {
    services.api.joinMatchmaking.mockRejectedValue(
      new ApiError("NETWORK", "Could not reach the server. Check your connection.", 0),
    );
    open("/arena");
    await userEvent.click(await screen.findByRole("button", { name: "Find Battle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});

describe("battle room", () => {
  const openBattle = () => open(`/battle/${BATTLE_ID}`);

  it("shows both players, the timer, the problem and the editor", async () => {
    services.api.getBattle.mockResolvedValue(
      battleState({
        players: [
          player({ bestPassed: 3, attempts: 1, language: "python" }),
          player({ ...RIVAL, bestPassed: 4, attempts: 2, language: "cpp" }),
        ],
      }),
    );
    openBattle();

    expect(await screen.findByRole("heading", { name: "Count the Peaks" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "You have passed 3 of 5 hidden tests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "byte_rival has passed 4 of 5 hidden tests" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAccessibleName(/Time left 1[34]:\d\d/);
    expect(screen.getByText(/C\+\+ · 2 tries/)).toBeInTheDocument();
    expect(screen.getByText("The 2 is a peak.")).toBeInTheDocument();
    expect(await screen.findByLabelText("Code editor")).toBeInTheDocument();
  });

  it("renders the statement as formatted text, never as raw HTML", async () => {
    const base = battleState();
    services.api.getBattle.mockResolvedValue({
      ...base,
      problem: { ...base.problem!, statementMd: "Be **bold** <img src=x onerror=alert(1)>" },
    });
    openBattle();
    const problem = await screen.findByRole("region", { name: "Problem" });
    expect(within(problem).getByText("bold").tagName).toBe("STRONG");
    expect(problem.querySelector("img")).toBeNull();
  });

  it("holds the problem back during the get-ready countdown, then reveals it", async () => {
    const waiting = battleState({ problem: null });
    waiting.battle.startsAt = iso(150);
    services.api.getBattle.mockResolvedValueOnce(waiting).mockResolvedValue(battleState());
    openBattle();

    expect(await screen.findByText(/Get ready/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAccessibleName(/Starts in/);
    expect(screen.queryByRole("region", { name: "Problem" })).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "Count the Peaks" })).toBeInTheDocument();
  });

  it("runs the samples and shows expected against actual output", async () => {
    services.api.run.mockResolvedValue({
      verdict: "wrong_answer",
      passed: 0,
      total: 1,
      cases: [{ input: "3\n1 2 1", expected: "1", actual: "7", status: "wrong_answer" }],
    });
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Run samples" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Wrong answer · sample tests: 0 of 1 passed");
    expect(status).toHaveTextContent("Your output");
    expect(status).toHaveTextContent("7");
    expect(services.api.run).toHaveBeenCalledWith(BATTLE_ID, "python", expect.any(String));
  });

  it("submits the chosen language and code, and shows only the hidden-test count", async () => {
    openBattle();
    const editor = await screen.findByLabelText("Code editor");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "cpp");
    await userEvent.clear(editor);
    await userEvent.type(editor, "int main() {{}");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Wrong answer · hidden tests: 3 of 5 passed",
    );
    expect(services.api.submit).toHaveBeenCalledWith(BATTLE_ID, "cpp", "int main() {}");
    // Progress is refetched from the server after a submit.
    await waitFor(() => expect(services.api.getBattle.mock.calls.length).toBeGreaterThan(1));
  });

  it("shows compiler output", async () => {
    services.api.submit.mockResolvedValue({
      submissionId: "s",
      verdict: "compile_error",
      passed: 0,
      total: 5,
      compileOutput: "line 3: expected ';'",
      battleFinished: false,
    });
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("status")).toHaveTextContent("line 3: expected ';'");
  });

  it("shows the server's message for a cooldown or judge outage", async () => {
    services.api.submit.mockRejectedValue(
      new ApiError("COOLDOWN", "Wait 7 seconds before trying again.", 429, 6400),
    );
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait 7 seconds");
  });

  it("keeps code per language across a reload", async () => {
    const first = openBattle();
    const editor = await screen.findByLabelText("Code editor");
    await userEvent.clear(editor);
    await userEvent.type(editor, "print(42)");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "java");
    expect((screen.getByLabelText("Code editor") as HTMLTextAreaElement).value).toContain(
      "public class Main",
    );
    first.unmount();

    openBattle();
    await userEvent.selectOptions(await screen.findByLabelText("Language"), "python");
    expect(screen.getByLabelText("Code editor")).toHaveValue("print(42)");
  });

  it("updates the opponent's progress when a live event arrives", async () => {
    openBattle();
    await screen.findByRole("img", { name: "byte_rival has passed 0 of 5 hidden tests" });

    services.api.getBattle.mockResolvedValue(
      battleState({ players: [player(), player({ ...RIVAL, bestPassed: 4, attempts: 1 })] }),
    );
    act(() => services.watchers[0]!.onChange());
    expect(
      await screen.findByRole("img", { name: "byte_rival has passed 4 of 5 hidden tests" }),
    ).toBeInTheDocument();
  });

  it("shows whether the opponent is connected", async () => {
    openBattle();
    await screen.findByRole("timer");
    act(() => services.watchers[0]!.onPresence(["user-1", "user-2"]));
    expect(await screen.findByText(/· online/)).toBeInTheDocument();
    act(() => services.watchers[0]!.onPresence(["user-1"]));
    expect(await screen.findByText(/· offline/)).toBeInTheDocument();
  });

  it("asks the server to resolve the battle when time runs out", async () => {
    const ending = battleState();
    ending.battle.endsAt = iso(120);
    services.api.getBattle.mockResolvedValue(ending);
    services.api.finalize.mockImplementation(async () => {
      services.api.getBattle.mockResolvedValue(
        finishedState(
          { result: "draw", ratingAfter: 1200 },
          { result: "draw", ratingAfter: 1200 },
          { finishReason: "timeout_draw" },
        ),
      );
      return true;
    });
    openBattle();

    expect(await screen.findByRole("heading", { name: "Draw" })).toBeInTheDocument();
    expect(services.api.finalize).toHaveBeenCalledWith(BATTLE_ID);
    expect(screen.getByText("Time ran out with equal scores.")).toBeInTheDocument();
  });

  it("does not ask to resolve a battle that still has time left", async () => {
    openBattle();
    await screen.findByRole("timer");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(services.api.finalize).not.toHaveBeenCalled();
  });

  it("forfeits only after confirmation", async () => {
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Forfeit" }));
    expect(services.api.forfeit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep fighting" }));
    expect(services.api.forfeit).not.toHaveBeenCalled();

    services.api.forfeit.mockImplementation(async () => {
      services.api.getBattle.mockResolvedValue(
        finishedState(
          { result: "loss", ratingAfter: 1184 },
          { result: "win", ratingAfter: 1216 },
          { finishReason: "forfeit", winnerId: "user-2" },
        ),
      );
    });
    await userEvent.click(screen.getByRole("button", { name: "Forfeit" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, forfeit" }));

    expect(await screen.findByRole("heading", { name: "Defeat" })).toBeInTheDocument();
    expect(screen.getByText("You forfeited.")).toBeInTheDocument();
    expect(services.api.forfeit).toHaveBeenCalledWith(BATTLE_ID);
  });

  it("explains when the battle is not the player's or does not exist", async () => {
    services.api.getBattle.mockRejectedValue(new ApiError("NOT_PARTICIPANT", "x", 403));
    openBattle();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You are not a player in this battle.",
    );
    expect(screen.getByRole("link", { name: "Back to the arena" })).toBeInTheDocument();
  });
});

describe("result screen", () => {
  const won = () =>
    finishedState(
      { result: "win", ratingAfter: 1216, bestPassed: 5, attempts: 2, language: "python" },
      { result: "loss", ratingAfter: 1184, bestPassed: 4, attempts: 3, language: "cpp" },
      { finishReason: "solved", winnerId: "user-1" },
    );

  it("shows victory, the reason and both rating changes", async () => {
    services.api.getBattle.mockResolvedValue(won());
    open(`/battle/${BATTLE_ID}`);

    expect(await screen.findByRole("heading", { name: "Victory" })).toBeInTheDocument();
    expect(screen.getByText("You passed every hidden test first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating 1200 to 1216, change plus 16")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating 1200 to 1184, change minus 16")).toBeInTheDocument();
    expect(screen.getByText("Python 3 · 2 attempts · 5 of 5 hidden tests")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Battle again" })).toHaveAttribute("href", "/arena");
    expect(screen.queryByLabelText("Code editor")).not.toBeInTheDocument();
  });

  it("shows defeat when the opponent solves it first", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "loss", ratingAfter: 1184 },
        { result: "win", ratingAfter: 1216 },
        { finishReason: "solved", winnerId: "user-2" },
      ),
    );
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByRole("heading", { name: "Defeat" })).toBeInTheDocument();
    expect(screen.getByText("byte_rival passed every hidden test first.")).toBeInTheDocument();
  });

  it("lets the player read both final solutions", async () => {
    services.api.getBattle.mockResolvedValue(won());
    services.solutions = [
      {
        userId: "user-1",
        language: "python",
        sourceCode: "print('mine')",
        verdict: "accepted",
        passed: 5,
        total: 5,
      },
      {
        userId: "user-2",
        language: "cpp",
        sourceCode: "// theirs",
        verdict: "wrong_answer",
        passed: 4,
        total: 5,
      },
    ];
    open(`/battle/${BATTLE_ID}`);

    expect(await screen.findByText("print('mine')")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "byte_rival's solution" }));
    expect(screen.getByText("// theirs")).toBeInTheDocument();
  });

  it("says so when a player never submitted", async () => {
    services.api.getBattle.mockResolvedValue(won());
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByText("You did not submit a solution.")).toBeInTheDocument();
  });

  it("refreshes the rating shown in the navigation", async () => {
    services.api.getBattle.mockResolvedValue(won());
    const auth = createFakeAuth(TEST_USER);
    renderWithApp(auth, services, `/battle/${BATTLE_ID}`);
    await screen.findByRole("heading", { name: "Victory" });
    await waitFor(() => expect(auth.getProfile).toHaveBeenCalledTimes(2));
  });
});
