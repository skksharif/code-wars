import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import type { LeaderboardEntry } from "../lib/live";
import { useServices } from "../services";

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
      className={`flex flex-col gap-1 border bg-panel px-6 ${style} ${isYou ? "border-you glow-you" : ""}`}
    >
      <span
        className={`font-display leading-none font-bold ${entry.rank === 1 ? "text-6xl" : "text-4xl"} ${isYou ? "text-you" : ""}`}
      >
        #{entry.rank}
        {isYou ? <span className="ml-2 text-base tracking-widest">YOU</span> : null}
      </span>
      <span className="text-xl font-semibold">{entry.username}</span>
      <span className="font-mono text-muted">
        {entry.rating} · {record(entry)}
      </span>
    </li>
  );
}

export function RankingsPage() {
  const { data } = useServices();
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[] | "loading" | "error">("loading");

  useEffect(() => {
    let active = true;
    data.getLeaderboard(TOP).then(
      (rows) => active && setEntries(rows),
      () => active && setEntries("error"),
    );
    return () => {
      active = false;
    };
  }, [data]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-[5%] py-10">
      <h1 className="m-0 font-display text-5xl leading-none font-bold tracking-wider uppercase italic">
        Global rankings
      </h1>

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
            <div className="overflow-x-auto border border-line bg-panel">
              <table className="w-full min-w-[440px] border-collapse text-left">
                <thead>
                  <tr className="text-xs tracking-widest text-muted uppercase">
                    <th className="px-5 py-3.5 font-medium">Rank</th>
                    <th className="px-5 py-3.5 font-medium">Player</th>
                    <th className="px-5 py-3.5 text-right font-medium">Rating</th>
                    <th className="px-5 py-3.5 text-right font-medium">W / L / D</th>
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
                        <td className={`px-5 py-3.5 ${isYou ? "text-you" : "text-muted"}`}>
                          {entry.rank}
                        </td>
                        <td className="px-5 py-3.5 font-sans">
                          {entry.username}
                          {isYou ? <span className="text-you"> (you)</span> : null}
                        </td>
                        <td className="px-5 py-3.5 text-right">{entry.rating}</td>
                        <td className="px-5 py-3.5 text-right text-muted">
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
