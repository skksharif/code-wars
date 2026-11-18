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
    // Enabled once the check for a battle in progress has come back.
    await waitFor(() => expect(screen.getByRole("button", { name: "Find Battle" })).toBeEnabled());
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

describe("players online", () => {
  const announce = (count: number) =>
    act(() => {
      for (const member of services.lobby) {
        member.onMembers(Array.from({ length: count }, (_, i) => `user-${i + 1}`));
      }
    });

  it("joins the lobby when signed in and shows the count in the arena", async () => {
    open("/arena");
    await waitFor(() => expect(services.lobby.map((m) => m.userId)).toEqual(["user-1"]));
    // Hidden until the first count arrives.
    expect(screen.queryByText(/online/)).not.toBeInTheDocument();

    announce(3);
    expect(await screen.findByLabelText("3 players online")).toBeInTheDocument();
    announce(1);
    expect(await screen.findByLabelText("1 player online")).toBeInTheDocument();
  });

  it("stays in the lobby during a battle", async () => {
    open(`/battle/${BATTLE_ID}`);
    await screen.findByRole("timer");
    expect(services.lobby).toHaveLength(1);
  });

  it("does not join for visitors", async () => {
    renderWithApp(createFakeAuth(), services, "/rankings");
    await screen.findByRole("heading", { name: "Global rankings" });
    expect(services.lobby).toHaveLength(0);
  });

  it("shows the count on phones too", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: query === "(max-width: 767px)", media: query }) as MediaQueryList,
    );
    try {
      open("/arena");
      await screen.findByRole("region", { name: "Your rating" });
      await waitFor(() => expect(services.lobby).toHaveLength(1));
      announce(5);
      expect(await screen.findByLabelText("5 players online")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("lobby on phones", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: query === "(max-width: 767px)", media: query }) as MediaQueryList,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a rating strip with tier progress and one big button", async () => {
    open("/arena");
    const strip = await screen.findByRole("region", { name: "Your rating" });
    expect(within(strip).getByRole("heading", { name: "coder_42" })).toBeInTheDocument();
    expect(within(strip).getByLabelText("Rating 1216")).toBeInTheDocument();
    expect(strip).toHaveTextContent("Silver");
    expect(strip).toHaveTextContent("84 to Gold");
    // 1216 is 116 of the 200 points from Silver (1100) to Gold (1300).
    expect(within(strip).getByRole("progressbar", { name: "Progress to Gold" })).toHaveAttribute(
      "aria-valuenow",
      "58",
    );
    // Only the phone layout is shown: no VS cards.
    expect(screen.queryByText("? ? ?")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Find Battle" })).toBeEnabled());
    expect(screen.getByText(/Opponent within ± 100 rating/)).toBeInTheDocument();
  });

  it("turns the button into a search timer with Cancel", async () => {
    services.api.joinMatchmaking.mockResolvedValue({ status: "queued", waitedMs: 0 });
    open("/arena");
    const find = await screen.findByRole("button", { name: "Find Battle" });
    await waitFor(() => expect(find).toBeEnabled());
    await userEvent.click(find);

    expect(
      await screen.findByRole("status", { name: /Searching for an opponent, 00:0\d/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Searching rating 1116 to 1316")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(services.api.cancelMatchmaking).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Find Battle" })).toBeInTheDocument();
  });

  it("enters the battle when matched", async () => {
    services.api.joinMatchmaking.mockResolvedValue({ status: "matched", battleId: BATTLE_ID });
    open("/arena");
    const find = await screen.findByRole("button", { name: "Find Battle" });
    await waitFor(() => expect(find).toBeEnabled());
    await userEvent.click(find);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
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
    expect(screen.getByText(/C\+\+ \(GCC 14\) · 2 tries/)).toBeInTheDocument();
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
    // Long enough that a slow test run still sees the countdown before the start.
    waiting.battle.startsAt = iso(2000);
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

  it("counts down and disables Submit during the 10 s cooldown, separately from Run", async () => {
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));

    const waiting = await screen.findByRole("button", { name: /^Submit \((10|9)s\)$/ });
    expect(waiting).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run samples" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Run samples" }));
    expect(await screen.findByRole("button", { name: /^Run samples \([45]s\)$/ })).toBeDisabled();
  });

  it("uses the server's retry time when it reports a cooldown", async () => {
    services.api.submit.mockRejectedValue(
      new ApiError("COOLDOWN", "Wait 7 seconds before trying again.", 429, 6400),
    );
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("button", { name: /^Submit \([67]s\)$/ })).toBeDisabled();
  });

  it("re-enables Submit when the cooldown ends", async () => {
    services.api.submit.mockRejectedValue(
      new ApiError("COOLDOWN", "Wait 2 seconds before trying again.", 429, 2000),
    );
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("button", { name: /^Submit \([12]s\)$/ })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("starts no cooldown when the judge is unavailable, so the player can retry at once", async () => {
    services.api.submit.mockRejectedValue(
      new ApiError("JUDGE_UNAVAILABLE", "The code judge is unavailable.", 502),
    );
    openBattle();
    await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
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
    expect(screen.getByText("Python 3.12 · 2 attempts · 5 of 5 hidden tests")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find new battle" })).toHaveAttribute("href", "/arena");
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

  it("roasts both players from the battle's stats", async () => {
    services.api.getBattle.mockResolvedValue(won());
    open(`/battle/${BATTLE_ID}`);
    const roasts = await screen.findByRole("region", { name: "Battle roasts" });
    expect(roasts).toHaveTextContent("So close");
    expect(roasts).toHaveTextContent("4 of 5 tests. One away.");
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

describe("battle room on phones", () => {
  const openBattle = () => open(`/battle/${BATTLE_ID}`);

  it("switches between the problem and the code with tabs", async () => {
    openBattle();
    const problem = await screen.findByRole("region", { name: "Problem" });
    const editor = await screen.findByRole("region", { name: "Editor" });
    const problemTab = screen.getByRole("tab", { name: "Problem" });
    const codeTab = screen.getByRole("tab", { name: "Code" });
    // Small screens show one pane at a time; wide screens (lg) show both.
    expect(problemTab).toHaveAttribute("aria-selected", "true");
    expect(problem.parentElement).not.toHaveClass("hidden");
    expect(editor.parentElement).toHaveClass("hidden", "lg:flex");

    await userEvent.click(codeTab);
    expect(codeTab).toHaveAttribute("aria-selected", "true");
    expect(problem.parentElement).toHaveClass("hidden", "lg:block");
    expect(editor.parentElement).not.toHaveClass("hidden");

    await userEvent.click(problemTab);
    await userEvent.click(screen.getByRole("button", { name: "Start coding" }));
    expect(codeTab).toHaveAttribute("aria-selected", "true");
    // The bottom tab bar steps aside so the battle gets the whole screen.
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });

  it("keeps code typed in the code tab when switching to the problem and back", async () => {
    openBattle();
    await userEvent.click(await screen.findByRole("tab", { name: "Code" }));
    const editor = await screen.findByLabelText("Code editor");
    await userEvent.clear(editor);
    await userEvent.type(editor, "print(1)");
    await userEvent.click(screen.getByRole("tab", { name: "Problem" }));
    await userEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.getByLabelText("Code editor")).toHaveValue("print(1)");
  });

  describe("on a touch screen", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        (query: string) =>
          ({ matches: query === "(pointer: coarse)", media: query }) as MediaQueryList,
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("uses the plain code box, with autocorrect off and indentation kept", async () => {
      openBattle();
      const editor = (await screen.findByLabelText("Code editor")) as HTMLTextAreaElement;
      // The plain box, not the desktop editor.
      expect(editor).toHaveAttribute("autocapitalize", "off");
      expect(editor).toHaveAttribute("autocorrect", "off");
      expect(editor).toHaveAttribute("spellcheck", "false");

      await userEvent.clear(editor);
      await userEvent.type(editor, "for x in y:{Enter}print(x)");
      expect(editor).toHaveValue("for x in y:\n    print(x)");
    });
  });
});

describe("overtime", () => {
  const openBattle = () => open(`/battle/${BATTLE_ID}`);
  // The rival solved it 7:42 into the battle; you have overtime left.
  const startsAt = iso(-500_000);
  const overtimeFor = (
    you: Partial<Parameters<typeof player>[0]>,
    rival: Partial<Parameters<typeof player>[0]>,
    battle: Partial<ReturnType<typeof battleState>["battle"]> = {},
  ) => {
    const base = battleState();
    return {
      ...base,
      battle: {
        ...base.battle,
        startsAt,
        endsAt: iso(400_000),
        winnerId: RIVAL.userId,
        firstSolvedAt: new Date(Date.parse(startsAt) + 462_000).toISOString(),
        overtimeEndsAt: iso(100_000),
        overtimeFullDelta: -16,
        ...battle,
      },
      players: [player({ bestPassed: 3, ...you }), player({ ...RIVAL, ...rival })],
    };
  };

  it("offers the player who has not solved it overtime, without blocking the editor", async () => {
    services.api.getBattle.mockResolvedValue(
      overtimeFor({}, { result: "win", ratingAfter: 1216, bestPassed: 5 }),
    );
    openBattle();
    const offer = await screen.findByRole("region", { name: /byte_rival solved it in 07:42/ });
    expect(offer).toHaveTextContent("You've passed 3 of 5 tests.");
    expect(offer).toHaveTextContent(/Overtime: 01:(3|4)\d left\./);
    expect(offer).toHaveTextContent("Solve it to halve your rating loss: −8 instead of −16.");
    expect(screen.getByRole("timer")).toHaveAccessibleName(/^Overtime 01:/);
    // The editor stays usable while the offer is shown.
    expect(await screen.findByLabelText("Code editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();

    await userEvent.click(within(offer).getByRole("button", { name: "Keep coding" }));
    expect(screen.queryByRole("region", { name: /solved it in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/OVERTIME|Overtime/);
  });

  it("gives up straight from the offer", async () => {
    services.api.getBattle.mockResolvedValue(overtimeFor({}, { result: "win", ratingAfter: 1216 }));
    openBattle();
    const offer = await screen.findByRole("region", { name: /solved it in/ });
    await userEvent.click(within(offer).getByRole("button", { name: "Give up" }));
    expect(services.api.forfeit).toHaveBeenCalledWith(BATTLE_ID);
  });

  it("in a custom match there is no rating at stake", async () => {
    services.api.getBattle.mockResolvedValue(
      overtimeFor({}, { result: "win" }, { isRated: false, overtimeFullDelta: 0 }),
    );
    openBattle();
    expect(await screen.findByRole("region", { name: /solved it in/ })).toHaveTextContent(
      "No rating at stake: finish it for bragging rights.",
    );
  });

  it("the winner sees the victory at once, with the opponent's overtime running", async () => {
    services.api.getBattle.mockResolvedValue({
      ...overtimeFor({}, {}),
      players: [
        player({ result: "win", ratingAfter: 1216, bestPassed: 5 }),
        player({ ...RIVAL, bestPassed: 2 }),
      ],
      battle: { ...overtimeFor({}, {}).battle, winnerId: "user-1" },
    });
    openBattle();
    expect(await screen.findByRole("heading", { name: "Victory" })).toBeInTheDocument();
    expect(screen.getByText("You passed every hidden test first.")).toBeInTheDocument();
    const banner = screen.getByText(/has 01:\d\d left/).closest("p")!;
    expect(banner).toHaveTextContent("If they solve it, their loss is halved.");
    expect(banner).toHaveTextContent("Your win is safe.");
    expect(screen.getByText("In overtime")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating 1200 to 1216, change plus 16")).toBeInTheDocument();
    // Rematch waits for the overtime; a new battle can be found straight away.
    expect(screen.getByText("Rematch opens when the overtime ends.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find new battle" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Code editor")).not.toBeInTheDocument();
  });

  it("explains a halved loss after an overtime solve", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "loss", ratingAfter: 1192, solvedInOvertime: true, bestPassed: 5 },
        { result: "win", ratingAfter: 1216, bestPassed: 5 },
        { finishReason: "solved", overtimeOutcome: "solved", winnerId: RIVAL.userId },
      ),
    );
    openBattle();
    expect(await screen.findByRole("heading", { name: "Defeat" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "byte_rival passed every hidden test first. You solved it in overtime: your rating loss was halved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Defeated · solved in overtime · you")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating 1200 to 1192, change minus 8")).toBeInTheDocument();
  });

  it("tells the winner how the overtime ended", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "win", ratingAfter: 1216 },
        { result: "loss", ratingAfter: 1184 },
        { finishReason: "solved", overtimeOutcome: "gave_up", winnerId: "user-1" },
      ),
    );
    openBattle();
    expect(
      await screen.findByText(
        "You passed every hidden test first. byte_rival gave up in overtime.",
      ),
    ).toBeInTheDocument();
  });
});

describe("half of a loss", () => {
  it("rounds in the player's favour, like the server", async () => {
    const { halfLoss } = await import("../battle/OvertimeOffer");
    expect(halfLoss(-16)).toBe(-8);
    expect(halfLoss(-19)).toBe(-9);
    expect(halfLoss(-1)).toBe(-0);
    expect(halfLoss(0)).toBe(0);
  });
});

describe("quick emotes", () => {
  const openBattle = () => open(`/battle/${BATTLE_ID}`);
  afterEach(() => vi.useRealTimers());

  it("sends an emote from the tray and shows it over your name", async () => {
    openBattle();
    await screen.findByRole("timer");
    await userEvent.click(screen.getByRole("button", { name: "Emotes" }));
    const tray = screen.getByRole("group", { name: "Quick emotes" });
    // One list: friendly, taunts and emojis together.
    for (const name of ["GG", "Too slow 🐢", "Hello World is your peak", "🤡", "🫵😂"]) {
      expect(within(tray).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(tray).getAllByRole("button")).toHaveLength(43 + 1); // + Mute
    await userEvent.click(within(tray).getByRole("button", { name: "Too slow 🐢" }));

    expect(services.sentEmotes).toEqual(["too-slow"]);
    expect(screen.queryByRole("group", { name: "Quick emotes" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("You: Too slow 🐢");

    // One every 5 seconds: the tray's choices wait.
    await userEvent.click(screen.getByRole("button", { name: "Emotes" }));
    expect(screen.getByRole("button", { name: "GG" })).toBeDisabled();
    expect(screen.getByText("Wait a moment…")).toBeInTheDocument();
  });

  it("shows the opponent's emote, ignores anything not on the list, and can mute", async () => {
    openBattle();
    await screen.findByRole("timer");
    act(() => services.watchers[0]!.onEmote?.("<b>free text</b>"));
    expect(screen.queryByText(/free text/)).not.toBeInTheDocument();

    act(() => services.watchers[0]!.onEmote?.("skill-issue"));
    expect(await screen.findByText("Skill issue")).toBeInTheDocument();
    expect(screen.getByText("Skill issue").closest("[role=status]")).toHaveTextContent(
      "byte_rival: Skill issue",
    );

    await userEvent.click(screen.getByRole("button", { name: "Emotes" }));
    await userEvent.click(screen.getByRole("button", { name: "Mute byte_rival" }));
    expect(screen.queryByText(/byte_rival:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unmute byte_rival" })).toBeInTheDocument();
  });

  it("drops emotes that arrive faster than the limit, and hides bubbles after 3 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openBattle();
    await screen.findByRole("timer");
    act(() => services.watchers[0]!.onEmote?.("bot"));
    act(() => services.watchers[0]!.onEmote?.("clown"));
    expect(screen.getByText("Bot.")).toBeInTheDocument();
    expect(screen.queryByText("Clown 🤡")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3100));
    expect(screen.queryByText("Bot.")).not.toBeInTheDocument();
  });

  it("sends the first 8 with Alt + 1…8", async () => {
    openBattle();
    await screen.findByRole("timer");
    await userEvent.keyboard("{Alt>}3{/Alt}");
    expect(services.sentEmotes).toEqual(["nice"]);
    expect(screen.getByText("Nice!")).toBeInTheDocument();
  });

  it("offers quick picks on the result screen", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "win", ratingAfter: 1216 },
        { result: "loss", ratingAfter: 1184 },
        {
          finishReason: "solved",
          winnerId: "user-1",
        },
      ),
    );
    openBattle();
    const say = await screen.findByRole("region", { name: "Say something" });
    await userEvent.click(within(say).getByRole("button", { name: "GG EZ 😏" }));
    expect(services.sentEmotes).toEqual(["gg-ez"]);

    act(() => services.watchers[0]!.onEmote?.("lucky"));
    expect(await screen.findByText("Lucky problem 🧂")).toBeInTheDocument();
  });
});

describe("blitz", () => {
  it("has its own tab with the Blitz rating, and searches the Blitz queue", async () => {
    open("/arena?mode=blitz");
    expect(await screen.findByRole("tab", { name: "Blitz" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("1188")).toBeInTheDocument();
    expect(screen.getByText("3 W · 1 L · 0 D")).toBeInTheDocument();
    expect(screen.getByText("Blitz · Easy · 5 minutes")).toBeInTheDocument();
    const find = screen.getByRole("button", { name: /Find Blitz/ });
    await waitFor(() => expect(find).toBeEnabled());
    await userEvent.click(find);
    await waitFor(() => expect(services.api.joinMatchmaking).toHaveBeenCalledWith("blitz"));
  });

  it("Ranked still searches the Ranked queue", async () => {
    open("/arena");
    const find = await screen.findByRole("button", { name: "Find Battle" });
    await waitFor(() => expect(find).toBeEnabled());
    await userEvent.click(find);
    await waitFor(() => expect(services.api.joinMatchmaking).toHaveBeenCalledWith("standard"));
  });

  it("marks a Blitz battle on the clock", async () => {
    const state = battleState();
    state.battle.mode = "blitz";
    services.api.getBattle.mockResolvedValue(state);
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByText("Blitz ·")).toBeInTheDocument();
  });

  it("shows Blitz rating changes and offers the next Blitz", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "win", ratingBefore: 1188, ratingAfter: 1204, bestPassed: 5, attempts: 2 },
        { result: "loss", ratingBefore: 1210, ratingAfter: 1194 },
        { finishReason: "solved", winnerId: "user-1", mode: "blitz" },
      ),
    );
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByText("Blitz · battle over")).toBeInTheDocument();
    expect(screen.getByLabelText("Blitz rating 1188 to 1204, change plus 16")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next Blitz" })).toHaveAttribute(
      "href",
      "/arena?mode=blitz",
    );
  });
});
