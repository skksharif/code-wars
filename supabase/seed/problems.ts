/**
 * Seed problems. Each has a reference solution; expected outputs for samples
 * and hidden tests are computed from it by generate.ts, never typed by hand.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface ProblemDef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  statement: string;
  samples: { input: string; explanation?: string }[];
  hidden: string[];
  solve: (input: string) => string;
}

/** Deterministic PRNG so generated tests are identical on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

function randArray(seed: number, n: number, lo: number, hi: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => randInt(r, lo, hi));
}

function randString(seed: number, n: number, alphabet: string): string {
  const r = rng(seed);
  return Array.from({ length: n }, () => alphabet[randInt(r, 0, alphabet.length - 1)]).join("");
}

const lines = (input: string): string[] => input.replace(/\r/g, "").trimEnd().split("\n");
const ints = (line: string | undefined): number[] =>
  (line ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
const withCount = (values: number[]): string => `${values.length}\n${values.join(" ")}`;

const LOWER = "abcdefghijklmnopqrstuvwxyz";

export const PROBLEMS: ProblemDef[] = [
  // ------------------------------------------------------------------ easy
  {
    slug: "sum-of-evens",
    title: "Sum of Evens",
    difficulty: "easy",
    statement: `Given a list of integers, print the sum of the even ones.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print one integer: the sum of all even values. Print \`0\` if there are none.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- The answer can exceed 32 bits.`,
    samples: [
      { input: "5\n1 2 3 4 5", explanation: "2 + 4 = 6" },
      { input: "3\n7 9 11", explanation: "No even numbers." },
    ],
    hidden: [
      "1\n0",
      "4\n-2 -4 3 8",
      withCount(randArray(101, 500, -1000, 1000)),
      withCount(randArray(102, 2000, -1_000_000_000, 1_000_000_000)),
      withCount(Array.from({ length: 2000 }, () => 1_000_000_000)),
    ],
    solve: (input) => {
      const values = ints(lines(input)[1]);
      let sum = 0n;
      for (const v of values) if (v % 2 === 0) sum += BigInt(v);
      return sum.toString();
    },
  },
  {
    slug: "count-vowels",
    title: "Count the Vowels",
    difficulty: "easy",
    statement: `Count the vowels (\`a\`, \`e\`, \`i\`, \`o\`, \`u\`, in either case) in a line of text.

### Input
One line of text containing letters and spaces.

### Output
Print the number of vowels.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "Hello World", explanation: "e, o, o" }, { input: "rhythm" }],
    hidden: [
      "a",
      "AEIOU aeiou",
      "The quick brown fox jumps over the lazy dog",
      randString(201, 3000, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ "),
      "x" + randString(202, 3000, "bcdfg hjklm"),
    ],
    solve: (input) => {
      const text = lines(input)[0] ?? "";
      return String([...text].filter((c) => "aeiouAEIOU".includes(c)).length);
    },
  },
  {
    slug: "second-largest",
    title: "Second Largest",
    difficulty: "easy",
    statement: `Print the second largest **distinct** value in a list.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the second largest distinct value, or \`-1\` if all values are equal.

### Constraints
- 1 ≤ n ≤ 100000
- 0 ≤ a_i ≤ 10^9`,
    samples: [
      { input: "5\n3 9 9 4 1", explanation: "Distinct values are 9, 4, 3, 1." },
      { input: "3\n5 5 5" },
    ],
    hidden: [
      "1\n42",
      "2\n0 1000000000",
      "6\n7 7 7 7 7 6",
      withCount(randArray(301, 2000, 0, 50)),
      withCount(randArray(302, 2000, 0, 1_000_000_000)),
    ],
    solve: (input) => {
      const distinct = [...new Set(ints(lines(input)[1]))].sort((a, b) => b - a);
      return String(distinct.length < 2 ? -1 : distinct[1]);
    },
  },
  {
    slug: "reverse-words",
    title: "Reverse the Words",
    difficulty: "easy",
    statement: `Print the words of a sentence in reverse order.

### Input
One line with words made of lowercase letters, separated by single spaces.

### Output
Print the same words in reverse order, separated by single spaces.

### Constraints
- 1 ≤ number of words ≤ 10000
- Each word has 1 to 20 letters.`,
    samples: [{ input: "code wars is fun" }, { input: "solo" }],
    hidden: [
      "a b",
      "one two three four five six seven",
      "same same same",
      Array.from({ length: 400 }, (_, i) => randString(400 + i, 1 + (i % 9), LOWER)).join(" "),
      Array.from({ length: 800 }, (_, i) => randString(900 + i, 1 + (i % 5), "abc")).join(" "),
    ],
    solve: (input) => (lines(input)[0] ?? "").trim().split(/\s+/).reverse().join(" "),
  },
  {
    slug: "digit-root",
    title: "Digit Root",
    difficulty: "easy",
    statement: `Add up the digits of a number. If the result has more than one digit, repeat. Print the final single digit.

### Input
One line with a non-negative integer \`n\`. It can be far too large for a 64-bit type.

### Output
Print the single digit that remains.

### Constraints
- \`n\` has between 1 and 1000 digits and no leading zeros (except \`0\` itself).`,
    samples: [{ input: "9875", explanation: "9+8+7+5 = 29, 2+9 = 11, 1+1 = 2" }, { input: "0" }],
    hidden: [
      "9",
      "10",
      "999999999999999999999999999999",
      "1" + randString(501, 999, "0123456789"),
      "9" + randString(502, 499, "09"),
    ],
    solve: (input) => {
      let value = [...(lines(input)[0] ?? "0").trim()].reduce((s, d) => s + Number(d), 0);
      while (value >= 10) value = [...String(value)].reduce((s, d) => s + Number(d), 0);
      return String(value);
    },
  },
  {
    slug: "peak-count",
    title: "Count the Peaks",
    difficulty: "easy",
    statement: `An element is a **peak** if it is strictly greater than both of its neighbours. The first and last elements are never peaks.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the number of peaks.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9`,
    samples: [
      { input: "7\n1 3 2 5 5 4 6", explanation: "Only the 3 is a peak." },
      { input: "2\n1 2" },
    ],
    hidden: [
      "1\n5",
      "3\n1 2 1",
      "5\n4 4 4 4 4",
      withCount(randArray(601, 2000, -5, 5)),
      withCount(Array.from({ length: 1999 }, (_, i) => (i % 2 === 0 ? 0 : 1_000_000_000))),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      let count = 0;
      for (let i = 1; i + 1 < a.length; i++) {
        if (a[i]! > a[i - 1]! && a[i]! > a[i + 1]!) count++;
      }
      return String(count);
    },
  },
  // ---------------------------------------------------------------- medium
  {
    slug: "balanced-brackets",
    title: "Balanced Brackets",
    difficulty: "medium",
    statement: `Decide whether a string of brackets is balanced. Every opening bracket must be closed by the same kind of bracket, in the correct order.

### Input
One line containing only the characters \`( ) [ ] { }\`.

### Output
Print \`YES\` if the string is balanced, otherwise \`NO\`.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "{[()]}()" }, { input: "([)]", explanation: "The brackets cross over." }],
    hidden: [
      "(",
      "))((",
      "()[]{}",
      "(".repeat(1500) + "[{}]" + ")".repeat(1500),
      "{".repeat(1000) + "}".repeat(999) + "]",
      "()".repeat(1200) + "(",
    ],
    solve: (input) => {
      const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      const stack: string[] = [];
      for (const c of (lines(input)[0] ?? "").trim()) {
        if (c in pairs) {
          if (stack.pop() !== pairs[c]) return "NO";
        } else {
          stack.push(c);
        }
      }
      return stack.length === 0 ? "YES" : "NO";
    },
  },
  {
    slug: "longest-unique-run",
    title: "Longest Run Without Repeats",
    difficulty: "medium",
    statement: `Find the length of the longest contiguous part of a string in which no character appears twice.

### Input
One line with a string of lowercase letters.

### Output
Print the length of the longest substring with all distinct characters.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "abcabcbb", explanation: '"abc" has length 3.' }, { input: "bbbbb" }],
    hidden: [
      "a",
      "abcdefghijklmnopqrstuvwxyz",
      "abba",
      randString(801, 3000, "abcdef"),
      randString(802, 3000, LOWER),
      "ab".repeat(1500) + LOWER,
    ],
    solve: (input) => {
      const s = (lines(input)[0] ?? "").trim();
      const last = new Map<string, number>();
      let start = 0;
      let best = 0;
      for (let i = 0; i < s.length; i++) {
        const seen = last.get(s[i]!);
        if (seen !== undefined && seen >= start) start = seen + 1;
        last.set(s[i]!, i);
        best = Math.max(best, i - start + 1);
      }
      return String(best);
    },
  },
  {
    slug: "pair-sum-count",
    title: "Pairs With a Given Sum",
    difficulty: "medium",
    statement: `Count the pairs of positions \`i < j\` whose values add up to \`k\`.

### Input
The first line contains two integers \`n\` and \`k\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the number of pairs \`(i, j)\` with \`i < j\` and \`a_i + a_j = k\`.

### Constraints
- 1 ≤ n ≤ 200000
- -10^9 ≤ a_i, k ≤ 10^9
- The answer can exceed 32 bits.`,
    samples: [
      { input: "5 6\n1 5 3 3 2", explanation: "(1,5) and (3,3)." },
      { input: "3 10\n1 2 3" },
    ],
    hidden: [
      "1 2\n1",
      "4 0\n0 0 0 0",
      "6 -1\n-3 2 -1 0 5 -6",
      `3000 10\n${randArray(901, 3000, 0, 10).join(" ")}`,
      `3000 0\n${randArray(902, 3000, -1_000_000_000, 1_000_000_000).join(" ")}`,
      `3000 2000000000\n${Array.from({ length: 3000 }, () => 1_000_000_000).join(" ")}`,
    ],
    solve: (input) => {
      const [first, second] = lines(input);
      const k = ints(first)[1]!;
      const seen = new Map<number, number>();
      let count = 0n;
      for (const v of ints(second)) {
        count += BigInt(seen.get(k - v) ?? 0);
        seen.set(v, (seen.get(v) ?? 0) + 1);
      }
      return count.toString();
    },
  },
  {
    slug: "merge-intervals",
    title: "Merge the Intervals",
    difficulty: "medium",
    statement: `You are given closed intervals on a number line. Intervals that overlap or touch (share an endpoint) merge into one.

### Input
The first line contains an integer \`n\`. Each of the next \`n\` lines contains two integers \`l\` and \`r\`.

### Output
Print two integers separated by a space: the number of intervals after merging, and their total length (the sum of \`r - l\` over the merged intervals).

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ l ≤ r ≤ 10^9`,
    samples: [
      {
        input: "4\n1 3\n2 6\n8 10\n10 12",
        explanation: "Merged: [1,6] and [8,12]. Lengths 5 + 4 = 9.",
      },
      { input: "1\n5 5" },
    ],
    hidden: [
      "2\n1 2\n3 4",
      "3\n-5 5\n-1 1\n0 0",
      "3\n-1000000000 0\n0 1000000000\n5 6",
      (() => {
        const r = rng(1001);
        const rows = Array.from({ length: 1500 }, () => {
          const l = randInt(r, -10_000, 10_000);
          return `${l} ${l + randInt(r, 0, 20)}`;
        });
        return `${rows.length}\n${rows.join("\n")}`;
      })(),
      (() => {
        const r = rng(1002);
        const rows = Array.from({ length: 1500 }, () => {
          const l = randInt(r, -1_000_000_000, 999_000_000);
          return `${l} ${l + randInt(r, 0, 1_000_000)}`;
        });
        return `${rows.length}\n${rows.join("\n")}`;
      })(),
    ],
    solve: (input) => {
      const rows = lines(input)
        .slice(1)
        .map((line) => ints(line) as [number, number])
        .sort((x, y) => x[0] - y[0]);
      let count = 0;
      let total = 0;
      let [curL, curR] = rows[0]!;
      for (const [l, r] of rows.slice(1)) {
        if (l <= curR) {
          curR = Math.max(curR, r);
        } else {
          count++;
          total += curR - curL;
          [curL, curR] = [l, r];
        }
      }
      return `${count + 1} ${total + curR - curL}`;
    },
  },
  // ------------------------------------------------------------------ hard
  {
    slug: "fewest-coins",
    title: "Fewest Coins",
    difficulty: "hard",
    statement: `You have an unlimited supply of coins of several values. Find the smallest number of coins that add up to exactly a target amount.

### Input
The first line contains two integers \`n\` and \`amount\`. The second line contains \`n\` distinct coin values \`c_i\`.

### Output
Print the minimum number of coins needed, or \`-1\` if the amount cannot be made.

### Constraints
- 1 ≤ n ≤ 100
- 0 ≤ amount ≤ 10000
- 1 ≤ c_i ≤ 10000`,
    samples: [
      { input: "3 11\n1 5 6", explanation: "5 + 6. Greedy (6+5×1) would use more." },
      { input: "2 7\n2 4", explanation: "Only even amounts are possible." },
    ],
    hidden: [
      "1 0\n7",
      "1 10000\n1",
      "3 6249\n186 419 83",
      "4 9999\n2 4 6 8",
      "5 10000\n3 7 11 4999 5003",
      "6 9973\n17 113 257 1009 2003 4001",
    ],
    solve: (input) => {
      const [first, second] = lines(input);
      const amount = ints(first)[1]!;
      const coins = ints(second);
      const best = new Array<number>(amount + 1).fill(Infinity);
      best[0] = 0;
      for (let a = 1; a <= amount; a++) {
        for (const c of coins) {
          if (c <= a && best[a - c]! + 1 < best[a]!) best[a] = best[a - c]! + 1;
        }
      }
      return String(Number.isFinite(best[amount]!) ? best[amount] : -1);
    },
  },
  {
    slug: "grid-escape",
    title: "Grid Escape",
    difficulty: "hard",
    statement: `Find the fewest moves needed to walk from \`S\` to \`E\` in a grid. You can move up, down, left or right into any cell that is not a wall.

### Input
The first line contains two integers \`r\` and \`c\`. Each of the next \`r\` lines contains \`c\` characters: \`.\` (open), \`#\` (wall), \`S\` (start) or \`E\` (exit). There is exactly one \`S\` and one \`E\`.

### Output
Print the minimum number of moves, or \`-1\` if the exit cannot be reached.

### Constraints
- 1 ≤ r, c ≤ 500`,
    samples: [
      { input: "3 4\nS.#.\n.##.\n...E", explanation: "Down, down, right, right, right." },
      { input: "1 3\nS#E" },
    ],
    hidden: [
      "1 2\nSE",
      "3 3\nS..\n###\n..E",
      "5 5\nS...#\n.##.#\n.#..#\n.#.##\n...E.",
      ...[1101, 1102, 1103].map((seed, index) => {
        const r = rng(seed);
        const size = 40 + index * 10;
        const grid = Array.from({ length: size }, () =>
          Array.from({ length: size }, (): string => (r() < 0.28 ? "#" : ".")),
        );
        grid[0]![0] = "S";
        grid[size - 1]![size - 1] = "E";
        return `${size} ${size}\n${grid.map((row) => row.join("")).join("\n")}`;
      }),
    ],
    solve: (input) => {
      const rows = lines(input);
      const [r, c] = ints(rows[0]) as [number, number];
      const grid = rows.slice(1, r + 1);
      const dist = Array.from({ length: r }, () => new Array<number>(c).fill(-1));
      const queue: [number, number][] = [];
      for (let i = 0; i < r; i++) {
        const j = grid[i]!.indexOf("S");
        if (j >= 0) {
          dist[i]![j] = 0;
          queue.push([i, j]);
        }
      }
      for (let head = 0; head < queue.length; head++) {
        const [i, j] = queue[head]!;
        if (grid[i]![j] === "E") return String(dist[i]![j]);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= r || nj >= c) continue;
          if (grid[ni]![nj] === "#" || dist[ni]![nj] !== -1) continue;
          dist[ni]![nj] = dist[i]![j]! + 1;
          queue.push([ni, nj]);
        }
      }
      return "-1";
    },
  },
];
