import { LANGUAGE_LABELS, type Language } from "@code-wars/shared";
import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { PublicProfile } from "../lib/live";
import { nextTier, tierFor } from "../lib/tiers";
import { useServices } from "../services";

const RESULT = {
  win: { label: "Win", color: "text-you" },
  loss: { label: "Loss", color: "text-rival" },
  draw: { label: "Draw", color: "text-soft" },
} as const;

const CUT =
  "polygon(24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%, 0 24px)";
const CUT_INNER =
  "polygon(23px 0, 100% 0, 100% calc(100% - 23px), calc(100% - 23px) 100%, 0 100%, 0 23px)";
const HEXAGON = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

function monthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

/** The trading card: emblem, name, tier, rating and record. */
function PlayerCard({ profile }: { profile: PublicProfile }) {
  const tier = tierFor(profile.rating);
  const next = nextTier(profile.rating);
  const accent = { color: tier.color } satisfies CSSProperties;
  return (
    // Three layers so the cut corners keep a coloured edge and a glow:
    // the outer glow, a frame in the tier colour, then the card itself.
    <div
      className="w-full max-w-[420px] flex-none"
      style={{ filter: `drop-shadow(0 0 22px ${tier.glow})` }}
    >
      <div style={{ background: tier.color, clipPath: CUT, padding: 2 }}>
        <article
          aria-label={`Player card for ${profile.username}`}
          className="flex w-full flex-col items-center gap-4 bg-panel p-7"
          style={{ clipPath: CUT_INNER }}
        >
          <div className="flex w-full justify-between font-mono text-sm text-muted">
            <span>#{profile.rank} GLOBAL</span>
            <span>SINCE {monthYear(profile.memberSince).toUpperCase()}</span>
          </div>

          <div
            aria-hidden="true"
            className="flex h-[210px] w-[190px] items-center justify-center bg-ground font-display text-[110px] font-bold"
            style={{ ...accent, clipPath: HEXAGON, textShadow: `0 0 30px ${tier.glow}` }}
          >
            {profile.username[0]?.toUpperCase()}
          </div>

          <h1 className="m-0 font-display text-5xl leading-none font-bold break-all">
            {profile.username}
          </h1>
          <span
            className="cut inline-flex h-8 items-center px-5 font-display font-bold tracking-[0.18em] text-ground uppercase"
            style={{ background: tier.color }}
          >
            {tier.name}
          </span>

          <p
            className="m-0 font-display text-[104px] leading-[0.9] font-bold"
            style={{ ...accent, textShadow: `0 0 34px ${tier.glow}` }}
            aria-label={`Rating ${profile.rating}`}
          >
            {profile.rating}
          </p>
          <p className="m-0 font-mono text-sm text-muted">
            Peak {profile.peakRating}
            {next ? ` · ${next.pointsNeeded} to ${next.tier.name}` : " · top tier"}
          </p>

          <dl className="m-0 grid w-full grid-cols-3 border-t border-line-strong pt-4 text-center">
            <div>
              <dd className="m-0 font-display text-3xl font-bold text-you">{profile.wins}</dd>
              <dt className="text-xs tracking-[0.14em] text-muted">WINS</dt>
            </div>
            <div>
              <dd className="m-0 font-display text-3xl font-bold text-rival">{profile.losses}</dd>
              <dt className="text-xs tracking-[0.14em] text-muted">LOSSES</dt>
            </div>
            <div>
              <dd className="m-0 font-display text-3xl font-bold">{profile.draws}</dd>
              <dt className="text-xs tracking-[0.14em] text-muted">DRAWS</dt>
            </div>
          </dl>
        </article>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-line bg-panel px-4 py-3.5">
      <div className="text-xs tracking-[0.12em] text-muted uppercase">{label}</div>
      <div className={`font-display text-3xl font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function RatingChart({ history, color }: { history: number[]; color: string }) {
  if (history.length < 2) {
    return <p className="m-0 text-muted">The chart appears after the first battle.</p>;
  }
  const low = Math.min(...history);
  const high = Math.max(...history);
  const span = Math.max(high - low, 1);
  const width = 800;
  const height = 190;
  const points = history.map((value, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = 12 + (1 - (value - low) / span) * (height - 24);
    return [x, y] as const;
  });
  const peakIndex = history.indexOf(high);
  return (
    <>
      <svg
        role="img"
        aria-label={`Rating from ${history[0]} to ${history[history.length - 1]} over ${history.length - 1} battles; lowest ${low}, highest ${high}`}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {[0.15, 0.5, 0.85].map((f) => (
          <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} stroke="#232838" />
        ))}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
        />
        <circle cx={points[peakIndex]![0]} cy={points[peakIndex]![1]} r="6" fill={color} />
      </svg>
      <div className="flex justify-between font-mono text-xs text-muted">
        <span>Start {history[0]}</span>
        <span>Peak {high}</span>
        <span>Now {history[history.length - 1]}</span>
      </div>
    </>
  );
}

export function ProfilePage() {
  const { username = "" } = useParams();
  const { data } = useServices();
  const { profile: me } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null | "loading" | "error">("loading");

  useEffect(() => {
    let active = true;
    setProfile("loading");
    data.getPublicProfile(username).then(
      (found) => active && setProfile(found),
      () => active && setProfile("error"),
    );
    return () => {
      active = false;
    };
  }, [data, username]);

  if (profile === "loading") {
    return (
      <p role="status" className="p-10 text-center text-muted">
        Loading profile…
      </p>
    );
  }
  if (profile === "error" || profile === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="m-0 font-display text-4xl font-bold uppercase italic">
          {profile === null ? "Player not found" : "Profile unavailable"}
        </h1>
        <p role="alert" className="m-0 text-soft">
          {profile === null
            ? `There is no player called “${username}”.`
            : "Could not load the profile. Try again in a moment."}
        </p>
        <Link to="/rankings" className="text-you">
          See the rankings
        </Link>
      </main>
    );
  }

  const tier = tierFor(profile.rating);
  const isMe = me?.username.toLowerCase() === profile.username.toLowerCase();
  const played = profile.wins + profile.losses + profile.draws;
  const winRate = played > 0 ? `${Math.round((profile.wins / played) * 100)}%` : "–";
  const streak = profile.streak
    ? `${profile.streak.count} ${profile.streak.result === "win" ? "W" : profile.streak.result === "loss" ? "L" : "D"}`
    : "–";
  const languages = Object.entries(profile.languages) as [Language, number][];
  const languageTotal = languages.reduce((sum, [, count]) => sum + count, 0);
  const main = [...languages].sort((x, y) => y[1] - x[1])[0];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-wrap items-start gap-10 px-[5%] py-10">
      <PlayerCard profile={profile} />

      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Battles" value={String(played)} />
          <StatTile label="Win rate" value={winRate} tone="text-you" />
          <StatTile label="Streak" value={streak} />
          <StatTile label="Main" value={main ? LANGUAGE_LABELS[main[0]].split(" ")[0]! : "–"} />
        </div>

        <figure className="m-0 flex flex-col gap-2 border border-line bg-panel px-5 py-4">
          <figcaption className="text-xs tracking-[0.14em] text-muted">RATING HISTORY</figcaption>
          <RatingChart history={profile.ratingHistory} color={tier.color} />
        </figure>

        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label="Languages" className="border border-line bg-panel px-5 py-4">
            <h2 className="m-0 mb-2 text-xs font-normal tracking-[0.14em] text-muted">LANGUAGES</h2>
            {languages.length === 0 ? (
              <p className="m-0 text-muted">No battles yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {languages
                  .sort((x, y) => y[1] - x[1])
                  .map(([language, count]) => {
                    const share = Math.round((count / languageTotal) * 100);
                    return (
                      <li key={language} className="flex flex-col gap-1">
                        <span className="flex justify-between font-mono text-sm">
                          <span>{LANGUAGE_LABELS[language]}</span>
                          <span>{share}%</span>
                        </span>
                        <span aria-hidden="true" className="h-2 bg-line">
                          <span className="block h-2 bg-you" style={{ width: `${share}%` }} />
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
          <section
            aria-label="Wins by difficulty"
            className="border border-line bg-panel px-5 py-4"
          >
            <h2 className="m-0 mb-2 text-xs font-normal tracking-[0.14em] text-muted">
              WINS BY DIFFICULTY
            </h2>
            {(["easy", "medium", "hard"] as const).map((level) => (
              <div key={level} className="flex justify-between font-mono text-sm leading-7">
                <span className="capitalize">{level}</span>
                <span>{profile.winsByDifficulty[level]}</span>
              </div>
            ))}
          </section>
        </div>

        <section aria-label="Recent battles" className="border border-line bg-panel px-5 py-4">
          <h2 className="m-0 mb-1 text-xs font-normal tracking-[0.14em] text-muted">
            RECENT BATTLES
          </h2>
          {profile.recentBattles.length === 0 ? (
            <p className="m-0 text-muted">No battles yet.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {profile.recentBattles.map((battle) => {
                const delta = battle.ratingAfter - battle.ratingBefore;
                const result = RESULT[battle.result];
                return (
                  <li
                    key={battle.battleId}
                    className="flex min-h-11 items-center justify-between gap-3 border-t border-line py-2"
                  >
                    <span>
                      <b className={`font-display uppercase ${result.color}`}>{result.label}</b> vs{" "}
                      <Link to={`/u/${battle.opponent}`} className="text-you">
                        {battle.opponent}
                      </Link>
                      {isMe ? (
                        <>
                          {" · "}
                          <Link to={`/battle/${battle.battleId}`} className="text-sm text-muted">
                            view battle
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <span className={`font-mono ${delta >= 0 ? "text-you" : "text-rival"}`}>
                      {delta >= 0 ? "+" : "−"}
                      {Math.abs(delta)} · {timeAgo(battle.finishedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
