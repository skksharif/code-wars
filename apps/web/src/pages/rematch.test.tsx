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
  rematch,
  renderWithApp,
  type FakeServices,
} from "../test/fakeServices";

vi.mock("../battle/CodeEditor", () => ({
  default: () => <textarea aria-label="Code editor" />,
}));

const NEXT_ID = "44444444-4444-4444-8444-444444444444";

let services: FakeServices;
beforeEach(() => {
  services = createFakeServices();
  services.api.getBattle.mockImplementation(async (id) =>
    id === NEXT_ID
      ? battleState({
          battle: {
            ...battleState().battle,
            id: NEXT_ID,
            startsAt: new Date(Date.now() + 8000).toISOString(),
            rematchOf: BATTLE_ID,
            series: { you: 1, them: 0, draws: 0 },
          },
          problem: null,
        })
      : finishedState(
          { result: "win", ratingAfter: 1216 },
          { result: "loss", ratingAfter: 1184 },
          { finishReason: "solved", winnerId: "user-1" },
        ),
  );
});
afterEach(cleanup);

const open = () => renderWithApp(createFakeAuth(TEST_USER), services, `/battle/${BATTLE_ID}`);
const panel = () => screen.findByRole("region", { name: "What next?" });
const presence = (...ids: string[]) =>
  act(() => {
    for (const w of services.watchers) w.onPresence(ids);
  });
const offerChanged = () =>
  act(() => {
    for (const notify of services.rematchWatchers) notify();
  });

describe("what next after a battle", () => {
  it("offers Rematch, Add friend and Find new battle, and says who is still here", async () => {
    open();
    const next = await panel();
    await waitFor(() => expect(services.watchers.length).toBeGreaterThan(0));
    await presence("user-1", "user-2");
    expect(next).toHaveTextContent("● byte_rival is still here");
    expect(within(next).getByRole("button", { name: "Rematch byte_rival" })).toBeEnabled();
    expect(next).toHaveTextContent(/Starts only if you both press it · 00:[45]\d left · ranked/);
    expect(await within(next).findByRole("button", { name: "+ Add friend" })).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Find new battle" })).toHaveAttribute(
      "href",
      "/arena",
    );
  });

  it("shows the series once you have played twice tonight", async () => {
    services.api.getRematch.mockResolvedValue(rematch({ series: { you: 2, them: 1, draws: 0 } }));
    open();
    expect(await within(await panel()).findByText("Series tonight: You 2 – 1")).toBeInTheDocument();
  });

  it("asking shows a countdown, and can be taken back", async () => {
    open();
    const next = await panel();
    await userEvent.click(await within(next).findByRole("button", { name: "Rematch byte_rival" }));
    expect(services.api.requestRematch).toHaveBeenCalledWith(BATTLE_ID);
    const waiting = within(next).getByRole("status", { name: "" });
    expect(next).toHaveTextContent(/⚔ Rematch asked00:[45]\d/);
    expect(next).toHaveTextContent("Waiting for byte_rival to say yes…");
    expect(waiting).toBeInTheDocument();
    await userEvent.click(within(next).getByRole("button", { name: "Cancel rematch" }));
    expect(services.api.cancelRematch).toHaveBeenCalledWith(BATTLE_ID);
  });

  it("when the other player says yes, both go into the rematch", async () => {
    services.api.getRematch.mockResolvedValue(rematch({ status: "pending", requestedByYou: true }));
    open();
    await within(await panel()).findByText("Waiting for byte_rival to say yes…");
    services.api.getRematch.mockResolvedValue(
      rematch({ status: "accepted", requestedByYou: true, newBattleId: NEXT_ID }),
    );
    await offerChanged();
    expect(await screen.findByText(/Rematch · game 2/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Series tonight: you 1, byte_rival 0")).toBeInTheDocument();
  });

  it("the asked player gets a banner to accept or say no thanks", async () => {
    services.api.getRematch.mockResolvedValue(
      rematch({ status: "pending", requestedByYou: false }),
    );
    open();
    const banner = await screen.findByRole("region", { name: "byte_rival wants a rematch" });
    expect(banner).toHaveTextContent("Same opponent, a new problem. Ranked: rating counts.");
    expect(await panel()).toHaveTextContent("byte_rival wants a rematch: answer above.");
    await userEvent.click(within(banner).getByRole("button", { name: "Accept" }));
    expect(services.api.respondRematch).toHaveBeenCalledWith(BATTLE_ID, true);
    expect(await screen.findByText(/Rematch · game 2/i)).toBeInTheDocument();
  });

  it("no thanks is shown to both sides", async () => {
    services.api.getRematch.mockResolvedValue(
      rematch({ status: "pending", requestedByYou: false }),
    );
    const first = open();
    const banner = await screen.findByRole("region", { name: "byte_rival wants a rematch" });
    await userEvent.click(within(banner).getByRole("button", { name: "No thanks" }));
    expect(services.api.respondRematch).toHaveBeenCalledWith(BATTLE_ID, false);
    expect(await within(await panel()).findByText("You said no thanks.")).toBeInTheDocument();
    first.unmount();

    services.api.getRematch.mockResolvedValue(
      rematch({ status: "declined", requestedByYou: true }),
    );
    open();
    expect(
      await within(await panel()).findByText("byte_rival said no thanks."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rematch byte_rival" })).not.toBeInTheDocument();
  });

  it("explains other endings", async () => {
    services.api.getRematch.mockResolvedValue(
      rematch({ status: "cancelled", cancelReason: "busy", requestedByYou: true }),
    );
    const first = open();
    expect(
      await within(await panel()).findByText("byte_rival started another battle."),
    ).toBeInTheDocument();
    first.unmount();

    services.api.getRematch.mockResolvedValue(rematch({ status: "expired", requestedByYou: true }));
    const second = open();
    expect(
      await within(await panel()).findByText("No answer from byte_rival."),
    ).toBeInTheDocument();
    second.unmount();

    services.api.getRematch.mockResolvedValue(
      rematch({ windowEndsAt: new Date(Date.now() - 1000).toISOString() }),
    );
    open();
    expect(
      await within(await panel()).findByText("The rematch window has closed."),
    ).toBeInTheDocument();
  });

  it("says when the opponent left, and offers no rematch", async () => {
    open();
    const next = await panel();
    await waitFor(() => expect(services.watchers.length).toBeGreaterThan(0));
    await presence("user-1");
    expect(next).toHaveTextContent("○ byte_rival left");
    expect(
      within(next).queryByRole("button", { name: "Rematch byte_rival" }),
    ).not.toBeInTheDocument();
  });

  it("shows a server refusal", async () => {
    services.api.requestRematch.mockRejectedValue(
      new ApiError("OPPONENT_BUSY", "Your opponent started another battle.", 409),
    );
    open();
    await userEvent.click(
      await within(await panel()).findByRole("button", { name: "Rematch byte_rival" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your opponent started another battle.",
    );
  });

  it("leaving the result screen takes back an unanswered request", async () => {
    services.api.getRematch.mockResolvedValue(rematch({ status: "pending", requestedByYou: true }));
    const view = open();
    await within(await panel()).findByText("Waiting for byte_rival to say yes…");
    view.unmount();
    expect(services.api.cancelRematch).toHaveBeenCalledWith(BATTLE_ID);
  });
});
