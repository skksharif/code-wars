import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatClock } from "../battle/useBattle";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { ApiError, type Room, type RoomPlayer } from "../lib/api";
import { tierFor } from "../lib/tiers";
import { useMediaQuery } from "../lib/useMediaQuery";
import { RoomCodeDisplay, settingsText, ShareRow, UnratedBadge } from "../rooms/parts";
import { useServices } from "../services";

type Load =
  { status: "loading" } | { status: "ready"; room: Room } | { status: "error"; message: string };

function Ended({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-12 text-center">
      <h1 className="m-0 font-display text-3xl font-bold uppercase italic">{title}</h1>
      <p role="alert" className="m-0 text-soft">
        {text}
      </p>
      <Link to="/arena?mode=custom" className="text-you">
        Back to the arena
      </Link>
    </main>
  );
}

/** One side of the VS card: a player, or the empty seat waiting for a friend. */
function Seat({
  player,
  tag,
  side,
}: {
  player: RoomPlayer | null;
  tag: string;
  side: "you" | "rival";
}) {
  const edge =
    side === "you" ? "shadow-[inset_0_-3px_0_#22E6FF]" : "shadow-[inset_0_-3px_0_#FF2E9A]";
  if (!player) {
    return (
      <div className="flex min-w-0 flex-col items-center gap-1.5 px-2 py-5 text-center shadow-[inset_0_-3px_0_#3A4160] md:py-7">
        <span
          aria-hidden="true"
          className="h-16 w-16 rounded-full border-2 border-dashed border-rival md:h-20 md:w-20"
        />
        <span className="font-display text-lg font-bold text-muted md:text-xl">Waiting…</span>
        <span className="font-mono text-[11px] text-muted">share the code</span>
      </div>
    );
  }
  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-1.5 px-2 py-5 text-center md:py-7 ${edge}`}
    >
      <Avatar
        id={player.avatar}
        size={72}
        frame={side === "you" ? "#22E6FF" : "#FF2E9A"}
        decorative
      />
      <span className="max-w-full font-display text-lg font-bold break-all md:text-xl">
        {player.username}
      </span>
      <span className="font-mono text-[11px] text-muted">
        {tag} · {player.rating} · {tierFor(player.rating).name}
      </span>
    </div>
  );
}

/** /room/:id — the waiting room for a custom match, for its host and guest. */
export function RoomPage() {
  const { id = "" } = useParams();
  const { api, live, timing } = useServices();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<"start" | "leave" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const wide = useMediaQuery("(min-width: 1024px)");

  const refresh = useCallback(async () => {
    try {
      const room = await api.getRoom(id);
      setClockOffset(Date.parse(room.serverTime) - Date.now());
      setLoad({ status: "ready", room });
    } catch (caught) {
      setLoad({
        status: "error",
        message:
          caught instanceof ApiError && caught.code === "NOT_PARTICIPANT"
            ? "You're no longer in this room."
            : caught instanceof ApiError
              ? caught.message
              : "Could not load the room.",
      });
    }
  }, [api, id]);

  // Live updates when the friend joins or leaves or the host starts; a slow
  // poll as a fallback in case a live update is missed.
  useEffect(() => {
    void refresh();
    const stop = live.watchRoom(id, () => void refresh());
    const poll = setInterval(() => void refresh(), timing.pollMs);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [id, live, refresh, timing.pollMs]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const room = load.status === "ready" ? load.room : null;
  useEffect(() => {
    if (room?.status === "started" && room.battleId) {
      navigate(`/battle/${room.battleId}`, { replace: true });
    }
  }, [room, navigate]);

  if (load.status === "loading") {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Loading room…
      </p>
    );
  }
  if (load.status === "error") return <Ended title="Room unavailable" text={load.message} />;
  const r = load.room;
  if (r.status === "closed") {
    return (
      <Ended
        title="Room closed"
        text={r.isHost ? "You closed this room." : `${r.host.username} closed this room.`}
      />
    );
  }
  if (r.status === "expired") {
    return <Ended title="Room expired" text="Nobody started this room within 30 minutes." />;
  }
  if (r.status === "started") {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Starting the battle…
      </p>
    );
  }

  const left = Math.max(0, Date.parse(r.expiresAt) - (now + clockOffset));
  const me = r.isHost ? r.host : r.guest;
  const them = r.isHost ? r.guest : r.host;

  async function start() {
    setBusy("start");
    setActionError(null);
    try {
      const started = await api.startRoom(r.id);
      if (started.battleId) navigate(`/battle/${started.battleId}`, { replace: true });
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Could not start the battle.");
      setBusy(null);
      void refresh();
    }
  }

  async function leave() {
    setBusy("leave");
    try {
      await api.leaveRoom(r.id);
    } catch {
      // Leaving is best effort: an unused room expires by itself.
    }
    navigate("/arena?mode=custom");
  }

  const actions = (
    <div className="flex flex-col gap-2">
      {r.isHost ? (
        <>
          <Button
            className="w-full"
            disabled={!r.guest || busy !== null}
            onClick={() => void start()}
          >
            {busy === "start" ? (
              "Starting…"
            ) : (
              <>
                <span aria-hidden="true">⚔&nbsp;</span>Start battle
              </>
            )}
          </Button>
          {!r.guest ? (
            <p className="m-0 text-center text-xs text-muted">
              Start unlocks when your friend joins.
            </p>
          ) : null}
        </>
      ) : (
        <p
          role="status"
          className="m-0 flex min-h-12 items-center justify-center gap-3 border border-line bg-panel px-3 text-soft"
        >
          <Avatar id={r.host.avatar} size={26} decorative />
          Waiting for {r.host.username} to start…
        </p>
      )}
      {actionError ? (
        <p role="alert" className="m-0 text-center text-rival">
          {actionError}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void leave()}
        className="h-10 cursor-pointer border border-line bg-transparent font-display text-xs font-semibold tracking-widest text-muted uppercase hover:text-ink disabled:opacity-50"
      >
        {r.isHost ? "Close room" : "Leave room"}
      </button>
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pt-5 pb-48 md:px-[5%] lg:pt-8 lg:pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-display text-2xl font-bold md:text-4xl lg:italic">
          {r.isHost ? "Your room" : `${r.host.username}'s room`}
        </h1>
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          {settingsText(r)} <UnratedBadge />
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.15fr] lg:gap-6">
        {r.isHost ? (
          <section
            aria-label="Invite your friend"
            className="flex flex-col items-center gap-3 border border-you bg-panel p-4 lg:order-1 lg:p-6"
          >
            <p className="m-0 text-xs tracking-[0.14em] text-muted uppercase">Room code</p>
            <RoomCodeDisplay code={r.code} />
            <ShareRow code={r.code} />
            <p className="m-0 text-center font-mono text-xs text-muted">
              Expires in {formatClock(left)}
            </p>
          </section>
        ) : null}

        <div className={`flex flex-col gap-4 lg:order-2 ${r.isHost ? "" : "lg:col-span-2"}`}>
          <section aria-label="Players" className="flex flex-col gap-2">
            <p className="m-0 text-xs tracking-[0.14em] text-muted uppercase">
              Players · {r.guest ? 2 : 1} / 2
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center border border-line bg-panel">
              <Seat player={me} tag={r.isHost ? "HOST" : "YOU"} side="you" />
              <span className="px-1 font-display text-2xl font-bold italic md:text-4xl">VS</span>
              <Seat player={them} tag={r.isHost ? "JOINED" : "HOST"} side="rival" />
            </div>
            {!r.guest ? <span className="sr-only">Waiting for your friend…</span> : null}
          </section>
          {/* Wide screens: the actions sit under the players. */}
          {wide ? actions : null}
        </div>
      </div>

      {/* Phones and tablets: pinned above the bottom bar, always in reach. */}
      {wide ? null : (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-panel px-4 py-3 md:bottom-24 md:mx-auto md:max-w-xl md:border">
          {actions}
        </div>
      )}
    </main>
  );
}
