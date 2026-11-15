import { cleanRoomCode, ROOM_CODE_LENGTH } from "@code-wars/shared";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { ApiError, type Room } from "../lib/api";
import { tierFor } from "../lib/tiers";
import { settingsText, UnratedBadge } from "../rooms/parts";
import { useServices } from "../services";

type Lookup =
  { status: "loading" } | { status: "found"; room: Room } | { status: "error"; message: string };

/** /join/:code — what a friend sees after typing a code or opening an invite link. */
export function JoinPage() {
  const { code: raw = "" } = useParams();
  const code = cleanRoomCode(raw);
  const { api } = useServices();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<Lookup>({ status: "loading" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const valid = code.length === ROOM_CODE_LENGTH;

  useEffect(() => {
    if (!valid) return;
    let active = true;
    setLookup({ status: "loading" });
    api.getRoomByCode(code).then(
      (room) => active && setLookup({ status: "found", room }),
      (caught) =>
        active &&
        setLookup({
          status: "error",
          message: caught instanceof ApiError ? caught.message : "Could not look up that room.",
        }),
    );
    return () => {
      active = false;
    };
  }, [api, code, valid]);

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      const room = await api.joinRoom(code);
      navigate(`/room/${room.id}`, { replace: true });
    } catch (caught) {
      setJoinError(caught instanceof ApiError ? caught.message : "Could not join the room.");
      setJoining(false);
    }
  }

  const shell = (children: ReactNode) => (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6 md:py-12">
      <h1 className="m-0 font-display text-3xl font-bold">Join a room</h1>
      <p
        className="m-0 border border-line-strong bg-panel py-3 text-center font-mono text-3xl tracking-[0.4em] text-ink"
        aria-label={`Room code ${code.split("").join(" ")}`}
      >
        {code || "——————"}
      </p>
      {children}
    </main>
  );

  if (!valid) {
    return shell(
      <>
        <p role="alert" className="m-0 text-rival">
          A room code has 6 letters and digits.
        </p>
        <Link to="/arena?mode=custom" className="text-you">
          Back to the arena
        </Link>
      </>,
    );
  }
  if (lookup.status === "loading") {
    return shell(
      <p role="status" className="m-0 text-muted">
        Looking for the room…
      </p>,
    );
  }
  if (lookup.status === "error") {
    return shell(
      <>
        <p role="alert" className="m-0 border border-rival bg-rival/5 p-3 text-rival">
          {lookup.message}
        </p>
        <Link to="/arena?mode=custom" className="text-you">
          Back to the arena
        </Link>
      </>,
    );
  }

  const { room } = lookup;
  if (room.status === "started" && room.battleId) {
    return <Navigate to={`/battle/${room.battleId}`} replace />;
  }
  // Your own room, or one you are already the guest of (the server answers
  // "room full" to anyone else once a guest is in): go straight there.
  if (room.isHost || room.guest !== null) {
    return <Navigate to={`/room/${room.id}`} replace />;
  }

  const tier = tierFor(room.host.rating);
  return shell(
    <>
      <section
        aria-label="Room found"
        className="flex flex-col gap-3 border border-rival bg-panel p-4 shadow-[0_0_18px_rgba(255,46,154,0.15)]"
      >
        <p className="m-0 text-xs tracking-[0.14em] text-rival uppercase">Room found</p>
        <div className="flex items-center gap-3">
          <Avatar id={room.host.avatar} size={52} frame="#FF2E9A" decorative />
          <div className="min-w-0">
            <p className="m-0 truncate font-display text-xl font-bold">{room.host.username}</p>
            <p className="m-0 font-mono text-xs text-muted">
              {room.host.rating} · {tier.name} · is hosting
            </p>
          </div>
        </div>
        <p className="m-0 flex items-center justify-between gap-3 text-sm text-soft">
          <span>{settingsText(room)}</span>
          <UnratedBadge />
        </p>
      </section>
      <Button className="w-full" disabled={joining} onClick={() => void join()}>
        {joining ? "Joining…" : "Join room"}
      </Button>
      {joinError ? (
        <p role="alert" className="m-0 text-rival">
          {joinError}
        </p>
      ) : null}
      <Link
        to="/arena?mode=custom"
        className="inline-flex h-12 items-center justify-center border border-line-strong font-display font-semibold tracking-widest text-ink uppercase no-underline hover:border-muted"
      >
        Cancel
      </Link>
    </>,
  );
}
