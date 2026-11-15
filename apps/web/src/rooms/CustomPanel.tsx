import { ROOM_CODE_LENGTH, type RoomDifficulty, type RoomMinutes } from "@code-wars/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui";
import { ApiError, type Room } from "../lib/api";
import { useServices } from "../services";
import {
  DifficultyChooser,
  MinutesChooser,
  RoomCodeInput,
  settingsText,
  UnratedBadge,
} from "./parts";

/** The arena's Custom tab: create a room for a friend, or join one with a code. */
export function CustomPanel() {
  const { api } = useServices();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<Room | null>(null);
  const [difficulty, setDifficulty] = useState<RoomDifficulty>("any");
  const [minutes, setMinutes] = useState<RoomMinutes>(15);
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A room the player already has open (for example after a reload).
  useEffect(() => {
    let active = true;
    api.getCurrentRoom().then(
      (room) => active && setCurrent(room),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const room = await api.createRoom(difficulty, minutes);
      navigate(`/room/${room.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the room.");
      setCreating(false);
    }
  }

  function join(event: FormEvent) {
    event.preventDefault();
    if (code.length === ROOM_CODE_LENGTH) navigate(`/join/${code}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <p className="m-0 text-center text-soft">
        Play a friend. Share a room code, solve the same problem, see who's faster.
      </p>

      {current ? (
        <section
          aria-label="Your open room"
          className="flex flex-wrap items-center justify-between gap-3 border border-rival bg-panel px-4 py-3"
        >
          <span>
            You're in room <b className="font-mono tracking-widest text-rival">{current.code}</b>
            <span className="block text-sm text-muted">{settingsText(current)}</span>
          </span>
          <Link
            to={`/room/${current.id}`}
            className="inline-flex h-11 items-center border border-rival px-4 font-display font-semibold tracking-widest text-rival uppercase no-underline hover:bg-rival/10"
          >
            Open room
          </Link>
        </section>
      ) : null}

      <section
        aria-label="Create a room"
        className="flex flex-col gap-4 border border-you bg-panel p-4 shadow-[0_0_18px_rgba(34,230,255,0.15)] md:p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 font-display text-2xl font-bold">Create a room</h2>
          <UnratedBadge />
        </div>
        <DifficultyChooser value={difficulty} onChange={setDifficulty} />
        <MinutesChooser value={minutes} onChange={setMinutes} />
        <p className="m-0 text-sm text-muted">
          You get a code to send to your friend. Rating doesn't change. The code expires after 30
          minutes.
        </p>
        <Button className="w-full" disabled={creating} onClick={() => void create()}>
          {creating ? "Creating…" : "Create room"}
        </Button>
        {error ? (
          <p role="alert" className="m-0 text-rival">
            {error}
          </p>
        ) : null}
      </section>

      <div className="flex items-center gap-3 font-mono text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        OR
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        aria-label="Join with a code"
        onSubmit={join}
        className="flex flex-col gap-3 border border-line bg-panel p-4 md:p-5"
      >
        <h2 className="m-0 font-display text-2xl font-bold">Join with a code</h2>
        <label htmlFor="room-code" className="text-xs tracking-[0.14em] text-muted uppercase">
          Room code
        </label>
        <RoomCodeInput id="room-code" value={code} onChange={setCode} />
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          disabled={code.length !== ROOM_CODE_LENGTH}
        >
          Join room
        </Button>
      </form>
    </div>
  );
}
