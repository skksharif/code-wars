// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import type { PublicProfile } from "../lib/live";
import { nextTier, tierFor } from "../lib/tiers";
import { createFakeAuth, TEST_USER } from "../test/fakeAuth";
import { createFakeServices, renderWithApp, type FakeServices } from "../test/fakeServices";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const SHARIF: PublicProfile = {
  username: "sharif",
  avatar: "kernel",
  rating: 1342,
  rank: 7,
  memberSince: "2026-11-01T00:00:00Z",
  wins: 15,
  losses: 8,
  draws: 1,
  peakRating: 1388,
  streak: { result: "win", count: 3 },
  ratingHistory: [1200, 1216, 1202, 1388, 1342],
  languages: { python: 7, cpp: 3 },
  winsByDifficulty: { easy: 9, medium: 5, hard: 1 },
  recentBattles: [
    {
      battleId: "b-1",
      result: "win",
      ratingBefore: 1326,
      ratingAfter: 1342,
      opponent: "byte_rival",
      opponentAvatar: "pixel",
      finishedAt: hoursAgo(2),
    },
    {
      battleId: "b-2",
      result: "loss",
      ratingBefore: 1340,
      ratingAfter: 1326,
      opponent: "stack_sage",
      opponentAvatar: "echo",
      finishedAt: hoursAgo(30),
    },
  ],
};

const NEWCOMER: PublicProfile = {
  ...SHARIF,
  username: "newbie",
  rating: 1200,
  rank: 40,
  wins: 0,
  losses: 0,
  draws: 0,
  peakRating: 1200,
  streak: null,
  ratingHistory: [],
  languages: {},
  winsByDifficulty: { easy: 0, medium: 0, hard: 0 },
  recentBattles: [],
};

let services: FakeServices;
beforeEach(() => {
  services = createFakeServices();
  services.profiles = { sharif: SHARIF, newbie: NEWCOMER };
});
afterEach(cleanup);

describe("rank tiers", () => {
  it("maps ratings to tiers at the agreed boundaries", () => {
    expect(tierFor(900).name).toBe("Bronze");
    expect(tierFor(1099).name).toBe("Bronze");
    expect(tierFor(1100).name).toBe("Silver");
    expect(tierFor(1299).name).toBe("Silver");
    expect(tierFor(1300).name).toBe("Gold");
    expect(tierFor(1500).name).toBe("Platinum");
    expect(tierFor(1700).name).toBe("Diamond");
    expect(tierFor(2400).name).toBe("Diamond");
  });

  it("says how far the next tier is", () => {
    expect(nextTier(1342)).toMatchObject({ tier: { name: "Platinum" }, pointsNeeded: 158 });
    expect(nextTier(1200)).toMatchObject({ tier: { name: "Gold" }, pointsNeeded: 100 });
    expect(nextTier(1750)).toBeNull();
  });
});

describe("profile page", () => {
  it("is open to visitors and shows the player card", async () => {
    renderWithApp(createFakeAuth(), services, "/u/sharif");
    const card = await screen.findByRole("article", { name: "Player card for sharif" });
    expect(within(card).getByRole("heading", { name: "sharif" })).toBeInTheDocument();
    expect(card).toHaveTextContent("#7 GLOBAL");
    expect(card).toHaveTextContent("Gold");
    expect(within(card).getByLabelText("Rating 1342")).toBeInTheDocument();
    expect(card).toHaveTextContent("Peak 1388 · 158 to Platinum");
    expect(card).toHaveTextContent("15WINS8LOSSES1DRAWS");
  });

  it("shows stats, chart, languages and difficulty", async () => {
    renderWithApp(createFakeAuth(), services, "/u/sharif");
    await screen.findByRole("article");
    expect(screen.getByText("Battles").nextSibling).toHaveTextContent("24");
    expect(screen.getByText("Win rate").nextSibling).toHaveTextContent("63%");
    expect(screen.getByText("Streak").nextSibling).toHaveTextContent("3 W");
    expect(screen.getByText("Main").nextSibling).toHaveTextContent("Python");
    expect(
      screen.getByRole("img", {
        name: "Rating from 1200 to 1342 over 4 battles; lowest 1200, highest 1388",
      }),
    ).toBeInTheDocument();
    const languages = screen.getByRole("region", { name: "Languages" });
    expect(languages).toHaveTextContent("Python 3.1270%");
    expect(languages).toHaveTextContent("C++ (GCC 14)30%");
    expect(screen.getByRole("region", { name: "Wins by difficulty" })).toHaveTextContent(
      "easy9medium5hard1",
    );
  });

  it("lists recent battles with links to opponents, without battle links for visitors", async () => {
    renderWithApp(createFakeAuth(), services, "/u/sharif");
    const recent = await screen.findByRole("region", { name: "Recent battles" });
    const rows = within(recent).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Win vs byte_rival");
    expect(rows[0]).toHaveTextContent("+16 · 2h ago");
    expect(rows[1]).toHaveTextContent("Loss vs stack_sage");
    expect(rows[1]).toHaveTextContent("−14 · 1d ago");
    expect(within(rows[0]!).getByRole("link", { name: "byte_rival" })).toHaveAttribute(
      "href",
      "/u/byte_rival",
    );
    expect(within(recent).queryByRole("link", { name: "view battle" })).not.toBeInTheDocument();
  });

  it("links each battle to its result on your own profile", async () => {
    services.profiles = { me: { ...SHARIF, username: "coder_42" } };
    renderWithApp(createFakeAuth(TEST_USER), services, "/u/coder_42");
    const recent = await screen.findByRole("region", { name: "Recent battles" });
    // The links appear once the signed-in user's own profile has loaded.
    expect(
      (await within(recent).findAllByRole("link", { name: "view battle" }))[0],
    ).toHaveAttribute("href", "/battle/b-1");
  });

  it("handles a player with no battles", async () => {
    renderWithApp(createFakeAuth(), services, "/u/newbie");
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent("Silver");
    expect(screen.getByText("Win rate").nextSibling).toHaveTextContent("–");
    expect(screen.getByText("The chart appears after the first battle.")).toBeInTheDocument();
    expect(screen.getAllByText("No battles yet.")).toHaveLength(2);
  });

  it("says when a player does not exist, or the profile cannot load", async () => {
    const first = renderWithApp(createFakeAuth(), services, "/u/ghost");
    expect(await screen.findByRole("heading", { name: "Player not found" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("There is no player called “ghost”.");
    first.unmount();

    services.profiles = new Error("down");
    renderWithApp(createFakeAuth(), services, "/u/sharif");
    expect(await screen.findByRole("heading", { name: "Profile unavailable" })).toBeInTheDocument();
  });

  it("is reachable from your name in the menu and from the rankings", async () => {
    services.profiles = { me: { ...SHARIF, username: "coder_42" } };
    services.leaderboard = [
      {
        id: "u-a",
        username: "sharif",
        avatar: "kernel",
        rating: 1342,
        wins: 15,
        losses: 8,
        draws: 1,
        rank: 1,
      },
    ];
    renderWithApp(createFakeAuth(TEST_USER), services, "/rankings");

    const podium = await screen.findByRole("list", { name: "Top three" });
    expect(within(podium).getByRole("link", { name: "sharif" })).toHaveAttribute(
      "href",
      "/u/sharif",
    );

    await userEvent.click(await screen.findByRole("link", { name: "Your profile, rating 1216" }));
    expect(
      await screen.findByRole("article", { name: "Player card for coder_42" }),
    ).toBeInTheDocument();
  });
});

describe("avatars", () => {
  it("shows the player's avatar on the card instead of a letter", async () => {
    renderWithApp(createFakeAuth(), services, "/u/sharif");
    const card = await screen.findByRole("article", { name: "Player card for sharif" });
    expect(
      within(card).getByRole("img", { name: "Kernel avatar: a beanie and a beard" }),
    ).toBeInTheDocument();
  });

  it("falls back to a default avatar for unknown values", async () => {
    services.profiles = { odd: { ...SHARIF, username: "odd", avatar: "dragon" } };
    renderWithApp(createFakeAuth(), services, "/u/odd");
    const card = await screen.findByRole("article");
    expect(within(card).getByRole("img", { name: /^Cipher avatar/ })).toBeInTheDocument();
  });

  it("offers no avatar picker on someone else's profile", async () => {
    renderWithApp(createFakeAuth(TEST_USER), services, "/u/sharif");
    await screen.findByRole("article");
    expect(screen.queryByRole("button", { name: "Change avatar" })).not.toBeInTheDocument();
  });

  it("lets players choose and save a new avatar on their own profile", async () => {
    services.profiles = { me: { ...SHARIF, username: "coder_42", avatar: "nova" } };
    const auth = createFakeAuth(TEST_USER);
    renderWithApp(auth, services, "/u/coder_42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Change avatar" }));
    const picker = screen.getByRole("region", { name: "Choose your avatar" });
    const options = within(picker).getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual([
      "Cipher",
      "Kernel",
      "Vector",
      "Nova",
      "Pixel",
      "Echo",
    ]);
    expect(within(picker).getByRole("radio", { name: "Nova" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(picker).getByRole("button", { name: "Save avatar" })).toBeDisabled();

    await user.click(within(picker).getByRole("radio", { name: "Echo" }));
    services.profiles = { me: { ...SHARIF, username: "coder_42", avatar: "echo" } };
    await user.click(within(picker).getByRole("button", { name: "Save avatar" }));

    expect(services.api.setAvatar).toHaveBeenCalledWith("echo");
    expect(await screen.findByRole("img", { name: /^Echo avatar/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Choose your avatar" })).not.toBeInTheDocument();
    expect(auth.getProfile).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the picker open if saving fails", async () => {
    services.profiles = { me: { ...SHARIF, username: "coder_42", avatar: "nova" } };
    services.api.setAvatar.mockRejectedValue(
      new ApiError("NETWORK", "Could not reach the server.", 0),
    );
    renderWithApp(createFakeAuth(TEST_USER), services, "/u/coder_42");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change avatar" }));
    await user.click(screen.getByRole("radio", { name: "Pixel" }));
    await user.click(screen.getByRole("button", { name: "Save avatar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(screen.getByRole("region", { name: "Choose your avatar" })).toBeInTheDocument();
  });
});
