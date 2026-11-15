/**
 * Shared building blocks for seed problems: the problem shape, the salted
 * random generator for hidden tests, and small input-parsing helpers.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface ProblemDef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  statement: string;
  samples: { input: string; explanation?: string }[];
  /** Hidden test inputs. A function so they are generated with the current salt. */
  hidden: () => string[];
  solve: (input: string) => string;
}

let salt = 0;

/**
 * Sets the secret that randomised hidden tests are derived from. The repository
 * is public, so without a secret anyone could compute the hidden inputs and
 * their answers. With one, only the hand-written edge cases are knowable.
 */
export function setHiddenTestSalt(secret: string): void {
  let h = 2166136261;
  for (let i = 0; i < secret.length; i++) {
    h ^= secret.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  salt = h >>> 0;
}

/** Deterministic PRNG: the same seed and salt always give the same tests. */
export function rng(seed: number): () => number {
  let a = (seed ^ salt) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

export function randArray(seed: number, n: number, lo: number, hi: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => randInt(r, lo, hi));
}

export function randString(seed: number, n: number, alphabet: string): string {
  const r = rng(seed);
  return Array.from({ length: n }, () => alphabet[randInt(r, 0, alphabet.length - 1)]).join("");
}

export const lines = (input: string): string[] => input.replace(/\r/g, "").trimEnd().split("\n");
export const ints = (line: string | undefined): number[] =>
  (line ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
export const withCount = (values: number[]): string => `${values.length}\n${values.join(" ")}`;

export const LOWER = "abcdefghijklmnopqrstuvwxyz";
