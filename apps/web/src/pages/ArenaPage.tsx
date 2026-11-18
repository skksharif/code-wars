import { LIMITS, matchWindow } from "@code-wars/shared";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CustomPanel } from "../rooms/CustomPanel";
import { useAuth } from "../auth/AuthContext";
import { formatClock } from "../battle/useBattle";
import { Button } from "../components/ui";
import { ApiError, type GameMode } from "../lib/api";
import { useServices } from "../services";
import { Avatar } from "../components/Avatar";
import { OnlineBadge } from "../lib/online";
import { nextTier, tierFor } from "../lib/tiers";
import { PHONE_QUERY, useMediaQuery } from "../lib/useMediaQuery";

type Search =
  | { status: "checking" }
  | { status: "idle"; notice?: string; error?: string }
  | { status: "searching"; startedAt: number; waitedMs: number };

export function ArenaPage() {
  const { profile } = useAuth();
  const { api, timing } = useServices();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const phone = useMediaQuery(PHONE_QUERY);
  const [search, setSearch] = useState<Search>({ status: "checking" });
  const [now, setNow] = useState(() => Date.now());
  const searching = search.status === "searching";
  const searchingRef = useRef(false);
  searchingRef.current = searching;
  const modeParam = params.get("mode");
  const mode: ArenaMode = modeParam === "custom" || modeParam === "blitz" ? modeParam : "ranked";
  const game: GameMode = mode === "blitz" ? "blitz" : "standard";
  const blitz = game === "blitz";

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
      const result = await api.joinMatchmaking(game);
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
  }, [api, navigate, game]);

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

  function setMode(next: ArenaMode) {
    if (next === mode) return;
    if (searching) void cancel();
    setParams(next === "ranked" ? {} : { mode: next }, { replace: true });
  }
  const tabs = <ModeTabs mode={mode} onChange={setMode} />;

  if (mode === "custom") {
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:px-[5%] md:py-10">
        {tabs}
        <CustomPanel />
      </main>
    );
  }

  const record = profile ? (blitz ? profile.blitz : profile) : null;
  const rating = record?.rating ?? LIMITS.initialRating;
  const findLabel = blitz ? "Find Blitz" : "Find Battle";
  const caption = blitz ? "Blitz · Easy · 5 minutes" : "Ranked · one problem · 15 minutes";
  const elapsedMs = searching ? Math.max(0, now - search.startedAt) : 0;
  const range = searching ? matchWindow(search.waitedMs) : LIMITS.matchWindowStart;
  const start = () => setSearch({ status: "searching", startedAt: Date.now(), waitedMs: 0 });

  const messages = (
    <>
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
    </>
  );

  if (phone) {
    return (
      <PhoneArena
        tabs={tabs}
        blitz={blitz}
        rating={rating}
        record={record}
        searching={searching}
        checking={search.status === "checking"}
        elapsedMs={elapsedMs}
        range={range}
        onStart={start}
        onCancel={() => void cancel()}
      >
        {messages}
      </PhoneArena>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 md:gap-8 md:px-[5%] md:py-10">
      {tabs}
      <div className="flex justify-center">
        <OnlineBadge />
      </div>
      <section className="flex flex-wrap items-stretch justify-center gap-5 md:gap-8">
        <div
          className={`flex max-w-sm min-w-0 flex-1 basis-72 flex-col gap-2 border bg-panel p-5 md:p-7 ${
            blitz ? "glow-gold border-gold" : "glow-you border-you"
          }`}
        >
          <p
            className={`m-0 font-mono text-xs tracking-widest uppercase ${blitz ? "text-gold" : "text-you"}`}
          >
            {blitz ? "You · Blitz rating" : "You"}
          </p>
          <h1 className="m-0 flex min-w-0 items-center gap-3 font-display text-3xl font-bold break-all md:text-4xl">
            {profile ? <Avatar id={profile.avatar} size={56} frame="#22E6FF" decorative /> : null}
            {profile?.username ?? "Player"}
          </h1>
          <p
            className={`m-0 font-display text-6xl leading-none font-bold md:text-7xl ${
              blitz ? "text-glow-gold text-gold" : "text-glow-you text-you"
            }`}
          >
            {rating}
          </p>
          {record ? (
            <p className="m-0 font-mono text-muted">
              {record.wins} W · {record.losses} L · {record.draws} D
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 basis-72 flex-col items-center justify-center gap-4 text-center md:gap-5">
          <p
            className="m-0 font-display text-5xl leading-none font-bold italic md:text-7xl"
            aria-hidden="true"
          >
            VS
          </p>
          {searching ? (
            <Button variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          ) : (
            <Button
              variant={blitz ? "gold" : "primary"}
              className="h-[72px] px-12 text-2xl"
              disabled={search.status === "checking"}
              onClick={start}
            >
              {blitz ? "⚡ " : ""}
              {findLabel}
            </Button>
          )}
          <p className="m-0 text-sm text-muted">{caption}</p>
        </div>

        <div
          className={`flex max-w-sm min-w-0 flex-1 basis-72 flex-col gap-2 border bg-panel p-5 text-right md:p-7 ${
            searching ? "border-rival glow-rival" : "border-dashed border-line-strong"
          }`}
        >
          <p className="m-0 font-mono text-xs tracking-widest text-rival uppercase">
            {searching ? "Opponent · searching" : "Opponent"}
          </p>
          <p className="m-0 font-display text-4xl font-bold text-muted">? ? ?</p>
          {searching ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="text-glow-rival m-0 font-display text-6xl leading-none font-bold text-rival md:text-7xl">
                {formatClock(elapsedMs)}
              </p>
              <p className="m-0 font-mono text-muted">
                Searching rating {rating - range} to {rating + range}
              </p>
            </div>
          ) : (
            <p className="m-0 font-mono text-muted">Press {findLabel} to search.</p>
          )}
        </div>
      </section>

      {messages}
    </main>
  );
}

type ArenaMode = "ranked" | "blitz" | "custom";

const MODE_LABELS: Record<ArenaMode, string> = {
  ranked: "Ranked",
  blitz: "⚡ Blitz",
  custom: "Custom",
};

/** Ranked (by rating), Blitz (5 minutes, its own rating) or Custom (a room with a friend). */
function ModeTabs({ mode, onChange }: { mode: ArenaMode; onChange: (mode: ArenaMode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Match type"
      className="mx-auto flex w-full max-w-xl border-b border-line"
    >
      {(["ranked", "blitz", "custom"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => onChange(key)}
          className={`h-12 flex-1 cursor-pointer border-0 border-b-2 bg-transparent font-display text-base font-bold tracking-[0.14em] uppercase ${
            mode !== key
              ? "border-transparent text-muted hover:text-ink"
              : key === "blitz"
                ? "border-gold text-gold"
                : "border-you text-you"
          }`}
        >
          {MODE_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

function BoltIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 2 4.5 13.5h6.5L9.5 22 19.5 9.5H13z" fill="currentColor" />
    </svg>
  );
}

const HEXAGON = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

function BracketsIcon() {
  return (
    <svg width="56" height="38" viewBox="0 0 46 30" aria-hidden="true">
      <path d="M17 4 6 15l11 11" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M29 4l11 11-11 11" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M26 2 19 16h6l-5 12 9-15h-6z" fill="currentColor" />
    </svg>
  );
}

/**
 * The arena on phones (design option B): a slim strip with your rating and
 * progress to the next tier, then one big hexagon button. While searching the
 * hexagon turns pink and shows the time spent looking, with Cancel below.
 */
function PhoneArena({
  tabs,
  blitz,
  rating,
  record,
  searching,
  checking,
  elapsedMs,
  range,
  onStart,
  onCancel,
  children,
}: {
  tabs: ReactNode;
  blitz: boolean;
  rating: number;
  record: { wins: number; losses: number; draws: number } | null;
  searching: boolean;
  checking: boolean;
  elapsedMs: number;
  range: number;
  onStart: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { profile } = useAuth();
  const tier = tierFor(rating);
  const next = nextTier(rating);
  // Bronze has no lower bound; measure it from 200 below Silver.
  const floor = Number.isFinite(tier.min) ? tier.min : (next?.tier.min ?? rating) - 200;
  const progress = next ? Math.min(1, Math.max(0, (rating - floor) / (next.tier.min - floor))) : 1;

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      {tabs}
      <section
        aria-label="Your rating"
        className="flex flex-col gap-2.5 border border-line bg-panel px-4 py-3.5"
      >
        <div className="flex items-center gap-3">
          {profile ? <Avatar id={profile.avatar} size={48} frame={tier.color} decorative /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate font-display text-xl leading-tight font-bold">
              {profile?.username ?? "Player"}
            </h1>
            {record ? (
              <p className="m-0 font-mono text-xs text-muted">
                {blitz ? "Blitz · " : ""}
                {record.wins} W · {record.losses} L · {record.draws} D
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`font-display text-4xl leading-none font-bold ${
                blitz ? "text-glow-gold text-gold" : "text-glow-you text-you"
              }`}
              aria-label={`${blitz ? "Blitz rating" : "Rating"} ${rating}`}
            >
              {rating}
            </span>
            <span
              className="px-2 font-display text-[11px] font-bold tracking-[0.16em] text-ground uppercase"
              style={{ background: tier.color }}
            >
              {tier.name}
            </span>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={next ? `Progress to ${next.tier.name}` : "Top tier reached"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="h-1.5 bg-line"
        >
          <div className="h-1.5" style={{ width: `${progress * 100}%`, background: tier.color }} />
        </div>
        <p className="m-0 flex justify-between font-mono text-xs text-muted">
          <span>
            {tier.name}
            {Number.isFinite(tier.min) ? ` ${tier.min}` : ""}
          </span>
          <span>{next ? `${next.pointsNeeded} to ${next.tier.name}` : "Top tier"}</span>
        </p>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center gap-4 py-2">
        <OnlineBadge />
        {searching ? (
          <div
            role="status"
            className="drop-shadow-[0_0_28px_rgba(255,46,154,0.55)]"
            aria-label={`Searching for an opponent, ${formatClock(elapsedMs)}`}
          >
            <div
              className="flex h-[254px] w-[230px] flex-col items-center justify-center gap-1 bg-rival text-ground"
              style={{ clipPath: HEXAGON }}
            >
              <span className="font-display text-sm font-bold tracking-[0.2em] uppercase">
                Searching
              </span>
              <span className="font-display text-5xl leading-none font-bold">
                {formatClock(elapsedMs)}
              </span>
            </div>
          </div>
        ) : (
          <div
            className={`focus-within:drop-shadow-[0_0_6px_#ffffff] ${
              blitz
                ? "drop-shadow-[0_0_28px_rgba(255,200,61,0.55)]"
                : "drop-shadow-[0_0_28px_rgba(34,230,255,0.55)]"
            }`}
          >
            <button
              type="button"
              aria-label={blitz ? "Find Blitz" : "Find Battle"}
              onClick={onStart}
              disabled={checking}
              className={`flex h-[254px] w-[230px] cursor-pointer flex-col items-center justify-center gap-1.5 border-0 text-ground transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                blitz ? "bg-gold" : "bg-you"
              }`}
              style={{ clipPath: HEXAGON }}
            >
              {blitz ? <BoltIcon /> : <BracketsIcon />}
              <span className="text-center font-display text-3xl leading-[1.05] font-bold tracking-[0.1em] uppercase">
                Find
                <br />
                {blitz ? "Blitz" : "Battle"}
              </span>
            </button>
          </div>
        )}

        {searching ? (
          <>
            <p className="m-0 text-center font-mono text-sm text-muted">
              Searching rating {rating - range} to {rating + range}
            </p>
            <Button variant="ghost" className="w-full max-w-[230px]" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <p className="m-0 text-center text-sm text-muted">
            {blitz ? "Blitz · Easy · 5 minutes" : "Ranked · one problem · 15 minutes"}
            <br />
            Opponent within ± {range} rating
          </p>
        )}
        {children}
      </section>
    </main>
  );
}
