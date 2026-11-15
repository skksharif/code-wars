// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { createFakeAuth, TEST_USER } from "../test/fakeAuth";
import {
  BATTLE_ID,
  createFakeServices,
  finishedState,
  renderWithApp,
  room,
  ROOM_GUEST,
  ROOM_ID,
  type FakeServices,
} from "../test/fakeServices";

vi.mock("../battle/CodeEditor", () => ({
  default: () => <textarea aria-label="Code editor" />,
}));

let services: FakeServices;
beforeEach(() => {
  window.localStorage.clear();
  services = createFakeServices();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (path: string) => renderWithApp(createFakeAuth(TEST_USER), services, path);
const roomChanged = () =>
  act(() => {
    for (const notify of services.roomWatchers) notify();
  });

describe("arena: Ranked | Custom", () => {
  it("switches to the Custom tab, with create and join", async () => {
    open("/arena");
    const ranked = await screen.findByRole("tab", { name: "Ranked" });
    expect(ranked).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Custom" }));
    expect(screen.getByRole("tab", { name: "Custom" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Create a room" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Join with a code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find Battle" })).not.toBeInTheDocument();
  });

  it("opens straight on the Custom tab from a link", async () => {
    open("/arena?mode=custom");
    expect(await screen.findByRole("region", { name: "Create a room" })).toBeInTheDocument();
  });

  it("creates a room with the chosen settings and opens it", async () => {
    services.api.getRoom.mockResolvedValue(room({ difficulty: "hard", minutes: 30 }));
    open("/arena?mode=custom");
    const create = await screen.findByRole("region", { name: "Create a room" });
    expect(within(create).getByRole("radio", { name: "Any" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(create).getByRole("radio", { name: "15 min" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(within(create).getByRole("radio", { name: "Hard" }));
    await userEvent.click(within(create).getByRole("radio", { name: "30 min" }));
    await userEvent.click(within(create).getByRole("button", { name: "Create room" }));

    expect(services.api.createRoom).toHaveBeenCalledWith("hard", 30);
    expect(await screen.findByRole("heading", { name: "Your room" })).toBeInTheDocument();
    expect(screen.getByLabelText("Room code K 7 M 2 Q X")).toBeInTheDocument();
    expect(screen.getByText("Hard · 30 min")).toBeInTheDocument();
  });

  it("shows why a room could not be made", async () => {
    services.api.createRoom.mockRejectedValue(
      new ApiError("ALREADY_IN_BATTLE", "Finish your current battle first.", 409),
    );
    open("/arena?mode=custom");
    await userEvent.click(await screen.findByRole("button", { name: "Create room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish your current battle first.");
  });

  it("brings the player back to a room they already have open", async () => {
    services.api.getCurrentRoom.mockResolvedValue(room());
    open("/arena?mode=custom");
    const current = await screen.findByRole("region", { name: "Your open room" });
    expect(current).toHaveTextContent("K7M2QX");
    expect(within(current).getByRole("link", { name: "Open room" })).toHaveAttribute(
      "href",
      `/room/${ROOM_ID}`,
    );
  });

  it("tidies a typed code and goes to the join page", async () => {
    open("/arena?mode=custom");
    const input = await screen.findByLabelText("Room code");
    const join = screen.getByRole("button", { name: "Join room" });
    expect(join).toBeDisabled();
    await userEvent.type(input, "k7m 2-q0x");
    // Spaces, dashes and look-alike characters (0) are dropped as you type.
    expect(input).toHaveValue("K7M2QX");
    await userEvent.click(join);
    expect(await screen.findByRole("region", { name: "Room found" })).toBeInTheDocument();
    expect(services.api.getRoomByCode).toHaveBeenCalledWith("K7M2QX");
  });
});

describe("joining with a code", () => {
  it("shows the host and settings, then joins and waits for the host", async () => {
    services.api.getRoom.mockResolvedValue(
      room({
        isHost: false,
        host: { ...ROOM_GUEST, userId: "user-3", username: "host_friend" },
        guest: { userId: "user-1", username: "coder_42", avatar: "nova", rating: 1216 },
      }),
    );
    open("/join/k7m2qx");
    const found = await screen.findByRole("region", { name: "Room found" });
    expect(found).toHaveTextContent("host_friend");
    expect(found).toHaveTextContent("Any difficulty · 15 min");
    expect(found).toHaveTextContent("UNRATED");

    await userEvent.click(screen.getByRole("button", { name: "Join room" }));
    expect(services.api.joinRoom).toHaveBeenCalledWith("K7M2QX");
    expect(await screen.findByText("Waiting for host_friend to start…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start battle" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave room" })).toBeInTheDocument();
  });

  it("explains a code that does not work", async () => {
    services.api.getRoomByCode.mockRejectedValue(
      new ApiError("ROOM_EXPIRED", "This room has expired. Ask your friend for a new code.", 410),
    );
    open("/join/K7M2QX");
    expect(await screen.findByRole("alert")).toHaveTextContent("This room has expired.");
    expect(screen.getByRole("link", { name: "Back to the arena" })).toHaveAttribute(
      "href",
      "/arena?mode=custom",
    );
  });

  it("rejects a malformed code without asking the server", async () => {
    open("/join/AB");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A room code has 6 letters and digits.",
    );
    expect(services.api.getRoomByCode).not.toHaveBeenCalled();
  });

  it("shows a join error and keeps the page", async () => {
    services.api.joinRoom.mockRejectedValue(new ApiError("ROOM_FULL", "This room is full.", 409));
    open("/join/K7M2QX");
    await userEvent.click(await screen.findByRole("button", { name: "Join room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This room is full.");
    expect(screen.getByRole("region", { name: "Room found" })).toBeInTheDocument();
  });

  it("sends the host of the room to the room itself", async () => {
    services.api.getRoomByCode.mockResolvedValue(room());
    open("/join/K7M2QX");
    expect(await screen.findByRole("heading", { name: "Your room" })).toBeInTheDocument();
  });

  it("asks visitors to log in first", async () => {
    renderWithApp(createFakeAuth(), services, "/join/K7M2QX");
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("the room", () => {
  it("lets the host share the code and start once the friend joins", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    open(`/room/${ROOM_ID}`);

    const invite = await screen.findByRole("region", { name: "Invite your friend" });
    expect(invite).toHaveTextContent(/Expires in (29|28):\d\d/);
    await userEvent.click(within(invite).getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("K7M2QX");
    expect(await within(invite).findByText("Copied!")).toBeInTheDocument();
    await userEvent.click(within(invite).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/join/K7M2QX`);

    const start = screen.getByRole("button", { name: "Start battle" });
    expect(start).toBeDisabled();
    expect(screen.getByText("Waiting for your friend…")).toBeInTheDocument();

    // The friend joins: a live update arrives.
    services.api.getRoom.mockResolvedValue(room({ guest: { ...ROOM_GUEST } }));
    roomChanged();
    const players = await screen.findByRole("region", { name: "Players" });
    await waitFor(() => expect(players).toHaveTextContent("byte_rival"));
    expect(players).toHaveTextContent("2 / 2");
    expect(start).toBeEnabled();

    await userEvent.click(start);
    expect(services.api.startRoom).toHaveBeenCalledWith(ROOM_ID);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("takes the guest into the battle when the host starts", async () => {
    services.api.getRoom.mockResolvedValue(room({ isHost: false, guest: { ...ROOM_GUEST } }));
    open(`/room/${ROOM_ID}`);
    await screen.findByText(/Waiting for coder_42 to start/);
    services.api.getRoom.mockResolvedValue(
      room({ isHost: false, guest: { ...ROOM_GUEST }, status: "started", battleId: BATTLE_ID }),
    );
    roomChanged();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("closes the room and goes back to the Custom tab", async () => {
    open(`/room/${ROOM_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Close room" }));
    expect(services.api.leaveRoom).toHaveBeenCalledWith(ROOM_ID);
    expect(await screen.findByRole("region", { name: "Create a room" })).toBeInTheDocument();
  });

  it("tells the guest when the host closed the room", async () => {
    services.api.getRoom.mockResolvedValue(
      room({ isHost: false, guest: { ...ROOM_GUEST }, status: "closed" }),
    );
    open(`/room/${ROOM_ID}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("coder_42 closed this room.");
  });

  it("says when a room expired or the player left it", async () => {
    services.api.getRoom.mockResolvedValue(room({ status: "expired" }));
    const first = open(`/room/${ROOM_ID}`);
    expect(await screen.findByRole("heading", { name: "Room expired" })).toBeInTheDocument();
    first.unmount();

    services.api.getRoom.mockRejectedValue(
      new ApiError("NOT_PARTICIPANT", "You are not a player in this battle.", 403),
    );
    open(`/room/${ROOM_ID}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("You're no longer in this room.");
  });

  it("offers the phone's share sheet where there is one", async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    open(`/room/${ROOM_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Share invite" }));
    expect(share).toHaveBeenCalledWith({
      title: "Code Wars",
      text: "Join my Code Wars room: K7M2QX",
      url: `${window.location.origin}/join/K7M2QX`,
    });
  });
});

describe("after a custom match", () => {
  const customWin = () =>
    finishedState(
      { result: "win", ratingAfter: 1200, bestPassed: 5, attempts: 1 },
      { result: "loss", ratingAfter: 1200 },
      { finishReason: "solved", isRated: false, roomCode: "K7M2QX" },
    );

  it("says it was a custom match and shows no rating change", async () => {
    services.api.getBattle.mockResolvedValue(customWin());
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByRole("heading", { name: "Victory" })).toBeInTheDocument();
    expect(screen.getByText("Custom match · K7M2QX")).toBeInTheDocument();
    expect(screen.getByText("RATING UNCHANGED")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Rating \d+ to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Battle again" })).not.toBeInTheDocument();
  });

  it("starts a rematch room", async () => {
    services.api.getBattle.mockResolvedValue(customWin());
    services.api.getRoom.mockResolvedValue(room({ guest: { ...ROOM_GUEST } }));
    open(`/battle/${BATTLE_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Rematch byte_rival" }));
    expect(services.api.rematch).toHaveBeenCalledWith(BATTLE_ID);
    expect(await screen.findByRole("heading", { name: "Your room" })).toBeInTheDocument();
  });

  it("invites the player when the friend asked for a rematch first", async () => {
    services.api.getBattle.mockResolvedValue(customWin());
    services.api.getCurrentRoom.mockResolvedValue(
      room({
        isHost: false,
        host: { ...ROOM_GUEST },
        guest: { userId: "user-1", username: "coder_42", avatar: "nova", rating: 1216 },
      }),
    );
    open(`/battle/${BATTLE_ID}`);
    const invite = await screen.findByText(/wants a rematch/);
    expect(invite.closest("p")).toHaveTextContent("byte_rival wants a rematch.");
    expect(screen.getByRole("link", { name: "Join room" })).toHaveAttribute(
      "href",
      `/room/${ROOM_ID}`,
    );
  });

  it("ranked results are unchanged", async () => {
    services.api.getBattle.mockResolvedValue(
      finishedState(
        { result: "win", ratingAfter: 1216 },
        { result: "loss", ratingAfter: 1184 },
        { finishReason: "solved" },
      ),
    );
    open(`/battle/${BATTLE_ID}`);
    expect(await screen.findByText("Battle over")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Battle again" })).toBeInTheDocument();
    expect(screen.queryByText("RATING UNCHANGED")).not.toBeInTheDocument();
  });

  it("is tagged CUSTOM in your battle history", async () => {
    services.profiles = {
      me: {
        username: "coder_42",
        avatar: "nova",
        rating: 1216,
        rank: 1,
        memberSince: "2026-11-01T00:00:00Z",
        wins: 0,
        losses: 0,
        draws: 0,
        peakRating: 1216,
        streak: null,
        ratingHistory: [],
        languages: {},
        winsByDifficulty: { easy: 0, medium: 0, hard: 0 },
        recentBattles: [],
      },
    };
    services.history = [
      {
        battleId: BATTLE_ID,
        result: "win",
        ratingBefore: 1216,
        ratingAfter: 1216,
        language: "python",
        bestPassed: 5,
        finishedAt: "2026-11-16T10:00:00Z",
        problemTitle: "Count the Peaks",
        opponent: "byte_rival",
        opponentAvatar: "pixel",
        isRated: false,
      },
    ];
    open("/u/coder_42");
    const history = await screen.findByRole("region", { name: "Battle history" });
    const row = await within(history).findByRole("listitem");
    expect(row).toHaveTextContent("CUSTOM");
    expect(row).not.toHaveTextContent("+0");
  });
});
