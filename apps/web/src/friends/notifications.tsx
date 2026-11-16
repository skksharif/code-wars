import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { formatClock } from "../battle/useBattle";
import { Avatar } from "../components/Avatar";
import { ApiError, type Challenge, type Notifications } from "../lib/api";
import { settingsText } from "../rooms/parts";
import { useServices } from "../services";

interface NotificationsState {
  data: Notifications | null;
  /** Bumps on every change, so pages showing friends can reload. */
  version: number;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState>({
  data: null,
  version: 0,
  refresh: async () => undefined,
});

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}

/**
 * Keeps friend requests and challenges current for the signed-in player (live
 * updates, plus a slow poll as a fallback) and shows the challenge pop-ups.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { api, live, timing } = useServices();
  const [data, setData] = useState<Notifications | null>(null);
  const [version, setVersion] = useState(0);
  const userId = user?.id ?? null;

  const refresh = useCallback(async () => {
    try {
      setData(await api.getNotifications());
      setVersion((v) => v + 1);
    } catch {
      // Keep the last known state through a temporary failure.
    }
  }, [api]);

  useEffect(() => {
    setData(null);
    if (!userId) return;
    void refresh();
    const stop = live.watchNotifications(userId, () => void refresh());
    const poll = setInterval(() => void refresh(), timing.pollMs);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [live, refresh, timing.pollMs, userId]);

  return (
    <NotificationsContext.Provider value={{ data, version, refresh }}>
      {children}
      {userId && data ? <ChallengePopups data={data} refresh={refresh} /> : null}
    </NotificationsContext.Provider>
  );
}

/** Seconds left on a challenge, by the server's clock. */
function useCountdown(challenge: Challenge): number {
  const [offset] = useState(() => Date.parse(challenge.serverTime) - Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  return Math.max(0, Date.parse(challenge.expiresAt) - (now + offset));
}

const ENDED_TEXT: Record<string, (name: string) => string> = {
  declined: (name) => `${name} declined your challenge.`,
  expired: (name) => `No answer from ${name}.`,
  challenged_busy: (name) => `${name} started another battle.`,
  challenger_busy: () => "Your challenge was cancelled because you started another battle.",
  unfriended: () => "Your challenge was cancelled.",
};

function endedText(challenge: Challenge): string | null {
  const name = challenge.challenged.username;
  if (challenge.status === "declined" || challenge.status === "expired") {
    return ENDED_TEXT[challenge.status]!(name);
  }
  if (challenge.status === "cancelled" && challenge.cancelReason !== "withdrawn") {
    return ENDED_TEXT[challenge.cancelReason ?? "unfriended"]!(name);
  }
  return null;
}

function ChallengePopups({ data, refresh }: { data: Notifications; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const handled = useRef(new Set<string>());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const outgoing = data.outgoingChallenge;

  // Your challenge was accepted: into the battle.
  useEffect(() => {
    if (outgoing?.status === "accepted" && outgoing.battleId && !handled.current.has(outgoing.id)) {
      handled.current.add(outgoing.id);
      if (!pathname.startsWith(`/battle/${outgoing.battleId}`)) {
        navigate(`/battle/${outgoing.battleId}`);
      }
    }
  }, [outgoing, navigate, pathname]);

  const incoming = data.incomingChallenges.filter((c) => !dismissed.has(c.id));
  const ended = outgoing && !dismissed.has(outgoing.id) ? endedText(outgoing) : null;
  const waiting = outgoing?.status === "pending" && !dismissed.has(outgoing.id) ? outgoing : null;
  if (incoming.length === 0 && !ended && !waiting) return null;

  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex flex-col items-center gap-2 px-4">
      {incoming.map((c) => (
        <IncomingChallenge
          key={c.id}
          challenge={c}
          refresh={refresh}
          onClose={() => dismiss(c.id)}
        />
      ))}
      {waiting ? <WaitingChallenge challenge={waiting} refresh={refresh} /> : null}
      {ended && outgoing ? (
        <p
          role="status"
          className="pointer-events-auto m-0 flex w-full max-w-md items-center justify-between gap-3 border border-line-strong bg-panel px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.7)]"
        >
          <span>{ended}</span>
          <button
            type="button"
            onClick={() => dismiss(outgoing.id)}
            className="h-9 cursor-pointer border border-line-strong bg-transparent px-3 font-display text-xs font-semibold tracking-widest text-soft uppercase"
          >
            OK
          </button>
        </p>
      ) : null}
    </div>
  );
}

function IncomingChallenge({
  challenge,
  refresh,
  onClose,
}: {
  challenge: Challenge;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { api } = useServices();
  const navigate = useNavigate();
  const left = useCountdown(challenge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.respondChallenge(challenge.id, accept);
      if (accept && result.status === "accepted" && result.battleId) {
        onClose();
        navigate(`/battle/${result.battleId}`);
      } else if (accept) {
        setError(`${challenge.challenger.username} started another battle.`);
      } else {
        onClose();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not answer the challenge.");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  if (left <= 0 && !error) return null;

  return (
    <section
      aria-label={`Challenge from ${challenge.challenger.username}`}
      aria-live="assertive"
      className="pointer-events-auto flex w-full max-w-md flex-col gap-3 border border-rival bg-panel p-4 shadow-[0_0_30px_rgba(255,46,154,0.35),0_12px_40px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center gap-3">
        <Avatar id={challenge.challenger.avatar} size={44} frame="#FF2E9A" decorative />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-display text-lg font-bold">
            ⚔ <span className="text-rival">{challenge.challenger.username}</span> challenges you
          </p>
          <p className="m-0 text-sm text-soft">
            {settingsText(challenge)} · unrated · {formatClock(left)} to answer
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-rival">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || left <= 0}
          onClick={() => void answer(true)}
          className="cut glow-you h-11 flex-1 cursor-pointer border-0 bg-you font-display font-bold tracking-widest text-ground uppercase disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (error ? onClose() : void answer(false))}
          className="h-11 flex-1 cursor-pointer border border-line-strong bg-transparent font-display font-semibold tracking-widest text-ink uppercase disabled:opacity-50"
        >
          {error ? "Close" : "Decline"}
        </button>
      </div>
    </section>
  );
}

function WaitingChallenge({
  challenge,
  refresh,
}: {
  challenge: Challenge;
  refresh: () => Promise<void>;
}) {
  const { api } = useServices();
  const left = useCountdown(challenge);
  // The server expires it; look again when our clock says time is up.
  useEffect(() => {
    if (left > 0) return;
    const again = setTimeout(() => void refresh(), 1000);
    return () => clearTimeout(again);
  }, [left, refresh]);

  return (
    <p
      role="status"
      className="pointer-events-auto m-0 flex w-full max-w-md items-center justify-between gap-3 border border-you bg-panel px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.7)]"
    >
      <span>
        Waiting for <b>{challenge.challenged.username}</b> to accept… {formatClock(left)}
      </span>
      <button
        type="button"
        onClick={() => void api.cancelChallenge(challenge.id).finally(() => void refresh())}
        className="h-9 cursor-pointer border border-line-strong bg-transparent px-3 font-display text-xs font-semibold tracking-widest text-soft uppercase"
      >
        Cancel
      </button>
    </p>
  );
}
