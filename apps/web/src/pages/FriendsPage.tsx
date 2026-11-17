import { USERNAME_PATTERN, type RoomDifficulty, type RoomMinutes } from "@code-wars/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { useNotifications } from "../friends/notifications";
import { headToHeadText } from "../friends/format";
import { ApiError, type FoundPlayer, type Friend, type FriendList } from "../lib/api";
import { useOnlineUsers } from "../lib/online";
import { DifficultyChooser, MinutesChooser, UnratedBadge } from "../rooms/parts";
import { useServices } from "../services";

type Presence = "online" | "battle" | "offline" | "unknown";

function presenceOf(friend: Friend, online: ReadonlySet<string> | null): Presence {
  if (friend.inBattle) return "battle";
  if (!online) return "unknown";
  return online.has(friend.userId) ? "online" : "offline";
}

const PRESENCE: Record<Presence, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-[#5CF2C2]" },
  battle: { label: "In a battle", dot: "bg-rival" },
  offline: { label: "Offline", dot: "bg-line-strong" },
  unknown: { label: "", dot: "bg-line-strong" },
};

/** Difficulty and time, then Send challenge: under a friend's row. */
function ChallengeForm({
  friend,
  onSent,
  onCancel,
}: {
  friend: Friend;
  onSent: () => void;
  onCancel: () => void;
}) {
  const { api } = useServices();
  const { refresh } = useNotifications();
  const [difficulty, setDifficulty] = useState<RoomDifficulty>("any");
  const [minutes, setMinutes] = useState<RoomMinutes>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.sendChallenge(friend.userId, difficulty, minutes);
      await refresh();
      onSent();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the challenge.");
      setBusy(false);
    }
  }

  return (
    <div
      aria-label={`Challenge ${friend.username}`}
      role="group"
      className="flex flex-col gap-3 border-t border-line pt-3"
    >
      <DifficultyChooser value={difficulty} onChange={setDifficulty} />
      <MinutesChooser value={minutes} onChange={setMinutes} />
      <p className="m-0 flex items-center gap-2 text-sm text-muted">
        <UnratedBadge /> {friend.username} has 30 seconds to accept.
      </p>
      {error ? (
        <p role="alert" className="m-0 text-rival">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send challenge"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FriendRow({
  friend,
  presence,
  open,
  onToggle,
  onRemoved,
}: {
  friend: Friend;
  presence: Presence;
  open: boolean;
  onToggle: () => void;
  onRemoved: () => void;
}) {
  const { api } = useServices();
  const [confirming, setConfirming] = useState(false);
  const canChallenge = presence === "online";
  const p = PRESENCE[presence];

  return (
    <li className="flex flex-col gap-3 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex-none">
          <Avatar id={friend.avatar} size={44} decorative />
          <span
            aria-hidden="true"
            className={`absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-panel ${p.dot}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to={`/u/${friend.username}`}
            className="block truncate font-display text-lg font-bold text-ink no-underline hover:text-you"
          >
            {friend.username}
          </Link>
          <p className="m-0 font-mono text-xs text-muted">
            {friend.rating}
            {p.label ? ` · ${p.label}` : ""} · {headToHeadText(friend.headToHead)}
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={onToggle}
            disabled={!canChallenge}
            aria-expanded={open}
            title={
              canChallenge
                ? undefined
                : presence === "battle"
                  ? `${friend.username} is in a battle`
                  : `${friend.username} is offline`
            }
            className="h-10 cursor-pointer border border-rival bg-transparent px-3 font-display text-sm font-semibold tracking-widest text-rival uppercase hover:bg-rival/10 disabled:cursor-not-allowed disabled:border-line-strong disabled:text-muted"
          >
            ⚔ Challenge
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => void api.removeFriend(friend.userId).then(onRemoved)}
                className="h-10 cursor-pointer border border-rival bg-rival/10 px-3 font-display text-sm font-semibold tracking-widest text-rival uppercase"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-10 cursor-pointer border border-line-strong bg-transparent px-3 font-display text-sm font-semibold tracking-widest text-soft uppercase"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Remove ${friend.username} from friends`}
              className="h-10 w-10 cursor-pointer border border-line-strong bg-transparent text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {open ? <ChallengeForm friend={friend} onSent={onToggle} onCancel={onToggle} /> : null}
    </li>
  );
}

const SEARCH_DELAY_MS = 250;
const SEARCHABLE = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Players matching what is typed (after 3 letters), each with a one-tap action:
 * Add, Accept (they asked you), or a note when already requested or friends.
 */
function PlayerSuggestions({
  query,
  onChanged,
}: {
  query: string;
  onChanged: (message: string) => void;
}) {
  const { api } = useServices();
  const text = query.trim();
  const [results, setResults] = useState<FoundPlayer[] | "loading" | "error" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  // Wait until typing pauses, and ignore answers to older searches.
  useEffect(() => {
    setActionError(null);
    if (!SEARCHABLE.test(text)) {
      setResults(null);
      return;
    }
    let current = true;
    setResults((r) => (Array.isArray(r) ? r : "loading"));
    const timer = setTimeout(() => {
      api.searchPlayers(text).then(
        (found) => current && setResults(found),
        () => current && setResults("error"),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, text, round]);

  async function act(player: FoundPlayer) {
    setBusy(player.userId);
    setActionError(null);
    try {
      if (player.status === "incoming") {
        await api.respondFriendRequest(player.userId, true);
        onChanged(`You and ${player.username} are now friends.`);
      } else {
        const result = await api.sendFriendRequest(player.username);
        onChanged(
          result.status === "friends"
            ? `You and ${player.username} are now friends.`
            : `Request sent to ${player.username}.`,
        );
      }
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(null);
      setRound((n) => n + 1);
    }
  }

  if (text.length > 0 && text.length < 3) {
    return <p className="m-0 text-sm text-muted">Type 3 or more letters to see suggestions.</p>;
  }
  if (results === null) return null;
  if (results === "loading") {
    return (
      <p role="status" className="m-0 text-sm text-muted">
        Searching…
      </p>
    );
  }
  if (results === "error") {
    return (
      <p role="alert" className="m-0 text-sm text-rival">
        Could not search right now.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="m-0 text-xs text-muted">
        {results.length === 0
          ? `No players match “${text}”.`
          : `${results.length} player${results.length === 1 ? "" : "s"} found`}
      </p>
      {results.length > 0 ? (
        <ul aria-label="Suggestions" className="m-0 flex list-none flex-col border border-line p-0">
          {results.map((p) => (
            <li
              key={p.userId}
              className="flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0"
            >
              <Avatar id={p.avatar} size={32} decorative />
              <Link
                to={`/u/${p.username}`}
                className="min-w-0 flex-1 truncate font-bold text-ink no-underline hover:text-you"
              >
                {p.username}
              </Link>
              <span className="font-mono text-xs text-muted">{p.rating}</span>
              {p.status === "friends" ? (
                <span className="w-24 text-right text-sm text-[#5CF2C2]">✓ Friends</span>
              ) : p.status === "outgoing" ? (
                <span className="w-24 text-right text-sm text-muted">Requested</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(p)}
                  aria-label={
                    p.status === "incoming"
                      ? `Accept ${p.username}'s request`
                      : `Add ${p.username} as a friend`
                  }
                  className={`h-9 w-24 cursor-pointer border bg-transparent font-display text-xs font-semibold tracking-widest uppercase disabled:opacity-50 ${
                    p.status === "incoming"
                      ? "border-rival text-rival hover:bg-rival/10"
                      : "border-you text-you hover:bg-you/10"
                  }`}
                >
                  {busy === p.userId ? "…" : p.status === "incoming" ? "Accept" : "+ Add"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {actionError ? (
        <p role="alert" className="m-0 text-sm text-rival">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

/** /friends — add friends, answer requests, see who's online and challenge them. */
export function FriendsPage() {
  const { api } = useServices();
  const { version, refresh: refreshNotifications } = useNotifications();
  const online = useOnlineUsers();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<FriendList | "loading" | "error">("loading");
  const [username, setUsername] = useState("");
  const [addMessage, setAddMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const openId = params.get("challenge");

  const load = useCallback(async () => {
    try {
      setList(await api.getFriends());
    } catch {
      setList((current) => (current === "loading" ? "error" : current));
    }
  }, [api]);

  // Reload when a request or challenge changes (live), and every so often for busy states.
  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => {
    const poll = setInterval(() => void load(), 15_000);
    return () => clearInterval(poll);
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name)) {
      setAddMessage({ tone: "bad", text: "Usernames have 3 to 20 letters, digits or _." });
      return;
    }
    try {
      const result = await api.sendFriendRequest(name);
      setAddMessage({
        tone: "good",
        text:
          result.status === "friends"
            ? `You and ${name} are now friends.`
            : `Request sent to ${name}.`,
      });
      setUsername("");
      await load();
      void refreshNotifications();
    } catch (caught) {
      setAddMessage({
        tone: "bad",
        text: caught instanceof ApiError ? caught.message : "Could not send the request.",
      });
    }
  }

  async function answer(userId: string, accept: boolean) {
    try {
      await api.respondFriendRequest(userId, accept);
    } finally {
      await load();
      void refreshNotifications();
    }
  }

  const toggle = (id: string) =>
    setParams(openId === id ? {} : { challenge: id }, { replace: true });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 md:py-10">
      <h1 className="m-0 font-display text-4xl leading-none font-bold tracking-wider uppercase italic md:text-5xl">
        Friends
      </h1>

      <form
        aria-label="Add a friend"
        onSubmit={(e) => void add(e)}
        className="flex flex-col gap-2 border border-line bg-panel p-4"
      >
        <label htmlFor="friend-username" className="text-xs tracking-[0.14em] text-muted uppercase">
          Add a friend by username
        </label>
        <div className="flex gap-2">
          <input
            id="friend-username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setAddMessage(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="username"
            className="h-12 min-w-0 flex-1 border border-line-strong bg-ground px-3 text-base text-ink"
          />
          <Button type="submit" variant="outline" disabled={!username.trim()}>
            Send request
          </Button>
        </div>
        <PlayerSuggestions
          query={username}
          onChanged={(text) => {
            setAddMessage({ tone: "good", text });
            void load();
            void refreshNotifications();
          }}
        />
        {addMessage ? (
          <p
            role={addMessage.tone === "bad" ? "alert" : "status"}
            className={`m-0 text-sm ${addMessage.tone === "bad" ? "text-rival" : "text-you"}`}
          >
            {addMessage.text}
          </p>
        ) : null}
      </form>

      {list === "loading" ? (
        <p role="status" className="m-0 text-muted">
          Loading friends…
        </p>
      ) : list === "error" ? (
        <p role="alert" className="m-0 text-rival">
          Could not load your friends. Try again in a moment.
        </p>
      ) : (
        <>
          {list.incoming.length > 0 ? (
            <section aria-label="Friend requests" className="border border-rival bg-panel p-4">
              <h2 className="m-0 mb-2 text-xs font-normal tracking-[0.14em] text-rival uppercase">
                Friend requests · {list.incoming.length}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {list.incoming.map((p) => (
                  <li key={p.userId} className="flex flex-wrap items-center gap-3">
                    <Avatar id={p.avatar} size={36} decorative />
                    <Link
                      to={`/u/${p.username}`}
                      className="min-w-0 flex-1 truncate font-bold text-ink"
                    >
                      {p.username}
                    </Link>
                    <span className="font-mono text-xs text-muted">{p.rating}</span>
                    <Button className="h-10 px-4" onClick={() => void answer(p.userId, true)}>
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-10 px-4"
                      onClick={() => void answer(p.userId, false)}
                    >
                      Decline
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="Your friends" className="border border-line bg-panel px-4 py-3">
            <h2 className="m-0 mb-1 text-xs font-normal tracking-[0.14em] text-muted uppercase">
              Your friends · {list.friends.length}
            </h2>
            {list.friends.length === 0 ? (
              <p className="m-0 py-2 text-soft">
                No friends yet. Add one by username above, or press Add friend on a player's profile
                (for example from the{" "}
                <Link to="/rankings" className="text-you">
                  rankings
                </Link>
                ).
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {list.friends.map((friend) => (
                  <FriendRow
                    key={friend.userId}
                    friend={friend}
                    presence={presenceOf(friend, online)}
                    open={openId === friend.userId}
                    onToggle={() => toggle(friend.userId)}
                    onRemoved={() => void load()}
                  />
                ))}
              </ul>
            )}
          </section>

          {list.outgoing.length > 0 ? (
            <section aria-label="Requests you sent" className="border border-line bg-panel p-4">
              <h2 className="m-0 mb-2 text-xs font-normal tracking-[0.14em] text-muted uppercase">
                Requests you sent · {list.outgoing.length}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {list.outgoing.map((p) => (
                  <li key={p.userId} className="flex items-center gap-3">
                    <Avatar id={p.avatar} size={32} decorative />
                    <span className="min-w-0 flex-1 truncate">{p.username}</span>
                    <span className="text-sm text-muted">Waiting…</span>
                    <Button
                      variant="ghost"
                      className="h-9 px-3 text-sm"
                      onClick={() => void api.removeFriend(p.userId).then(load)}
                    >
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
