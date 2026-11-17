import { type RoomDifficulty, type RoomMinutes } from "@code-wars/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/ui";
import { useNotifications } from "../friends/notifications";
import { headToHeadText } from "../friends/format";
import { ApiError, type FoundPlayer, type Friend, type FriendList } from "../lib/api";
import { useOnlineUsers } from "../lib/online";
import { tierFor } from "../lib/tiers";
import { useMediaQuery } from "../lib/useMediaQuery";
import { DifficultyChooser, MinutesChooser, UnratedBadge } from "../rooms/parts";
import { useServices } from "../services";

type Presence = "online" | "battle" | "offline";

/** Unknown presence (lobby not connected yet) counts as offline. */
function presenceOf(friend: Friend, online: ReadonlySet<string> | null): Presence {
  if (friend.inBattle) return "battle";
  return online?.has(friend.userId) ? "online" : "offline";
}

const PRESENCE: Record<Presence, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-[#5CF2C2]", text: "text-[#5CF2C2]" },
  battle: { label: "In a battle", dot: "bg-rival", text: "text-rival" },
  offline: { label: "Offline", dot: "bg-line-strong", text: "text-muted" },
};

/** Wide screens get a side panel for the selected friend; others a bottom sheet. */
const WIDE_QUERY = "(min-width: 1024px)";

// ---------------------------------------------------------------------------
// Find players (suggestions after 3 letters)
// ---------------------------------------------------------------------------
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

  // A new search text clears an old error; refreshing after an action does not.
  useEffect(() => setActionError(null), [text]);

  // Wait until typing pauses, and ignore answers to older searches.
  useEffect(() => {
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
    return (
      <p className="m-0 text-sm text-muted">Type 3 or more letters to find new players too.</p>
    );
  }
  if (results === null) return null;

  return (
    <section aria-label="Find players" className="flex flex-col gap-1">
      <h2 className="m-0 text-xs font-normal tracking-[0.14em] text-muted uppercase">
        Find players
      </h2>
      {results === "loading" ? (
        <p role="status" className="m-0 text-sm text-muted">
          Searching…
        </p>
      ) : results === "error" ? (
        <p role="alert" className="m-0 text-sm text-rival">
          Could not search right now.
        </p>
      ) : (
        <>
          <p role="status" className="m-0 text-xs text-muted">
            {results.length === 0
              ? `No players match “${text}”.`
              : `${results.length} player${results.length === 1 ? "" : "s"} found`}
          </p>
          {results.length > 0 ? (
            <ul
              aria-label="Suggestions"
              className="m-0 flex list-none flex-col border border-line p-0"
            >
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
        </>
      )}
      {actionError ? (
        <p role="alert" className="m-0 text-sm text-rival">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One friend: details, head-to-head, challenge, remove
// ---------------------------------------------------------------------------
function FriendDetails({
  friend,
  presence,
  onRemoved,
  onSent,
  titleRef,
}: {
  friend: Friend;
  presence: Presence;
  onRemoved: () => void;
  onSent: () => void;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  const { api } = useServices();
  const { refresh } = useNotifications();
  const [difficulty, setDifficulty] = useState<RoomDifficulty>("any");
  const [minutes, setMinutes] = useState<RoomMinutes>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const tier = tierFor(friend.rating);
  const p = PRESENCE[presence];
  const h = friend.headToHead;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.sendChallenge(friend.userId, difficulty, minutes);
      await refresh();
      onSent();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the challenge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="relative flex-none">
          <Avatar id={friend.avatar} size={64} frame={tier.color} decorative />
          <span
            aria-hidden="true"
            className={`absolute right-0 bottom-0 h-4 w-4 rounded-full border-2 border-panel ${p.dot}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="m-0 font-display text-2xl leading-tight font-bold break-all outline-none focus:outline-none focus-visible:outline-none md:text-3xl"
          >
            {friend.username}
          </h2>
          <p className="m-0 font-mono text-xs text-muted">
            <span className={p.text}>● {p.label}</span> · {friend.rating} · {tier.name}
          </p>
        </div>
        <Link
          to={`/u/${friend.username}`}
          className="inline-flex h-10 flex-none items-center border border-line-strong px-3 font-display text-xs font-semibold tracking-widest text-ink uppercase no-underline hover:border-muted"
        >
          Profile
        </Link>
      </div>

      <dl
        aria-label={`Head-to-head: ${headToHeadText(h)}`}
        className="m-0 grid grid-cols-3 gap-2 text-center"
      >
        {(
          [
            ["Your wins", h.wins, "text-you"],
            ["Their wins", h.losses, "text-rival"],
            ["Draws", h.draws, ""],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="flex flex-col-reverse border border-line bg-ground py-2">
            <dt className="text-[11px] tracking-[0.12em] text-muted uppercase">{label}</dt>
            <dd className={`m-0 font-display text-3xl font-bold ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label={`Challenge ${friend.username}`} className="flex flex-col gap-3">
        <h3 className="m-0 text-xs font-normal tracking-[0.14em] text-muted uppercase">
          Challenge {friend.username}
        </h3>
        <DifficultyChooser value={difficulty} onChange={setDifficulty} />
        <MinutesChooser value={minutes} onChange={setMinutes} />
        <button
          type="button"
          disabled={busy || presence !== "online"}
          onClick={() => void send()}
          className="cut h-14 w-full cursor-pointer border-0 bg-rival font-display text-lg font-bold tracking-widest text-ground uppercase shadow-[0_0_24px_rgba(255,46,154,0.35)] disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted disabled:shadow-none"
        >
          {busy ? "Sending…" : "⚔ Send challenge"}
        </button>
        <p className="m-0 flex items-center justify-center gap-2 text-sm text-muted">
          {presence === "online" ? (
            <>
              <UnratedBadge /> They have 30 seconds to accept.
            </>
          ) : presence === "battle" ? (
            `${friend.username} is in a battle. Try again when they're done.`
          ) : (
            `${friend.username} is offline. Challenges need both of you online.`
          )}
        </p>
        {error ? (
          <p role="alert" className="m-0 text-rival">
            {error}
          </p>
        ) : null}
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        {confirming ? (
          <>
            <span className="mr-auto text-sm text-soft">Remove {friend.username}?</span>
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
            className="h-10 cursor-pointer border-0 bg-transparent px-2 font-display text-sm font-semibold tracking-widest text-rival/80 uppercase hover:text-rival"
          >
            Remove friend
          </button>
        )}
      </div>
    </div>
  );
}

/** Phones and tablets: the friend's details slide up from the bottom. */
function FriendSheet({
  children,
  label,
  onClose,
  focusRef,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  focusRef: RefObject<HTMLHeadingElement | null>;
}) {
  useEffect(() => {
    focusRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [focusRef, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-pointer border-0 bg-ground/70"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto border-t-2 border-rival bg-panel px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-20px_40px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-2 flex items-center justify-between">
          <span aria-hidden="true" className="mx-auto h-1 w-11 rounded bg-line-strong" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2 right-3 h-9 w-9 cursor-pointer border border-line-strong bg-transparent text-soft"
          >
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List rows
// ---------------------------------------------------------------------------
function FriendRow({
  friend,
  presence,
  selected,
  onOpen,
}: {
  friend: Friend;
  presence: Presence;
  selected: boolean;
  onOpen: () => void;
}) {
  const p = PRESENCE[presence];
  return (
    <li
      className={`flex items-center gap-3 border-b border-line/60 py-2 ${
        selected ? "-mx-2 border border-you bg-you/5 px-2" : ""
      } ${presence === "offline" ? "opacity-75" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${friend.username}, ${p.label}, ${friend.rating}, ${headToHeadText(friend.headToHead)}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-ink"
      >
        <span className="relative flex-none">
          <Avatar id={friend.avatar} size={44} decorative />
          <span
            aria-hidden="true"
            className={`absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-ground ${p.dot}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg leading-tight font-bold">
            {friend.username}
          </span>
          <span className="block font-mono text-xs text-muted">
            {friend.rating} ·{" "}
            {presence === "battle" ? "In a battle" : headToHeadText(friend.headToHead)}
          </span>
        </span>
      </button>
      {presence === "online" ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Challenge ${friend.username}`}
          className="h-10 flex-none cursor-pointer border-0 bg-rival px-3 font-display text-xs font-bold tracking-widest text-ground uppercase shadow-[0_0_16px_rgba(255,46,154,0.35)]"
        >
          ⚔ Challenge
        </button>
      ) : presence === "battle" ? (
        <span className="flex h-10 flex-none items-center border border-line-strong px-3 font-display text-xs font-bold tracking-widest text-muted uppercase">
          Busy
        </span>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`More about ${friend.username}`}
          className="h-10 w-10 flex-none cursor-pointer border border-line bg-transparent text-muted"
        >
          ⋯
        </button>
      )}
    </li>
  );
}

const GROUPS: { key: Presence; title: string; icon: string }[] = [
  { key: "online", title: "Online", icon: "●" },
  { key: "battle", title: "In a battle", icon: "●" },
  { key: "offline", title: "Offline", icon: "○" },
];

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
type Tab = "friends" | "requests" | "sent";

/** /friends — search, tabs (Friends · Requests · Sent), friends grouped by who can play now. */
export function FriendsPage() {
  const { api } = useServices();
  const { version, refresh: refreshNotifications } = useNotifications();
  const online = useOnlineUsers();
  const wide = useMediaQuery(WIDE_QUERY);
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<FriendList | "loading" | "error">("loading");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("friends");
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("challenge"));
  const [sheetOpen, setSheetOpen] = useState(params.get("challenge") !== null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

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

  const friends = Array.isArray((list as FriendList).friends) ? (list as FriendList).friends : [];
  const filter = query.trim().toLowerCase();
  const shown = useMemo(
    () => friends.filter((f) => f.username.toLowerCase().includes(filter)),
    [friends, filter],
  );
  const grouped = GROUPS.map((g) => ({
    ...g,
    friends: shown.filter((f) => presenceOf(f, online) === g.key),
  }));
  const onlineCount = friends.filter((f) => presenceOf(f, online) === "online").length;

  // On wide screens the panel always shows someone: the chosen friend, else
  // the first who can play, else the first in the list.
  const selected =
    friends.find((f) => f.userId === selectedId) ??
    (wide ? (grouped.find((g) => g.friends.length > 0)?.friends[0] ?? null) : null);

  function open(friend: Friend) {
    setSelectedId(friend.userId);
    setSheetOpen(true);
    if (params.get("challenge")) setParams({}, { replace: true });
  }
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    if (params.get("challenge")) setParams({}, { replace: true });
  }, [params, setParams]);

  async function answer(userId: string, accept: boolean) {
    try {
      await api.respondFriendRequest(userId, accept);
    } finally {
      await load();
      void refreshNotifications();
    }
  }

  const incoming = list !== "loading" && list !== "error" ? list.incoming : [];
  const outgoing = list !== "loading" && list !== "error" ? list.outgoing : [];

  const details = selected ? (
    <FriendDetails
      key={selected.userId}
      friend={selected}
      presence={presenceOf(selected, online)}
      titleRef={titleRef}
      onSent={() => setSheetOpen(false)}
      onRemoved={() => {
        setSelectedId(null);
        setSheetOpen(false);
        void load();
      }}
    />
  ) : null;

  const listColumn = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="m-0 font-display text-4xl leading-none font-bold tracking-wider uppercase italic md:text-5xl">
          Friends
        </h1>
        {list !== "loading" && list !== "error" ? (
          <span className="font-mono text-xs text-muted">
            <span className="text-[#5CF2C2]">●</span> {onlineCount} online
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="friend-search" className="sr-only">
          Search friends or find players
        </label>
        <div className="flex h-12 items-center gap-2 border border-line-strong bg-ground px-3 focus-within:border-you">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="flex-none text-muted"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="friend-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMessage(null);
            }}
            placeholder="Search friends or find players"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none"
          />
        </div>
        {message ? (
          <p role="status" className="m-0 text-sm text-you">
            {message}
          </p>
        ) : null}
        <PlayerSuggestions
          query={query}
          onChanged={(text) => {
            setMessage(text);
            void load();
            void refreshNotifications();
          }}
        />
      </div>

      <div role="tablist" aria-label="Friends sections" className="flex border-b border-line">
        {(
          [
            ["friends", `Friends · ${friends.length}`],
            ["requests", "Requests"],
            ["sent", `Sent · ${outgoing.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 border-0 border-b-2 bg-transparent font-display text-sm font-semibold tracking-[0.1em] uppercase ${
              tab === key ? "border-you text-you" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
            {key === "requests" && incoming.length > 0 ? (
              <span className="rounded-full bg-rival px-1.5 font-mono text-[11px] font-bold text-ground">
                {incoming.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {list === "loading" ? (
        <p role="status" className="m-0 text-muted">
          Loading friends…
        </p>
      ) : list === "error" ? (
        <p role="alert" className="m-0 text-rival">
          Could not load your friends. Try again in a moment.
        </p>
      ) : tab === "friends" ? (
        <div role="tabpanel" aria-label="Your friends" className="flex flex-col">
          {friends.length === 0 ? (
            <p className="m-0 py-2 text-soft">
              No friends yet. Search for a player above, or press Add friend on a player's profile
              (for example from the{" "}
              <Link to="/rankings" className="text-you">
                rankings
              </Link>
              ).
            </p>
          ) : shown.length === 0 ? (
            <p className="m-0 py-2 text-muted">No friends match “{query.trim()}”.</p>
          ) : (
            grouped
              .filter((g) => g.friends.length > 0)
              .map((g) => (
                <section key={g.key} aria-label={`${g.title} · ${g.friends.length}`}>
                  <h2 className="m-0 pt-3 pb-1 text-[11px] font-normal tracking-[0.16em] text-muted uppercase">
                    <span className={PRESENCE[g.key].text}>{g.icon}</span> {g.title} ·{" "}
                    {g.friends.length}
                  </h2>
                  <ul className="m-0 list-none p-0">
                    {g.friends.map((friend) => (
                      <FriendRow
                        key={friend.userId}
                        friend={friend}
                        presence={g.key}
                        selected={wide && selected?.userId === friend.userId}
                        onOpen={() => open(friend)}
                      />
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>
      ) : tab === "requests" ? (
        <div role="tabpanel" aria-label="Friend requests" className="flex flex-col">
          {incoming.length === 0 ? (
            <p className="m-0 py-2 text-muted">No friend requests right now.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {incoming.map((p) => (
                <li key={p.userId} className="flex items-center gap-3 border-b border-line/60 py-2">
                  <Avatar id={p.avatar} size={40} decorative />
                  <Link
                    to={`/u/${p.username}`}
                    className="min-w-0 flex-1 truncate font-bold text-ink no-underline"
                  >
                    {p.username}
                  </Link>
                  <span className="font-mono text-xs text-muted">{p.rating}</span>
                  <Button className="h-10 px-4" onClick={() => void answer(p.userId, true)}>
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-10 px-3"
                    onClick={() => void answer(p.userId, false)}
                  >
                    Decline
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Requests you sent" className="flex flex-col">
          {outgoing.length === 0 ? (
            <p className="m-0 py-2 text-muted">No requests waiting for an answer.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {outgoing.map((p) => (
                <li key={p.userId} className="flex items-center gap-3 border-b border-line/60 py-2">
                  <Avatar id={p.avatar} size={36} decorative />
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
          )}
        </div>
      )}
    </div>
  );

  if (wide) {
    return (
      <main className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,480px)_minmax(0,1fr)] items-start gap-8 px-[5%] py-8">
        {listColumn}
        <aside aria-label="Friend details" className="sticky top-6 border border-line bg-panel p-6">
          {details ?? (
            <p className="m-0 text-muted">
              Choose a friend to see your head-to-head and challenge them.
            </p>
          )}
        </aside>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 py-5">
      {listColumn}
      {sheetOpen && selected ? (
        <FriendSheet label={selected.username} onClose={closeSheet} focusRef={titleRef}>
          {details}
        </FriendSheet>
      ) : null}
    </main>
  );
}
