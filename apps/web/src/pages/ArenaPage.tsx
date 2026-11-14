import { LIMITS, matchWindow } from "@code-wars/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { formatClock } from "../battle/useBattle";
import { Button } from "../components/ui";
import { ApiError } from "../lib/api";
import { useServices } from "../services";

type Search =
  | { status: "checking" }
  | { status: "idle"; notice?: string; error?: string }
  | { status: "searching"; startedAt: number; waitedMs: number };

export function ArenaPage() {
  const { profile } = useAuth();
  const { api, timing } = useServices();
  const navigate = useNavigate();
  const [search, setSearch] = useState<Search>({ status: "checking" });
  const [now, setNow] = useState(() => Date.now());
  const searching = search.status === "searching";
  const searchingRef = useRef(false);
  searchingRef.current = searching;

  // Resume a battle in progress (for example after a reload).
  useEffect(() => {
    let active = true;
    api.getActiveBattle().then(
      (battleId) => {
        if (!active) return;
        if (battleId) navigate(`/battle/${battleId}`, { replace: true });
        else setSearch({ status: "idle" });
      },
      () => active && setSearch({ status: "idle" }),
    );
    return () => {
      active = false;
    };
  }, [api, navigate]);

  const heartbeat = useCallback(async () => {
    try {
      const result = await api.joinMatchmaking();
      if (!searchingRef.current) return;
      if (result.status === "matched") {
        searchingRef.current = false;
        navigate(`/battle/${result.battleId}`);
      } else if (result.status === "timeout") {
        setSearch({ status: "idle", notice: "No opponent found this time. Try again." });
      } else {
        setSearch((current) =>
          current.status === "searching" ? { ...current, waitedMs: result.waitedMs } : current,
        );
      }
    } catch (caught) {
      if (!searchingRef.current) return;
      setSearch({
        status: "idle",
        error: caught instanceof ApiError ? caught.message : "Something went wrong.",
      });
    }
  }, [api, navigate]);

  useEffect(() => {
    if (!searching) return;
    void heartbeat();
    const beat = setInterval(() => void heartbeat(), timing.heartbeatMs);
    const tick = setInterval(() => setNow(Date.now()), timing.tickMs);
    return () => {
      clearInterval(beat);
      clearInterval(tick);
    };
  }, [searching, heartbeat, timing]);

  // Leave the queue if the player navigates away mid-search.
  useEffect(
    () => () => {
      if (searchingRef.current) void api.cancelMatchmaking().catch(() => undefined);
    },
    [api],
  );

  async function cancel() {
    setSearch({ status: "idle" });
    try {
      await api.cancelMatchmaking();
    } catch {
      // The queue entry expires by itself within seconds.
    }
  }

  const rating = profile?.rating ?? LIMITS.initialRating;
  const elapsedMs = searching ? Math.max(0, now - search.startedAt) : 0;
  const range = searching ? matchWindow(search.waitedMs) : LIMITS.matchWindowStart;

  return (
    <main className="flex flex-1 flex-col justify-center gap-8 px-[5%] py-12">
      <section className="flex flex-wrap items-stretch justify-center gap-8">
        <div className="glow-you flex max-w-sm min-w-0 flex-1 basis-72 flex-col gap-2 border border-you bg-panel p-7">
          <p className="m-0 font-mono text-xs tracking-widest text-you uppercase">You</p>
          <h1 className="m-0 font-display text-4xl font-bold">{profile?.username ?? "Player"}</h1>
          <p className="text-glow-you m-0 font-display text-7xl leading-none font-bold text-you">
            {rating}
          </p>
          {profile ? (
            <p className="m-0 font-mono text-muted">
              {profile.wins} W · {profile.losses} L · {profile.draws} D
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 basis-72 flex-col items-center justify-center gap-5 text-center">
          <p className="m-0 font-display text-7xl leading-none font-bold italic" aria-hidden="true">
            VS
          </p>
          {searching ? (
            <Button variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          ) : (
            <Button
              className="h-[72px] px-12 text-2xl"
              disabled={search.status === "checking"}
              onClick={() => setSearch({ status: "searching", startedAt: Date.now(), waitedMs: 0 })}
            >
              Find Battle
            </Button>
          )}
          <p className="m-0 text-sm text-muted">Ranked · one problem · 15 minutes</p>
        </div>

        <div
          className={`flex max-w-sm min-w-0 flex-1 basis-72 flex-col gap-2 border bg-panel p-7 text-right ${
            searching ? "border-rival glow-rival" : "border-dashed border-line-strong"
          }`}
        >
          <p className="m-0 font-mono text-xs tracking-widest text-rival uppercase">
            {searching ? "Opponent · searching" : "Opponent"}
          </p>
          <p className="m-0 font-display text-4xl font-bold text-muted">? ? ?</p>
          {searching ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-glow-rival m-0 font-display text-7xl leading-none font-bold text-rival">
                {formatClock(elapsedMs)}
              </p>
              <p className="m-0 font-mono text-muted">
                Searching rating {rating - range} to {rating + range}
              </p>
            </div>
          ) : (
            <p className="m-0 font-mono text-muted">Press Find Battle to search.</p>
          )}
        </div>
      </section>

      {search.status === "idle" && search.notice ? (
        <p role="status" className="m-0 text-center text-soft">
          {search.notice}
        </p>
      ) : null}
      {search.status === "idle" && search.error ? (
        <p role="alert" className="m-0 text-center text-rival">
          {search.error}
        </p>
      ) : null}
    </main>
  );
}
