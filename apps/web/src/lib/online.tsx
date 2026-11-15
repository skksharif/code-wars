import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { useServices } from "../services";

/** Players connected right now, or null until the first count arrives. */
const OnlineContext = createContext<number | null>(null);

/**
 * While someone is signed in, keeps them in the site-wide lobby (whatever page
 * they are on, battles included) and shares how many players are online.
 */
export function OnlineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { live } = useServices();
  const [count, setCount] = useState<number | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    setCount(null);
    if (!userId) return;
    return live.joinLobby(userId, setCount);
  }, [live, userId]);

  return <OnlineContext.Provider value={count}>{children}</OnlineContext.Provider>;
}

export function useOnlineCount(): number | null {
  return useContext(OnlineContext);
}

/** A small "● 3 players online" badge. Hidden until the count is known. */
export function OnlineBadge({ className = "" }: { className?: string }) {
  const count = useOnlineCount();
  if (count === null || count < 1) return null;
  return (
    <p
      aria-label={`${count} ${count === 1 ? "player" : "players"} online`}
      className={`m-0 inline-flex items-center gap-2 border border-line bg-panel px-3 py-1.5 font-mono text-sm text-soft ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-you opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-you" />
      </span>
      <span>
        <b className="text-you">{count}</b> {count === 1 ? "player" : "players"} online
      </span>
    </p>
  );
}
