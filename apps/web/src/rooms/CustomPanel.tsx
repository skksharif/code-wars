import { ROOM_CODE_LENGTH, type RoomDifficulty, type RoomMinutes } from "@code-wars/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { ApiError, type RecentRoom, type Room } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useServices } from "../services";
import {
  codeFromText,
  CodeBoxesInput,
  DIFFICULTY_LABELS,
  DifficultyChooser,
  MinutesChooser,
  settingsText,
  UnratedBadge,
} from "./parts";

const WIDE_QUERY = "(min-width: 1024px)";

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** A setting shown as a chip; tapping it opens its choices (phones and tablets). */
function SettingChip({
  icon,
  label,
  open,
  onToggle,
}: {
  icon: string;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 border px-3 font-display text-sm font-semibold tracking-[0.06em] ${
        open ? "border-you bg-you/15 text-you" : "border-you/60 bg-you/5 text-you"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
      <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
  );
}

function CreateCard({ onCreate }: { onCreate: (d: RoomDifficulty, m: RoomMinutes) => void }) {
  const wide = useMediaQuery(WIDE_QUERY);
  const [difficulty, setDifficulty] = useState<RoomDifficulty>("any");
  const [minutes, setMinutes] = useState<RoomMinutes>(15);
  const [open, setOpen] = useState<"difficulty" | "minutes" | null>(null);

  return (
    <section
      aria-label="Create a room"
      className="flex flex-col gap-4 border border-you bg-panel p-4 shadow-[0_0_18px_rgba(34,230,255,0.15)] md:p-6"
    >
      <div className="flex items-center gap-3">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          className="flex-none text-you"
        >
          <rect x="3" y="4" width="18" height="16" />
          <path d="M12 9v6M9 12h6" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-2xl font-bold">Create a room</h2>
          <p className="m-0 text-sm text-muted">Get a code to send to your friend</p>
        </div>
        <UnratedBadge />
      </div>

      {wide ? (
        <>
          <DifficultyChooser value={difficulty} onChange={setDifficulty} />
          <MinutesChooser value={minutes} onChange={setMinutes} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <SettingChip
              icon="◆"
              label={difficulty === "any" ? "Any difficulty" : DIFFICULTY_LABELS[difficulty]}
              open={open === "difficulty"}
              onToggle={() => setOpen(open === "difficulty" ? null : "difficulty")}
            />
            <SettingChip
              icon="⏱"
              label={`${minutes} min`}
              open={open === "minutes"}
              onToggle={() => setOpen(open === "minutes" ? null : "minutes")}
            />
          </div>
          {open === "difficulty" ? (
            <DifficultyChooser
              value={difficulty}
              onChange={(d) => {
                setDifficulty(d);
                setOpen(null);
              }}
            />
          ) : null}
          {open === "minutes" ? (
            <MinutesChooser
              value={minutes}
              onChange={(m) => {
                setMinutes(m);
                setOpen(null);
              }}
            />
          ) : null}
        </>
      )}

      <Button className="w-full" onClick={() => onCreate(difficulty, minutes)}>
        Create room
      </Button>
      <p className="m-0 text-center font-mono text-xs text-muted">
        Code expires after 30 minutes if nobody joins
      </p>
    </section>
  );
}

function JoinCard({
  recent,
  onRecent,
}: {
  recent: RecentRoom[];
  onRecent: (room: RecentRoom) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const canPaste =
    typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  function join(event: FormEvent) {
    event.preventDefault();
    if (code.length === ROOM_CODE_LENGTH) navigate(`/join/${code}`);
  }

  async function paste() {
    setPasteMessage(null);
    try {
      const found = codeFromText(await navigator.clipboard.readText());
      if (found) setCode(found);
      else setPasteMessage("That doesn't look like a room code or invite link.");
    } catch {
      setPasteMessage("Couldn't read the clipboard. Type the code instead.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label="Join with a code"
        onSubmit={join}
        className="flex flex-col gap-4 border border-line bg-panel p-4 md:p-6"
      >
        <div className="flex items-center gap-3">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
            className="flex-none text-soft"
          >
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
          <div>
            <h2 className="m-0 font-display text-2xl font-bold">Join with a code</h2>
            <p className="m-0 text-sm text-muted">Type or paste the 6 characters</p>
          </div>
        </div>
        <label htmlFor="room-code" className="sr-only">
          Room code
        </label>
        <CodeBoxesInput
          id="room-code"
          value={code}
          onChange={(next) => {
            setCode(next);
            setPasteMessage(null);
          }}
        />
        <div className={`grid gap-2 ${canPaste ? "grid-cols-[1fr_2fr]" : "grid-cols-1"}`}>
          {canPaste ? (
            <Button type="button" variant="ghost" onClick={() => void paste()}>
              Paste
            </Button>
          ) : null}
          <Button type="submit" variant="outline" disabled={code.length !== ROOM_CODE_LENGTH}>
            Join room
          </Button>
        </div>
        {pasteMessage ? (
          <p role="alert" className="m-0 text-sm text-rival">
            {pasteMessage}
          </p>
        ) : null}
      </form>

      {recent.length > 0 ? (
        <section aria-label="Recent rooms" className="flex flex-col">
          <h2 className="m-0 mb-1 text-xs font-normal tracking-[0.14em] text-muted uppercase">
            Recent rooms
          </h2>
          <ul className="m-0 list-none p-0">
            {recent.map((r) => (
              <li key={`${r.opponent.userId}-${r.playedAt}`} className="border-b border-line/60">
                <button
                  type="button"
                  onClick={() => onRecent(r)}
                  aria-label={`New room like the one with ${r.opponent.username}: ${settingsText(r)}`}
                  className="flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-0 py-2 text-left text-ink hover:bg-you/5"
                >
                  <Avatar id={r.opponent.avatar} size={30} decorative />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    with <b>{r.opponent.username}</b> · {settingsText(r)}
                  </span>
                  <span className="font-mono text-xs text-muted">{timeAgo(r.playedAt)}</span>
                  <span aria-hidden="true" className="text-you">
                    ↻
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The arena's Custom tab: create a room for a friend, or join one with a code. */
export function CustomPanel() {
  const { api } = useServices();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<Room | null>(null);
  const [recent, setRecent] = useState<RecentRoom[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A room the player already has open (for example after a reload), and recent ones.
  useEffect(() => {
    let active = true;
    api.getCurrentRoom().then(
      (room) => active && setCurrent(room),
      () => undefined,
    );
    api.getRecentRooms().then(
      (rooms) => active && setRecent(rooms),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function create(difficulty: RoomDifficulty, minutes: RoomMinutes) {
    if (creating) return;
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p className="m-0 text-center text-soft">Play a friend: unrated, same problem, same clock.</p>

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

      {error ? (
        <p role="alert" className="m-0 text-center text-rival">
          {error}
        </p>
      ) : null}
      {creating ? (
        <p role="status" className="m-0 text-center text-muted">
          Creating…
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <CreateCard onCreate={(d, m) => void create(d, m)} />
        <JoinCard recent={recent} onRecent={(r) => void create(r.difficulty, r.minutes)} />
      </div>
    </div>
  );
}
