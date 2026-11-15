import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatClock } from "../battle/useBattle";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { ApiError, type Room } from "../lib/api";
import {
  CopyButton,
  joinLink,
  PlayerRow,
  RoomCodeDisplay,
  settingsText,
  ShareButton,
  UnratedBadge,
} from "../rooms/parts";
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

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-5 md:py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 font-display text-2xl font-bold md:text-3xl">
          {r.isHost ? "Your room" : `${r.host.username}'s room`}
        </h1>
        <UnratedBadge />
      </div>

      {r.isHost ? (
        <section
          aria-label="Invite your friend"
          className="flex flex-col items-center gap-3 border border-you bg-panel p-4"
        >
          <p className="m-0 text-xs tracking-[0.14em] text-muted uppercase">Room code</p>
          <RoomCodeDisplay code={r.code} />
          <div className="flex w-full gap-2">
            <CopyButton text={r.code} label="Copy code" />
            <CopyButton text={joinLink(r.code)} label="Copy link" />
          </div>
          <ShareButton code={r.code} />
          <p className="m-0 text-center font-mono text-xs text-muted">
            Expires in {formatClock(left)}
          </p>
        </section>
      ) : null}

      <section aria-label="Players" className="flex flex-col gap-3 border border-line bg-panel p-4">
        <p className="m-0 flex justify-between text-xs tracking-[0.14em] text-muted uppercase">
          <span>Players · {r.guest ? 2 : 1} / 2</span>
          <span className="normal-case">{settingsText(r)}</span>
        </p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <PlayerRow player={r.host} tag="HOST" side={r.isHost ? "you" : "rival"} />
          {r.guest ? (
            <PlayerRow player={r.guest} tag="JOINED" side={r.isHost ? "rival" : "you"} />
          ) : (
            <li className="flex items-center gap-3 text-muted">
              <span
                aria-hidden="true"
                className="h-10 w-10 flex-none rounded-full border-2 border-dashed border-rival"
              />
              Waiting for your friend…
            </li>
          )}
        </ul>
      </section>

      {r.isHost ? (
        <>
          <Button
            className="w-full"
            disabled={!r.guest || busy !== null}
            onClick={() => void start()}
          >
            {busy === "start" ? "Starting…" : "Start battle"}
          </Button>
          {!r.guest ? (
            <p className="m-0 text-center text-sm text-muted">
              Start unlocks when your friend joins.
            </p>
          ) : null}
        </>
      ) : (
        <p
          role="status"
          className="m-0 flex items-center justify-center gap-3 border border-line bg-panel p-4 text-soft"
        >
          <Avatar id={r.host.avatar} size={28} decorative />
          Waiting for {r.host.username} to start…
        </p>
      )}
      {actionError ? (
        <p role="alert" className="m-0 text-rival">
          {actionError}
        </p>
      ) : null}
      <Button
        variant="ghost"
        className="w-full"
        disabled={busy !== null}
        onClick={() => void leave()}
      >
        {r.isHost ? "Close room" : "Leave room"}
      </Button>
    </main>
  );
}
