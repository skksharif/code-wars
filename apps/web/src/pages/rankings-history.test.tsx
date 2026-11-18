// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  avatar: "vector",
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
  opponentAvatar: "pixel",
  isRated: true,
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

  it("is linked from the bottom bar for players and the landing page for visitors", async () => {
    const first = renderWithApp(createFakeAuth(TEST_USER), services, "/arena");
    const tabs = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(tabs).getByRole("link", { name: "Rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
    first.unmount();

    renderWithApp(createFakeAuth(), services, "/");
    expect(await screen.findByRole("link", { name: "See the rankings" })).toHaveAttribute(
      "href",
      "/rankings",
    );
  });
});

describe("blitz rankings", () => {
  it("switches between Ranked and Blitz rankings", async () => {
    services.leaderboard = LEADERBOARD;
    renderWithApp(createFakeAuth(), services, "/rankings");
    const blitz = await screen.findByRole("tab", { name: "⚡ Blitz" });
    expect(screen.getByRole("tab", { name: "Ranked" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(blitz);
    expect(blitz).toHaveAttribute("aria-selected", "true");
    await screen.findByRole("list", { name: "Top three" });
    expect(services.leaderboardModes).toEqual(["standard", "blitz"]);
  });
});

describe("history", () => {
  it("has no tab of its own in the menu", async () => {
    renderWithApp(createFakeAuth(TEST_USER), services, "/arena");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await within(nav).findByRole("link", { name: /Your profile/ });
    expect(within(nav).queryByRole("link", { name: "History" })).not.toBeInTheDocument();
  });

  it("sends old /history links to your profile, where the history now lives", async () => {
    services.profiles = {
      me: {
        username: "coder_42",
        avatar: "vector",
        rating: 1216,
        rank: 4,
        memberSince: "2026-11-01T00:00:00Z",
        wins: 1,
        losses: 0,
        draws: 0,
        peakRating: 1216,
        streak: { result: "win", count: 1 },
        ratingHistory: [1200, 1216],
        languages: { python: 1 },
        winsByDifficulty: { easy: 1, medium: 0, hard: 0 },
        recentBattles: [],
      },
    };
    services.history = [battle({})];
    renderWithApp(createFakeAuth(TEST_USER), services, "/history");
    expect(
      await screen.findByRole("article", { name: "Player card for coder_42" }),
    ).toBeInTheDocument();
    const history = await screen.findByRole("region", { name: "Battle history" });
    expect(await within(history).findByRole("link", { name: "view battle" })).toHaveAttribute(
      "href",
      "/battle/b-1",
    );
  });

  it("still requires sign-in", async () => {
    renderWithApp(createFakeAuth(), services, "/history");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });
});
