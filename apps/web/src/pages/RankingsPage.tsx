import { useEffect, useState } from "react";
import { BlitzMark } from "../components/BlitzMark";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { GameMode } from "../lib/api";
import type { LeaderboardEntry } from "../lib/live";
import { useServices } from "../services";
import { Avatar } from "../components/Avatar";

const TOP = 50;

const record = (entry: LeaderboardEntry) => `${entry.wins} W ${entry.losses} L ${entry.draws} D`;

function PodiumCard({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  // First place is the tallest and brightest; order on screen is 2, 1, 3.
  const style =
    entry.rank === 1
      ? "border-ink py-8 md:order-2 shadow-[0_0_36px_rgba(242,245,255,0.25)]"
      : entry.rank === 2
        ? "border-line-strong py-6 md:order-1"
        : "border-line-strong py-4 md:order-3";
  return (
    <li
      className={`flex min-w-0 flex-col gap-1 border bg-panel px-5 md:px-6 ${style} ${isYou ? "border-you glow-you" : ""}`}
    >
      <span
        className={`font-display leading-none font-bold ${entry.rank === 1 ? "text-6xl" : "text-4xl"} ${isYou ? "text-you" : ""}`}
      >
        #{entry.rank}
        {isYou ? <span className="ml-2 text-base tracking-widest">YOU</span> : null}
      </span>
      <Link
        to={`/u/${entry.username}`}
        className="flex min-w-0 items-center gap-3 text-xl font-semibold text-ink no-underline"
      >
        <Avatar id={entry.avatar} size={44} decorative />
        <span className="min-w-0 truncate" title={entry.username}>
          {entry.username}
        </span>
      </Link>
      <span className="font-mono text-muted">
        {entry.rating} · {record(entry)}
      </span>
    </li>
  );
}

export function RankingsPage() {
  const { data } = useServices();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const mode: GameMode = params.get("mode") === "blitz" ? "blitz" : "standard";
  const [entries, setEntries] = useState<LeaderboardEntry[] | "loading" | "error">("loading");

  useEffect(() => {
    let active = true;
    setEntries("loading");
    data.getLeaderboard(TOP, mode).then(
      (rows) => active && setEntries(rows),
      () => active && setEntries("error"),
    );
    return () => {
      active = false;
    };
  }, [data, mode]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:gap-8 md:px-[5%] md:py-10">
      <h1 className="m-0 font-display text-4xl leading-none font-bold tracking-wider uppercase italic md:text-5xl">
        Global rankings
      </h1>
      <div role="tablist" aria-label="Rating" className="flex w-max border border-line-strong">
        {(["standard", "blitz"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setParams(key === "blitz" ? { mode: "blitz" } : {}, { replace: true })}
            className={`h-11 cursor-pointer border-0 px-5 font-display text-sm font-bold tracking-[0.14em] uppercase ${
              mode !== key
                ? "bg-transparent text-muted hover:text-ink"
                : key === "blitz"
                  ? "bg-gold/15 text-gold"
                  : "bg-you/15 text-you"
            }`}
          >
            {key === "blitz" ? (
              <span className="inline-flex items-center gap-1.5">
                <BlitzMark size={18} />
                Blitz
              </span>
            ) : (
              "Ranked"
            )}
          </button>
        ))}
      </div>

      {entries === "loading" ? (
        <p role="status" className="m-0 text-muted">
          Loading rankings…
        </p>
      ) : entries === "error" ? (
        <p role="alert" className="m-0 text-rival">
          Could not load the rankings. Try again in a moment.
        </p>
      ) : entries.length === 0 ? (
        <p className="m-0 text-soft">No players yet. Be the first to battle.</p>
      ) : (
        <>
          <ol
            aria-label="Top three"
            className="m-0 grid list-none items-end gap-5 p-0 md:grid-cols-3"
          >
            {entries.slice(0, 3).map((entry) => (
              <PodiumCard key={entry.id} entry={entry} isYou={entry.id === user?.id} />
            ))}
          </ol>

          {entries.length > 3 ? (
            <div className="border border-line bg-panel">
              <table className="w-full table-fixed border-collapse text-left">
                <thead>
                  <tr className="text-xs tracking-widest text-muted uppercase">
                    <th className="w-14 px-3 py-3.5 font-medium md:w-20 md:px-5">Rank</th>
                    <th className="px-3 py-3.5 font-medium md:px-5">Player</th>
                    <th className="w-20 px-3 py-3.5 text-right font-medium md:w-28 md:px-5">
                      Rating
                    </th>
                    <th className="hidden w-32 px-5 py-3.5 text-right font-medium sm:table-cell">
                      W / L / D
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {entries.slice(3).map((entry) => {
                    const isYou = entry.id === user?.id;
                    return (
                      <tr
                        key={entry.id}
                        aria-current={isYou ? "true" : undefined}
                        className={`border-t border-line ${isYou ? "bg-you/10" : ""}`}
                      >
                        <td className={`px-3 py-3.5 md:px-5 ${isYou ? "text-you" : "text-muted"}`}>
                          {entry.rank}
                        </td>
                        <td className="px-3 py-3.5 font-sans md:px-5">
                          <span className="flex min-w-0 items-center gap-1">
                            <Link
                              to={`/u/${entry.username}`}
                              className="inline-flex min-w-0 items-center gap-2 text-ink"
                            >
                              <Avatar id={entry.avatar} size={28} decorative />
                              <span className="truncate" title={entry.username}>
                                {entry.username}
                              </span>
                            </Link>
                            {isYou ? <span className="flex-none text-you"> (you)</span> : null}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-right md:px-5">{entry.rating}</td>
                        <td className="hidden px-5 py-3.5 text-right text-muted sm:table-cell">
                          {entry.wins} / {entry.losses} / {entry.draws}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="m-0 text-sm text-muted">Showing the top {TOP} players by rating.</p>
        </>
      )}
    </main>
  );
}
