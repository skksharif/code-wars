/** Rank tiers shown on profiles. Colours avoid cyan and pink, which mean "you" and "opponent". */
export interface Tier {
  name: "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
  color: string;
  glow: string;
  /** Lowest rating in this tier. */
  min: number;
}

export const TIERS: Tier[] = [
  { name: "Bronze", color: "#D9894A", glow: "rgba(217,137,74,0.35)", min: -Infinity },
  { name: "Silver", color: "#C9D2E3", glow: "rgba(201,210,227,0.3)", min: 1100 },
  { name: "Gold", color: "#FFC83D", glow: "rgba(255,200,61,0.35)", min: 1300 },
  { name: "Platinum", color: "#5CF2C2", glow: "rgba(92,242,194,0.35)", min: 1500 },
  { name: "Diamond", color: "#B98CFF", glow: "rgba(185,140,255,0.4)", min: 1700 },
];

export function tierFor(rating: number): Tier {
  return [...TIERS].reverse().find((tier) => rating >= tier.min)!;
}

/** The next tier and how many points are needed to reach it, or null at the top. */
export function nextTier(rating: number): { tier: Tier; pointsNeeded: number } | null {
  const next = TIERS.find((tier) => tier.min > rating);
  return next ? { tier: next, pointsNeeded: next.min - rating } : null;
}
