/**
 * Google AdSense setup. These ids are public (they are in every page that
 * shows an ad), so they live in the code.
 *
 * Each ad unit id comes from AdSense > Ads > By ad unit (the number in
 * data-ad-slot="…"). An empty id turns that place off: nothing renders and no
 * space is reserved. Ads are never placed in a live battle.
 */
export const AD_CLIENT = "ca-pub-2765142427670001";

export const AD_UNITS = {
  /** Result screen, under the solutions (far from Rematch / Find new battle). */
  result: "",
  /** Rankings, inside the table after rank 10. */
  rankings: "",
  /** Profile: under the player card on wide screens, after the overview on phones. */
  profile: "",
  /** Arena, wide screens only, under the VS cards while searching. */
  arena: "",
} satisfies Record<string, string>;

export type AdUnit = keyof typeof AD_UNITS;

export function adUnitId(unit: AdUnit): string {
  return AD_UNITS[unit].trim();
}
