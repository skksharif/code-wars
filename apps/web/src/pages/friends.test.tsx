// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Friend } from "../lib/api";
import { headToHeadText } from "../friends/format";
import { createFakeAuth, TEST_USER } from "../test/fakeAuth";
import {
  BATTLE_ID,
  challenge,
  createFakeServices,
  renderWithApp,
  type FakeServices,
} from "../test/fakeServices";

vi.mock("../battle/CodeEditor", () => ({
  default: () => <textarea aria-label="Code editor" />,
}));

let services: FakeServices;
beforeEach(() => {
  services = createFakeServices();
});
afterEach(cleanup);

const open = (path: string) => renderWithApp(createFakeAuth(TEST_USER), services, path);
const changed = () =>
  act(() => {
    for (const notify of services.notificationWatchers) notify();
  });
const online = (...ids: string[]) =>
  act(() => {
    for (const member of services.lobby) member.onMembers(["user-1", ...ids]);
  });

const friend = (overrides: Partial<Friend>): Friend => ({
  userId: "user-2",
  username: "byte_rival",
  avatar: "pixel",
  rating: 1180,
  friendsSince: "2026-11-15T10:00:00Z",
  inBattle: false,
  headToHead: { wins: 3, losses: 1, draws: 0 },
  ...overrides,
});

describe("head-to-head text", () => {
  it("reads naturally", () => {
    expect(headToHeadText({ wins: 0, losses: 0, draws: 0 })).toBe("Not played yet");
    expect(headToHeadText({ wins: 3, losses: 1, draws: 0 })).toBe("You 3 – 1");
    expect(headToHeadText({ wins: 2, losses: 2, draws: 1 })).toBe("You 2 – 2 (1 draw)");
  });
});

describe("the Friends page", () => {
  it("sends a friend request by username", async () => {
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "sharif");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(services.api.sendFriendRequest).toHaveBeenCalledWith("sharif");
    expect(await screen.findByText("Request sent to sharif.")).toBeInTheDocument();
  });

  it("explains a request that cannot be sent", async () => {
    services.api.sendFriendRequest.mockRejectedValue(
      new ApiError("PLAYER_NOT_FOUND", "No player with that username.", 404),
    );
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "ghost");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No player with that username.");
  });

  it("checks the username before asking the server", async () => {
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "a b");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3 to 20 letters");
    expect(services.api.sendFriendRequest).not.toHaveBeenCalled();
  });

  it("answers incoming requests", async () => {
    services.friendList = {
      friends: [],
      incoming: [
        { userId: "user-5", username: "new_pal", avatar: "echo", rating: 1300, sentAt: "x" },
      ],
      outgoing: [],
    };
    open("/friends");
    const requests = await screen.findByRole("region", { name: "Friend requests" });
    expect(requests).toHaveTextContent("new_pal");
    await userEvent.click(within(requests).getByRole("button", { name: "Accept" }));
    expect(services.api.respondFriendRequest).toHaveBeenCalledWith("user-5", true);
  });

  it("lists friends with status and head-to-head, and challenges online ones", async () => {
    services.friendList = {
      friends: [
        friend({}),
        friend({ userId: "user-3", username: "busy_bee", inBattle: true }),
        friend({
          userId: "user-4",
          username: "sleepy",
          headToHead: { wins: 0, losses: 0, draws: 0 },
        }),
      ],
      incoming: [],
      outgoing: [],
    };
    open("/friends");
    const list = await screen.findByRole("region", { name: "Your friends" });
    await waitFor(() => expect(services.lobby).toHaveLength(1));
    await online("user-2");
    const rows = within(list).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("byte_rival");
    expect(rows[0]).toHaveTextContent("1180 · Online · You 3 – 1");
    expect(rows[1]).toHaveTextContent("In a battle");
    expect(rows[2]).toHaveTextContent("Offline · Not played yet");

    expect(within(rows[1]!).getByRole("button", { name: "⚔ Challenge" })).toBeDisabled();
    expect(within(rows[2]!).getByRole("button", { name: "⚔ Challenge" })).toBeDisabled();

    await userEvent.click(within(rows[0]!).getByRole("button", { name: "⚔ Challenge" }));
    const form = within(rows[0]!).getByRole("group", { name: "Challenge byte_rival" });
    expect(form).toHaveTextContent("byte_rival has 30 seconds to accept.");
    await userEvent.click(within(form).getByRole("radio", { name: "Medium" }));
    await userEvent.click(within(form).getByRole("radio", { name: "10 min" }));
    await userEvent.click(within(form).getByRole("button", { name: "Send challenge" }));
    expect(services.api.sendChallenge).toHaveBeenCalledWith("user-2", "medium", 10);
  });

  it("shows why a challenge could not be sent", async () => {
    services.friendList = { friends: [friend({})], incoming: [], outgoing: [] };
    services.api.sendChallenge.mockRejectedValue(
      new ApiError(
        "FRIEND_BUSY",
        "Your friend is in a battle right now. Try again when they're done.",
        409,
      ),
    );
    open("/friends?challenge=user-2");
    const form = await screen.findByRole("group", { name: "Challenge byte_rival" });
    await userEvent.click(within(form).getByRole("button", { name: "Send challenge" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("is in a battle right now");
  });

  it("removes a friend after asking", async () => {
    services.friendList = { friends: [friend({})], incoming: [], outgoing: [] };
    open("/friends");
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove byte_rival from friends" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(services.api.removeFriend).toHaveBeenCalledWith("user-2");
  });

  it("is in the menus and needs sign-in", async () => {
    renderWithApp(createFakeAuth(), services, "/friends");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("username suggestions", () => {
  const found = [
    { userId: "user-5", username: "sharma", avatar: "echo", rating: 1300, status: "none" as const },
    {
      userId: "user-6",
      username: "shark_bite",
      avatar: "kernel",
      rating: 1250,
      status: "incoming" as const,
    },
    {
      userId: "user-7",
      username: "sharky",
      avatar: "pixel",
      rating: 1100,
      status: "outgoing" as const,
    },
    {
      userId: "user-8",
      username: "ashar",
      avatar: "vector",
      rating: 1400,
      status: "friends" as const,
    },
  ];

  it("appear after 3 letters, once typing pauses", async () => {
    services.api.searchPlayers.mockResolvedValue(found);
    open("/friends");
    const input = await screen.findByLabelText("Add a friend by username");
    await userEvent.type(input, "sh");
    expect(screen.getByText("Type 3 or more letters to see suggestions.")).toBeInTheDocument();
    expect(services.api.searchPlayers).not.toHaveBeenCalled();

    await userEvent.type(input, "a");
    const list = await screen.findByRole("list", { name: "Suggestions" });
    // One search for the pause, not one per key press.
    expect(services.api.searchPlayers).toHaveBeenCalledTimes(1);
    expect(services.api.searchPlayers).toHaveBeenCalledWith("sha");
    expect(screen.getByText("4 players found")).toBeInTheDocument();

    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("sharma1300");
    expect(within(rows[0]!).getByRole("link", { name: "sharma" })).toHaveAttribute(
      "href",
      "/u/sharma",
    );
    expect(within(rows[0]!).getByRole("button", { name: "Add sharma as a friend" })).toBeEnabled();
    expect(
      within(rows[1]!).getByRole("button", { name: "Accept shark_bite's request" }),
    ).toBeEnabled();
    expect(rows[2]).toHaveTextContent("Requested");
    expect(rows[3]).toHaveTextContent("✓ Friends");
  });

  it("adds a friend straight from a suggestion", async () => {
    services.api.searchPlayers.mockResolvedValue(found);
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "sha");
    await userEvent.click(await screen.findByRole("button", { name: "Add sharma as a friend" }));
    expect(services.api.sendFriendRequest).toHaveBeenCalledWith("sharma");
    expect(await screen.findByText("Request sent to sharma.")).toBeInTheDocument();
    // Searched again so the row now shows the new state.
    await waitFor(() => expect(services.api.searchPlayers).toHaveBeenCalledTimes(2));
  });

  it("accepts a request from a player who already asked", async () => {
    services.api.searchPlayers.mockResolvedValue(found);
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "sha");
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept shark_bite's request" }),
    );
    expect(services.api.respondFriendRequest).toHaveBeenCalledWith("user-6", true);
    expect(await screen.findByText("You and shark_bite are now friends.")).toBeInTheDocument();
  });

  it("says when nobody matches", async () => {
    open("/friends");
    await userEvent.type(await screen.findByLabelText("Add a friend by username"), "zzz");
    expect(await screen.findByText("No players match “zzz”.")).toBeInTheDocument();
  });
});

describe("the bell", () => {
  it("counts friend requests and leads to the Friends page", async () => {
    services.notifications = { ...services.notifications, friendRequests: 2 };
    open("/arena");
    const bell = await screen.findByRole("link", { name: "Friend requests, 2 new" });
    expect(bell).toHaveAttribute("href", "/friends");
    expect(bell).toHaveTextContent("2");
    // Answered elsewhere: a live update clears the badge.
    services.notifications = { ...services.notifications, friendRequests: 0 };
    await changed();
    expect(await screen.findByRole("link", { name: "Friend requests" })).not.toHaveTextContent("2");
  });
});

describe("challenge pop-ups", () => {
  const incoming = () =>
    challenge({
      isChallenger: false,
      difficulty: "easy",
      minutes: 10,
      challenger: { userId: "user-2", username: "byte_rival", avatar: "pixel", rating: 1180 },
      challenged: { userId: "user-1", username: "coder_42", avatar: "nova", rating: 1216 },
    });

  it("shows an incoming challenge on any page and accepting starts the battle", async () => {
    services.notifications = { ...services.notifications, incomingChallenges: [incoming()] };
    open("/rankings");
    const popup = await screen.findByRole("region", { name: "Challenge from byte_rival" });
    expect(popup).toHaveTextContent("byte_rival challenges you");
    expect(popup).toHaveTextContent(/Easy · 10 min · unrated · 00:(29|30) to answer/);
    await userEvent.click(within(popup).getByRole("button", { name: "Accept" }));
    expect(services.api.respondChallenge).toHaveBeenCalledWith(incoming().id, true);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("can be declined", async () => {
    services.notifications = { ...services.notifications, incomingChallenges: [incoming()] };
    open("/arena");
    const popup = await screen.findByRole("region", { name: "Challenge from byte_rival" });
    await userEvent.click(within(popup).getByRole("button", { name: "Decline" }));
    expect(services.api.respondChallenge).toHaveBeenCalledWith(incoming().id, false);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Challenge from byte_rival" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("says when the challenger is no longer free", async () => {
    services.notifications = { ...services.notifications, incomingChallenges: [incoming()] };
    services.api.respondChallenge.mockResolvedValue(
      challenge({ isChallenger: false, status: "cancelled", cancelReason: "challenger_busy" }),
    );
    open("/arena");
    const popup = await screen.findByRole("region", { name: "Challenge from byte_rival" });
    await userEvent.click(within(popup).getByRole("button", { name: "Accept" }));
    expect(await within(popup).findByRole("alert")).toHaveTextContent(
      "byte_rival started another battle.",
    );
  });

  it("tells the challenger they are waiting, and takes them in when accepted", async () => {
    services.notifications = { ...services.notifications, outgoingChallenge: challenge() };
    open("/friends");
    expect(await screen.findByText(/Waiting for/)).toHaveTextContent(
      /Waiting for byte_rival to accept… 00:(29|30)/,
    );
    services.notifications = {
      ...services.notifications,
      outgoingChallenge: challenge({ status: "accepted", battleId: BATTLE_ID }),
    };
    await changed();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("tells the challenger when the answer is no", async () => {
    services.notifications = {
      ...services.notifications,
      outgoingChallenge: challenge({ status: "declined" }),
    };
    open("/arena");
    expect(await screen.findByText("byte_rival declined your challenge.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText("byte_rival declined your challenge.")).not.toBeInTheDocument();
  });

  it("explains other endings", async () => {
    services.notifications = {
      ...services.notifications,
      outgoingChallenge: challenge({ status: "cancelled", cancelReason: "challenged_busy" }),
    };
    const first = open("/arena");
    expect(await screen.findByText("byte_rival started another battle.")).toBeInTheDocument();
    first.unmount();

    services.notifications = {
      ...services.notifications,
      outgoingChallenge: challenge({ status: "expired" }),
    };
    open("/arena");
    expect(await screen.findByText("No answer from byte_rival.")).toBeInTheDocument();
  });

  it("lets the challenger withdraw", async () => {
    services.notifications = { ...services.notifications, outgoingChallenge: challenge() };
    open("/arena");
    await screen.findByText(/Waiting for/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(services.api.cancelChallenge).toHaveBeenCalledWith(challenge().id);
  });
});

describe("friendship on a profile", () => {
  const profile = {
    username: "byte_rival",
    avatar: "pixel",
    rating: 1180,
    rank: 2,
    memberSince: "2026-11-01T00:00:00Z",
    wins: 1,
    losses: 3,
    draws: 0,
    peakRating: 1200,
    streak: null,
    ratingHistory: [],
    languages: {},
    winsByDifficulty: { easy: 0, medium: 0, hard: 0 },
    recentBattles: [],
  };

  it("adds a friend from their profile", async () => {
    services.profiles = { rival: profile };
    open("/u/byte_rival");
    const box = await screen.findByRole("region", { name: "Friendship" });
    await userEvent.click(within(box).getByRole("button", { name: "+ Add friend" }));
    expect(services.api.sendFriendRequest).toHaveBeenCalledWith("byte_rival");
  });

  it("shows friends with the head-to-head and a Challenge link when online", async () => {
    services.profiles = { rival: profile };
    services.api.getFriendStatus.mockResolvedValue({
      userId: "user-2",
      status: "friends",
      inBattle: false,
      headToHead: { wins: 3, losses: 1, draws: 0 },
    });
    open("/u/byte_rival");
    const box = await screen.findByRole("region", { name: "Friendship" });
    await waitFor(() => expect(box).toHaveTextContent("✓ Friends"));
    expect(box).toHaveTextContent("Head-to-head: You 3 – 1");
    await waitFor(() => expect(services.lobby).toHaveLength(1));
    await online("user-2");
    expect(within(box).getByRole("link", { name: "⚔ Challenge" })).toHaveAttribute(
      "href",
      "/friends?challenge=user-2",
    );
  });

  it("is not shown to visitors or on your own profile", async () => {
    services.profiles = { rival: profile };
    const first = renderWithApp(createFakeAuth(), services, "/u/byte_rival");
    await screen.findByRole("article");
    expect(screen.queryByRole("region", { name: "Friendship" })).not.toBeInTheDocument();
    first.unmount();
  });
});
