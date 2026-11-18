import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FriendButton } from "../friends/FriendButton";
import { ApiError, type Rematch } from "../lib/api";
import { useServices } from "../services";
import { formatClock } from "./useBattle";

export interface RematchView {
  offer: Rematch | null;
  /** Milliseconds left to ask for (or answer) a rematch. */
  leftMs: number;
  busy: boolean;
  error: string | null;
  ask: () => Promise<void>;
  answer: (accept: boolean) => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * The rematch offer after a finished battle: kept current with live updates,
 * counted down by the server's clock, and when both players say yes, both are
 * taken into the new battle. Leaving the result screen withdraws your request.
 */
export function useRematch(battleId: string, enabled: boolean): RematchView {
  const { api, live, timing } = useServices();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<Rematch | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Rematch | null>(null);
  latest.current = offer;

  const apply = useCallback((next: Rematch) => {
    setOffer(next);
    setOffset(Date.parse(next.serverTime) - Date.now());
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.getRematch(battleId));
    } catch {
      // Keep the last known state through a temporary failure.
    }
  }, [api, apply, battleId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const stop = live.watchRematch(battleId, () => void load());
    const poll = setInterval(() => void load(), timing.pollMs);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      clearInterval(poll);
      clearInterval(tick);
      // Leaving the result screen takes back a request nobody answered yet.
      const current = latest.current;
      if (current?.status === "pending" && current.requestedByYou) {
        void api.cancelRematch(battleId).catch(() => undefined);
      }
    };
  }, [api, battleId, enabled, live, load, timing.pollMs]);

  // Both said yes: into the new battle.
  useEffect(() => {
    if (offer?.status === "accepted" && offer.newBattleId) {
      navigate(`/battle/${offer.newBattleId}`);
    }
  }, [offer, navigate]);

  async function run(action: () => Promise<Rematch>) {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
      void load();
    } finally {
      setBusy(false);
    }
  }

  const leftMs = offer ? Math.max(0, Date.parse(offer.windowEndsAt) - (now + offset)) : 0;
  return {
    offer,
    leftMs,
    busy,
    error,
    ask: () => run(() => api.requestRematch(battleId)),
    answer: (accept) => run(() => api.respondRematch(battleId, accept)),
    cancel: () => run(() => api.cancelRematch(battleId)),
  };
}

/** Floating banner for the player who was asked. */
export function RematchBanner({ view, rival }: { view: RematchView; rival: string }) {
  const { offer } = view;
  if (!offer || offer.status !== "pending" || offer.requestedByYou || view.leftMs <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-4">
      <section
        aria-label={`${rival} wants a rematch`}
        aria-live="assertive"
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 border border-rival bg-panel p-4 shadow-[0_0_30px_rgba(255,46,154,0.35),0_12px_40px_rgba(0,0,0,0.7)]"
      >
        <p className="m-0 flex items-center justify-between gap-3 font-display text-xl font-bold">
          <span>
            ⚔ <span className="text-rival">{rival}</span> wants a rematch!
          </span>
          <span className="font-mono text-base font-normal text-rival">
            {formatClock(view.leftMs)}
          </span>
        </p>
        <p className="m-0 text-sm text-soft">
          Same opponent, a new problem.{" "}
          {offer.rated ? "Ranked: rating counts." : "Unrated: rating doesn't change."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={view.busy}
            onClick={() => void view.answer(true)}
            className="cut h-11 flex-1 cursor-pointer border-0 bg-rival font-display font-bold tracking-widest text-ground uppercase shadow-[0_0_24px_rgba(255,46,154,0.45)] disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={view.busy}
            onClick={() => void view.answer(false)}
            className="h-11 flex-1 cursor-pointer border border-line-strong bg-transparent font-display font-semibold tracking-widest text-ink uppercase disabled:opacity-50"
          >
            No thanks
          </button>
        </div>
      </section>
    </div>
  );
}

function seriesText(series: Rematch["series"]): string | null {
  const played = series.you + series.them + series.draws;
  if (played < 2) return null;
  return `Series tonight: You ${series.you} – ${series.them}${series.draws ? ` (${series.draws} draw${series.draws === 1 ? "" : "s"})` : ""}`;
}

/** Under the result: Rematch, Add friend, Find new battle. */
export function WhatNext({
  view,
  rival,
  rivalHere,
  rated,
  blitz = false,
}: {
  /** Blitz: "Next Blitz" goes straight back to the Blitz queue. */
  blitz?: boolean;
  view: RematchView;
  rival: string;
  /** Whether the opponent is still on the result screen (null: unknown). */
  rivalHere: boolean | null;
  rated: boolean;
}) {
  const { offer, leftMs } = view;
  const open = leftMs > 0;
  const status = offer?.status ?? "none";
  const mine = offer?.requestedByYou ?? false;
  const canAsk =
    open &&
    rivalHere !== false &&
    (status === "none" || (status === "cancelled" && offer?.cancelReason === "withdrawn"));

  let message: string | null = null;
  if (status === "declined") message = mine ? `${rival} said no thanks.` : "You said no thanks.";
  else if (status === "expired")
    message = mine ? `No answer from ${rival}.` : "The rematch window has closed.";
  else if (status === "cancelled" && offer?.cancelReason === "busy")
    message = `${rival} started another battle.`;
  else if (rivalHere === false && status !== "accepted") message = `${rival} left.`;
  else if (!open && status === "none") message = "The rematch window has closed.";

  const series = offer ? seriesText(offer.series) : null;

  return (
    <section
      aria-label="What next?"
      className="flex w-full flex-col gap-3 border border-line bg-panel p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-xs font-normal tracking-[0.14em] text-muted uppercase">
          What next?
        </h2>
        {rivalHere === null ? null : rivalHere ? (
          <span className="font-mono text-xs text-[#5CF2C2]">● {rival} is still here</span>
        ) : (
          <span className="font-mono text-xs text-muted">○ {rival} left</span>
        )}
      </div>
      {series ? <p className="m-0 font-mono text-sm text-soft">{series}</p> : null}

      {status === "pending" && mine ? (
        <div role="status" className="flex flex-col gap-2 border border-you bg-you/5 p-3">
          <p className="m-0 flex items-center justify-between font-display text-lg font-bold">
            <span>⚔ Rematch asked</span>
            <span className="font-mono text-base font-normal text-you">{formatClock(leftMs)}</span>
          </p>
          <p className="m-0 text-sm text-soft">Waiting for {rival} to say yes…</p>
          <button
            type="button"
            disabled={view.busy}
            onClick={() => void view.cancel()}
            className="h-10 cursor-pointer border border-line-strong bg-transparent font-display text-sm font-semibold tracking-widest text-soft uppercase"
          >
            Cancel rematch
          </button>
        </div>
      ) : status === "pending" ? (
        <p role="status" className="m-0 text-rival">
          {rival} wants a rematch: answer above.
        </p>
      ) : status === "accepted" ? (
        <p role="status" className="m-0 font-display text-lg font-bold text-you">
          Rematch on! Starting…
        </p>
      ) : canAsk ? (
        <>
          <button
            type="button"
            disabled={view.busy}
            onClick={() => void view.ask()}
            aria-label={`Rematch ${rival}`}
            className="cut glow-you h-14 w-full cursor-pointer border-0 bg-you font-display text-xl font-bold tracking-widest text-ground uppercase disabled:cursor-not-allowed disabled:opacity-50"
          >
            ⚔ Rematch
          </button>
          <p className="m-0 text-sm text-muted">
            Starts only if you both press it · {formatClock(leftMs)} left ·{" "}
            {offer?.rated ? "ranked" : "unrated"}
          </p>
        </>
      ) : null}
      {message ? (
        <p role="status" className="m-0 text-soft">
          {message}
        </p>
      ) : null}
      {view.error ? (
        <p role="alert" className="m-0 text-rival">
          {view.error}
        </p>
      ) : null}

      <FriendButton username={rival} />

      {blitz ? (
        <Link
          to="/arena?mode=blitz"
          className="cut glow-gold inline-flex h-12 items-center justify-center bg-gold font-display font-bold tracking-widest text-ground uppercase no-underline hover:brightness-110"
        >
          ⚡ Next Blitz
        </Link>
      ) : (
        <Link
          to={rated ? "/arena" : "/arena?mode=custom"}
          className="inline-flex h-12 items-center justify-center border border-line-strong font-display font-semibold tracking-widest text-ink uppercase no-underline hover:border-muted"
        >
          Find new battle
        </Link>
      )}
    </section>
  );
}
