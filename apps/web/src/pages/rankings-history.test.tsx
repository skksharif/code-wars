// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryEntry, LeaderboardEntry } from "../lib/live";
import { createFakeAuth, TEST_USER } from "../test/fakeAuth";
import { createFakeServices, renderWithApp, type FakeServices } from "../test/fakeServices";

let services: FakeServices;
beforeEach(() => {
  services = createFakeServices();
});
afterEach(cleanup);

const entry = (rank: number, id: string, username: string, rating: number): LeaderboardEntry => ({
  id,
  username,
  rating,
  wins: rank,
  losses: 1,
  draws: 0,
  rank,
});

const LEADERBOARD = [
  entry(1, "u-a", "stack_sage", 1248),
  entry(2, "u-b", "loop_knight", 1230),
  entry(3, "u-c", "byte_rival", 1220),
  entry(4, "user-1", "coder_42", 1216),
  entry(5, "u-e", "null_ptr", 1168),
];

const battle = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  battleId: "b-1",
  result: "win",
  ratingBefore: 1200,
  ratingAfter: 1216,
  language: "python",
  bestPassed: 5,
  finishedAt: "2026-11-14T10:00:00Z",
  problemTitle: "Count the Peaks",
  opponent: "byte_rival",
  ...overrides,
});

describe("rankings", () => {
  it("is open to visitors and shows the podium and the table", async () => {
    services.leaderboard = LEADERBOARD;
    renderWithApp(createFakeAuth(), services, "/rankings");

    const podium = await screen.findByRole("list", { name: "Top three" });
    const cards = within(podium).getAllByRole("listitem");
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining("#1stack_sage1248"),
      expect.stringContaining("#2loop_knight1230"),
      expect.stringContaining("#3byte_rival1220"),
    ]);

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("4coder_4212164 / 1 / 0");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("highlights the signed-in player", async () => {
    services.leaderboard = LEADERBOARD;
    renderWithApp(createFakeAuth(TEST_USER), services, "/rankings");
    const row = (await screen.findByText("(you)")).closest("tr")!;
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveTextContent("coder_42");
  });

  it("marks the player on the podium too", async () => {
    services.leaderboard = [entry(1, "user-1", "coder_42", 1300), entry(2, "u-b", "other", 1200)];
    renderWithApp(createFakeAuth(TEST_USER), services, "/rankings");
    const podium = await screen.findByRole("list", { name: "Top three" });
    expect(within(podium).getAllByRole("listitem")[0]).toHaveTextContent("#1YOUcoder_42");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("handles an empty leaderboard and a failed load", async () => {
    const first = renderWithApp(createFakeAuth(), services, "/rankings");
    expect(await screen.findByText(/No players yet/)).toBeInTheDocument();
    first.unmount();

    services.leaderboard = new Error("down");
    renderWithApp(createFakeAuth(), services, "/rankings");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the rankings");
  });

  it("is linked from the navigation for everyone", async () => {
    renderWithApp(createFakeAuth(), services, "/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
    expect(within(nav).queryByRole("link", { name: "History" })).not.toBeInTheDocument();
  });
});

describe("history", () => {
  it("requires sign-in", async () => {
    renderWithApp(createFakeAuth(), services, "/history");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });

  it("lists finished battles, newest first, linking to each result", async () => {
    services.history = [
      battle({
        battleId: "b-2",
        result: "loss",
        ratingBefore: 1216,
        ratingAfter: 1201,
        language: "cpp",
        opponent: "stack_sage",
        problemTitle: "Grid Escape",
        finishedAt: "2026-11-15T10:00:00Z",
      }),
      battle({}),
    ];
    renderWithApp(createFakeAuth(TEST_USER), services, "/history");

    const links = await screen.findAllByRole("link", { name: /vs / });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/battle/b-2");
    expect(links[0]).toHaveTextContent("Loss vs stack_sage−15");
    expect(links[0]).toHaveTextContent("Grid Escape · C++ (GCC 14)");
    expect(links[1]).toHaveTextContent("Win vs byte_rival+16");
    expect(links[1]).toHaveTextContent("Count the Peaks · Python 3.12");
  });

  it("shows the profile and a rating history chart", async () => {
    services.history = [
      battle({ battleId: "b-2", result: "loss", ratingBefore: 1216, ratingAfter: 1201 }),
      battle({}),
    ];
    renderWithApp(createFakeAuth(TEST_USER), services, "/history");
    expect(
      await screen.findByRole("img", {
        name: "Rating history from 1200 to 1201, lowest 1200, highest 1216",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 wins · 0 losses · 0 draws")).toBeInTheDocument();
  });

  it("handles no battles and a failed load", async () => {
    const first = renderWithApp(createFakeAuth(TEST_USER), services, "/history");
    expect(await screen.findByText(/No battles yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find your first one" })).toHaveAttribute(
      "href",
      "/arena",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    first.unmount();

    services.history = new Error("down");
    renderWithApp(createFakeAuth(TEST_USER), services, "/history");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your battles");
  });
});
