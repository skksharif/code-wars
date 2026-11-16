import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui";
import { ApiError, type FriendStatus } from "../lib/api";
import { useOnlineUsers } from "../lib/online";
import { headToHeadText } from "./format";
import { useServices } from "../services";
import { useNotifications } from "./notifications";

/** On another player's profile: add, answer, or challenge them. */
export function FriendButton({ username }: { username: string }) {
  const { api } = useServices();
  const { version, refresh: refreshNotifications } = useNotifications();
  const online = useOnlineUsers();
  const [status, setStatus] = useState<FriendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.getFriendStatus(username));
    } catch {
      setStatus(null);
    }
  }, [api, username]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      await load();
      void refreshNotifications();
    }
  }

  if (!status || status.status === "self") return null;
  const isOnline = online?.has(status.userId) ?? false;

  return (
    <section
      aria-label="Friendship"
      className="flex flex-col gap-2 border border-line bg-panel p-3"
    >
      {status.status === "none" ? (
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void act(() => api.sendFriendRequest(username))}
        >
          + Add friend
        </Button>
      ) : status.status === "outgoing" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-soft">Friend request sent</span>
          <Button
            variant="ghost"
            className="h-10 px-4"
            disabled={busy}
            onClick={() => void act(() => api.removeFriend(status.userId))}
          >
            Cancel
          </Button>
        </div>
      ) : status.status === "incoming" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-soft">{username} wants to be friends</span>
          <Button
            className="h-10 px-4"
            disabled={busy}
            onClick={() => void act(() => api.respondFriendRequest(status.userId, true))}
          >
            Accept
          </Button>
          <Button
            variant="ghost"
            className="h-10 px-4"
            disabled={busy}
            onClick={() => void act(() => api.respondFriendRequest(status.userId, false))}
          >
            Decline
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-you">✓ Friends</span>
          {status.inBattle ? (
            <span className="text-sm text-muted">In a battle</span>
          ) : isOnline ? (
            <Link
              to={`/friends?challenge=${status.userId}`}
              className="inline-flex h-10 items-center border border-rival px-4 font-display text-sm font-semibold tracking-widest text-rival uppercase no-underline hover:bg-rival/10"
            >
              ⚔ Challenge
            </Link>
          ) : (
            <span className="text-sm text-muted">Offline</span>
          )}
        </div>
      )}
      <p className="m-0 font-mono text-xs text-muted">
        Head-to-head: {headToHeadText(status.headToHead)}
      </p>
      {error ? (
        <p role="alert" className="m-0 text-sm text-rival">
          {error}
        </p>
      ) : null}
    </section>
  );
}
