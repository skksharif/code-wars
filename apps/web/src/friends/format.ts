import type { HeadToHead } from "../lib/api";

/** "You 3 – 1", "You 2 – 2 (1 draw)", or "Not played yet". */
export function headToHeadText(h: HeadToHead): string {
  const played = h.wins + h.losses + h.draws;
  if (played === 0) return "Not played yet";
  return `You ${h.wins} – ${h.losses}${h.draws ? ` (${h.draws} draw${h.draws === 1 ? "" : "s"})` : ""}`;
}
