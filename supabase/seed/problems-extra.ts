/**
 * The extended problem set (problems 16-50). Same rules as problems.ts: every
 * answer comes from the reference `solve`, and every problem has at least one
 * hidden test drawn from the salted generator, so its answer is not public.
 */
import {
  ints,
  lines,
  LOWER,
  randArray,
  randInt,
  randString,
  rng,
  withCount,
  type ProblemDef,
} from "./gen.ts";

// ------------------------------------------------------------------ helpers

type Rand = () => number;

function shuffle<T>(r: Rand, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(r, 0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function randWord(r: Rand, lo: number, hi: number, alphabet = LOWER): string {
  return Array.from(
    { length: randInt(r, lo, hi) },
    () => alphabet[randInt(r, 0, alphabet.length - 1)],
  ).join("");
}

function randWords(seed: number, count: number, lo: number, hi: number, alphabet = LOWER): string {
  const r = rng(seed);
  return Array.from({ length: count }, () => randWord(r, lo, hi, alphabet)).join(" ");
}

function randGrid(
  seed: number,
  rows: number,
  cols: number,
  chance: number,
  on: string,
  off: string,
) {
  const r = rng(seed);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): string => (r() < chance ? on : off)).join(""),
  );
}

function randMatrix(seed: number, rows: number, cols: number, lo: number, hi: number): string {
  const r = rng(seed);
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => randInt(r, lo, hi)).join(" "),
  );
  return `${rows} ${cols}\n${body.join("\n")}`;
}

const reverse = (text: string) => [...text].reverse().join("");

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Floor of a / b for BigInt, with b > 0. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/** Index of the first element greater than x in a sorted list. */
function upperBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Edges "u v" or "u v w" after the first line, as number triples. */
const edgeList = (input: string) =>
  lines(input)
    .slice(1)
    .map((l) => ints(l));

// ------------------------------------------------------------------ problems

export const EXTRA_PROBLEMS: ProblemDef[] = [
  // ================================================================= easy
  {
    slug: "list-range",
    title: "Range of a List",
    difficulty: "easy",
    statement: `Print the difference between the largest and the smallest value in a list.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the largest value minus the smallest value.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9`,
    samples: [
      { input: "5\n3 9 1 7 4", explanation: "9 - 1 = 8" },
      { input: "1\n42", explanation: "A single value has a range of 0." },
    ],
    hidden: () => [
      "1\n5",
      "3\n-1000000000 0 1000000000",
      "4\n7 7 7 7",
      withCount(randArray(2101, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(2102, 3000, -5, 5)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      return String(Math.max(...a) - Math.min(...a));
    },
  },
  {
    slug: "below-zero",
    title: "Below Zero",
    difficulty: "easy",
    statement: `Count how many values in a list are negative.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the number of values smaller than 0.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9`,
    samples: [
      { input: "6\n3 -1 0 -7 2 -2", explanation: "-1, -7 and -2. Zero is not negative." },
      { input: "2\n0 5" },
    ],
    hidden: () => [
      "1\n-1",
      "1\n0",
      "5\n-1 -1 -1 -1 -1",
      withCount(randArray(2201, 3000, -10, 10)),
      withCount(randArray(2202, 3000, -1_000_000_000, 1_000_000_000)),
    ],
    solve: (input) => String(ints(lines(input)[1]).filter((v) => v < 0).length),
  },
  {
    slug: "mirror-word",
    title: "Mirror Word",
    difficulty: "easy",
    statement: `Decide whether a word reads the same forwards and backwards.

### Input
One line with a word of lowercase letters.

### Output
Print \`YES\` if the word reads the same in both directions, otherwise \`NO\`.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "level" }, { input: "coder" }],
    hidden: () => {
      const half = randString(2301, 1500, LOWER);
      const palindrome = half + reverse(half);
      const broken = (palindrome[0] === "a" ? "b" : "a") + palindrome.slice(1);
      const odd = randString(2302, 999, "ab");
      return ["a", "ab", "abba", palindrome, broken, odd + "c" + reverse(odd)];
    },
    solve: (input) => {
      const word = (lines(input)[0] ?? "").trim();
      return word === reverse(word) ? "YES" : "NO";
    },
  },
  {
    slug: "multiples-count",
    title: "Multiples Count",
    difficulty: "easy",
    statement: `Count the whole numbers from 1 to \`n\` that are divisible by \`a\`, by \`b\`, or by both.

### Input
One line with three integers \`n\`, \`a\` and \`b\`.

### Output
Print how many numbers in 1..n are divisible by at least one of \`a\` and \`b\`.

### Constraints
- 1 ≤ n ≤ 10^9
- 1 ≤ a, b ≤ 10^6
- Looping over every number up to n is too slow.`,
    samples: [
      { input: "10 2 3", explanation: "2, 3, 4, 6, 8, 9, 10" },
      { input: "15 5 5", explanation: "5, 10, 15" },
    ],
    hidden: () => {
      const r = rng(2401);
      const random = () => `${randInt(r, 1, 1e9)} ${randInt(r, 1, 1000)} ${randInt(r, 1, 1000)}`;
      return [
        "1 1 1",
        "1000000000 1 1000000",
        "1000000000 999983 999979",
        "1000000000 4 6",
        random(),
        random(),
      ];
    },
    solve: (input) => {
      const [n, a, b] = ints(lines(input)[0]) as [number, number, number];
      const lcm = (a / gcd(a, b)) * b;
      return String(Math.floor(n / a) + Math.floor(n / b) - Math.floor(n / lcm));
    },
  },
  {
    slug: "even-digits",
    title: "Even Digits",
    difficulty: "easy",
    statement: `Count the even digits (0, 2, 4, 6, 8) in a number. The number can be far too long for any integer type.

### Input
One line with a non-negative integer without leading zeros (except \`0\` itself).

### Output
Print the number of even digits.

### Constraints
- 1 ≤ number of digits ≤ 100000`,
    samples: [
      { input: "123456", explanation: "2, 4 and 6" },
      { input: "0", explanation: "0 is even." },
    ],
    hidden: () => [
      "7",
      "2468024680",
      "8".repeat(1000),
      "1" + randString(2501, 999, "0123456789"),
      "9" + randString(2502, 1999, "13579"),
    ],
    solve: (input) =>
      String([...(lines(input)[0] ?? "").trim()].filter((d) => "02468".includes(d)).length),
  },
  {
    slug: "running-total",
    title: "Running Total",
    difficulty: "easy",
    statement: `For each position in a list, print the sum of all values up to and including that position.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print \`n\` numbers on one line, separated by single spaces.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- The totals can exceed 32 bits.`,
    samples: [{ input: "4\n1 2 3 4" }, { input: "3\n5 -5 5" }],
    hidden: () => [
      "1\n-7",
      "3\n1000000000 1000000000 1000000000",
      withCount(randArray(2601, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(2602, 3000, -3, 3)),
      withCount(Array.from({ length: 2000 }, () => 1_000_000_000)),
    ],
    solve: (input) => {
      let total = 0;
      return ints(lines(input)[1])
        .map((v) => (total += v))
        .join(" ");
    },
  },
  {
    slug: "longest-word",
    title: "Longest Word",
    difficulty: "easy",
    statement: `Find the length of the longest word in a sentence.

### Input
One line of lowercase words separated by single spaces.

### Output
Print the length of the longest word.

### Constraints
- 1 ≤ number of words ≤ 10000
- Each word has 1 to 50 letters.`,
    samples: [{ input: "the quick brown fox" }, { input: "a bb ccc" }],
    hidden: () => [
      "x",
      "same size word",
      randWords(2701, 500, 1, 12),
      randWords(2702, 300, 1, 50),
      randWords(2703, 1000, 1, 3, "ab"),
    ],
    solve: (input) =>
      String(
        Math.max(
          ...(lines(input)[0] ?? "")
            .trim()
            .split(/\s+/)
            .map((w) => w.length),
        ),
      ),
  },
  {
    slug: "capital-count",
    title: "Capital Count",
    difficulty: "easy",
    statement: `Count the capital letters in a line of text.

### Input
One line containing English letters and spaces. It does not start or end with a space.

### Output
Print the number of capital letters A to Z.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "Hello World" }, { input: "no capitals here" }],
    hidden: () => [
      "A",
      "ALL CAPS HERE",
      "a" + randString(2801, 3000, "aAbBcCdD xyzXYZ") + "z",
      "x" + randString(2802, 2000, "abcdefg hijk") + "y",
      "Q" + randString(2803, 1000, "ABCDEFGHIJ") + "Q",
    ],
    solve: (input) =>
      String([...(lines(input)[0] ?? "")].filter((c) => c >= "A" && c <= "Z").length),
  },
  {
    slug: "distinct-values",
    title: "Distinct Values",
    difficulty: "easy",
    statement: `Count how many different values appear in a list.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the number of distinct values.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9`,
    samples: [{ input: "6\n1 2 2 3 3 3" }, { input: "3\n-1 -1 -1" }],
    hidden: () => [
      "1\n0",
      "5\n1 2 3 4 5",
      withCount(randArray(2901, 3000, 0, 100)),
      withCount(randArray(2902, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(2903, 3000, -3, 3)),
    ],
    solve: (input) => String(new Set(ints(lines(input)[1])).size),
  },
  {
    slug: "average-floor",
    title: "Average, Rounded Down",
    difficulty: "easy",
    statement: `Print the average of a list, rounded **down** to a whole number. Rounding down means towards minus infinity, so -1.5 becomes -2.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the average rounded down.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- The sum can exceed 32 bits.`,
    samples: [
      { input: "3\n1 2 4", explanation: "7 / 3 = 2.33..., rounded down to 2." },
      { input: "2\n-3 0", explanation: "-1.5 rounded down is -2." },
    ],
    hidden: () => [
      "1\n-7",
      "2\n-1 0",
      "4\n1000000000 1000000000 1000000000 999999999",
      withCount(randArray(3001, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(3002, 2999, -10, 3)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      const sum = a.reduce((s, v) => s + BigInt(v), 0n);
      return floorDiv(sum, BigInt(a.length)).toString();
    },
  },
  {
    slug: "max-positions",
    title: "Where Is the Maximum",
    difficulty: "easy",
    statement: `Print every position where the largest value of a list appears. Positions are numbered from 1.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the positions in increasing order, separated by single spaces.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9`,
    samples: [{ input: "5\n3 9 2 9 1" }, { input: "1\n-5" }],
    hidden: () => [
      "3\n7 7 7",
      "4\n-1 -2 -3 -1",
      withCount(randArray(3101, 3000, 0, 20)),
      withCount(randArray(3102, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(3103, 3000, 0, 1)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      const best = Math.max(...a);
      return a.flatMap((v, i) => (v === best ? [i + 1] : [])).join(" ");
    },
  },
  {
    slug: "swap-case",
    title: "Swap the Case",
    difficulty: "easy",
    statement: `Turn every capital letter into a small letter and every small letter into a capital.

### Input
One line containing English letters and spaces. It does not start or end with a space.

### Output
Print the line with the case of every letter swapped. Spaces stay where they are.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "Hello World" }, { input: "abc XYZ" }],
    hidden: () => [
      "a",
      "Z",
      "MiXeD CaSe",
      "a" + randString(3201, 3000, "aAbBzZ qQ") + "Z",
      randString(3202, 2000, "abcdefghijABCDEFGHIJ"),
    ],
    solve: (input) =>
      [...(lines(input)[0] ?? "")]
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join(""),
  },
  {
    slug: "leap-years",
    title: "Leap Years",
    difficulty: "easy",
    statement: `Count the leap years between two years, including both ends. A year is a leap year if it is divisible by 4, except years divisible by 100, which are leap years only if they are also divisible by 400.

### Input
One line with two integers \`y1\` and \`y2\`.

### Output
Print the number of leap years from \`y1\` to \`y2\`.

### Constraints
- 1 ≤ y1 ≤ y2 ≤ 10^9
- Checking every year one by one is too slow.`,
    samples: [
      { input: "2000 2004", explanation: "2000 and 2004" },
      { input: "1900 1903", explanation: "1900 is divisible by 100 but not by 400." },
    ],
    hidden: () => {
      const r = rng(3301);
      const random = () => {
        const [a, b] = [randInt(r, 1, 1e9), randInt(r, 1, 1e9)].sort((x, y) => x - y);
        return `${a} ${b}`;
      };
      return ["1 1", "4 4", "1 1000000000", "1600 2400", random(), random()];
    },
    solve: (input) => {
      const [y1, y2] = ints(lines(input)[0]) as [number, number];
      const upTo = (y: number) => Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
      return String(upTo(y2) - upTo(y1 - 1));
    },
  },
  {
    slug: "odd-one-out",
    title: "The Unpaired Number",
    difficulty: "easy",
    statement: `Every value in a list appears exactly twice, except one value that appears once. Find it.

### Input
The first line contains an odd integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the value that appears only once.

### Constraints
- 1 ≤ n ≤ 99999
- 1 ≤ a_i ≤ 10^9`,
    samples: [{ input: "5\n4 1 2 1 2" }, { input: "1\n7" }],
    hidden: () => {
      const make = (seed: number, pairs: number) => {
        const r = rng(seed);
        const values = new Set<number>();
        while (values.size < pairs + 1) values.add(randInt(r, 1, 1e9));
        const [single, ...rest] = [...values];
        return withCount(shuffle(r, [single!, ...rest, ...rest]));
      };
      return ["3\n9 5 9", "7\n1 2 3 4 3 2 1", make(3401, 1499), make(3402, 100), make(3403, 1)];
    },
    solve: (input) => {
      const counts = new Map<number, number>();
      for (const v of ints(lines(input)[1])) counts.set(v, (counts.get(v) ?? 0) + 1);
      return String([...counts].find(([, c]) => c === 1)![0]);
    },
  },

  // =============================================================== medium
  {
    slug: "same-letters",
    title: "Same Letters",
    difficulty: "medium",
    statement: `Two words use the same letters if one can be rearranged into the other, using every letter exactly as many times.

### Input
Two lines, each with a word of lowercase letters.

### Output
Print \`YES\` if the words use the same letters, otherwise \`NO\`.

### Constraints
- 1 ≤ length of each word ≤ 100000`,
    samples: [{ input: "listen\nsilent" }, { input: "rat\ncar" }],
    hidden: () => {
      const r = rng(3501);
      const word = randWord(r, 2000, 2000);
      const mixed = shuffle(r, [...word]).join("");
      const changed = (mixed[0] === "a" ? "b" : "a") + mixed.slice(1);
      return ["a\na", "ab\nabc", "aabb\nabab", `${word}\n${mixed}`, `${word}\n${changed}`];
    },
    solve: (input) => {
      const [a, b] = lines(input).map((l) => [...l.trim()].sort().join(""));
      return a === b ? "YES" : "NO";
    },
  },
  {
    slug: "majority-value",
    title: "Majority Value",
    difficulty: "medium",
    statement: `A value is the **majority** if it appears in more than half of the positions of a list.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the majority value, or \`-1\` if there is none.

### Constraints
- 1 ≤ n ≤ 100000
- 1 ≤ a_i ≤ 10^9`,
    samples: [
      { input: "5\n2 2 1 2 3", explanation: "2 appears 3 times out of 5." },
      { input: "4\n1 1 2 2", explanation: "Exactly half is not more than half." },
    ],
    hidden: () => {
      const r = rng(3601);
      const winner = randInt(r, 1, 1e9);
      const others = Array.from({ length: 1499 }, () => randInt(r, 1, 1e9));
      const withMajority = shuffle(r, [...Array.from({ length: 1501 }, () => winner), ...others]);
      return [
        "1\n5",
        "2\n3 3",
        withCount(withMajority),
        withCount(randArray(3602, 3000, 1, 5)),
        withCount([...Array.from({ length: 1500 }, () => 7), ...randArray(3603, 1500, 8, 9)]),
      ];
    },
    solve: (input) => {
      const a = ints(lines(input)[1]);
      const counts = new Map<number, number>();
      for (const v of a) counts.set(v, (counts.get(v) ?? 0) + 1);
      const found = [...counts].find(([, c]) => c * 2 > a.length);
      return String(found ? found[0] : -1);
    },
  },
  {
    slug: "best-stretch",
    title: "Best Stretch",
    difficulty: "medium",
    statement: `Choose a non-empty block of consecutive values from a list so that their sum is as large as possible.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the largest possible sum.

### Constraints
- 1 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- The answer can exceed 32 bits.`,
    samples: [
      { input: "8\n-2 1 -3 4 -1 2 1 -5", explanation: "4 - 1 + 2 + 1 = 6" },
      { input: "3\n-5 -2 -9", explanation: "The block must contain at least one value." },
    ],
    hidden: () => [
      "1\n-1",
      "5\n1 2 3 4 5",
      withCount(randArray(3701, 3000, -100, 100)),
      withCount(randArray(3702, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(3703, 3000, -1_000_000_000, -1)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      let best = a[0]!;
      let current = 0;
      for (const v of a) {
        current = Math.max(v, current + v);
        best = Math.max(best, current);
      }
      return String(best);
    },
  },
  {
    slug: "top-letter",
    title: "Most Common Letter",
    difficulty: "medium",
    statement: `Find the letter that appears most often in a word. If several letters tie, choose the one that comes first in the alphabet.

### Input
One line with a word of lowercase letters.

### Output
Print the letter and how many times it appears, separated by a space.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [
      { input: "banana" },
      { input: "abcabc", explanation: "a, b and c tie; a comes first." },
    ],
    hidden: () => [
      "z",
      "qwertyuiop",
      randString(3801, 3000, LOWER),
      randString(3802, 3000, "xyz"),
      "m".repeat(500) + randString(3803, 1000, "abc"),
    ],
    solve: (input) => {
      const counts = new Map<string, number>();
      for (const c of (lines(input)[0] ?? "").trim()) counts.set(c, (counts.get(c) ?? 0) + 1);
      const [letter, count] = [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]!;
      return `${letter} ${count}`;
    },
  },
  {
    slug: "flip-grid",
    title: "Flip the Grid",
    difficulty: "medium",
    statement: `Turn the rows of a table of numbers into columns: the first row becomes the first column, and so on.

### Input
The first line contains two integers \`r\` and \`c\`. Each of the next \`r\` lines contains \`c\` integers.

### Output
Print \`c\` lines with \`r\` integers each, separated by single spaces.

### Constraints
- 1 ≤ r, c ≤ 500
- -10^9 ≤ each value ≤ 10^9`,
    samples: [{ input: "2 3\n1 2 3\n4 5 6" }, { input: "1 1\n7" }],
    hidden: () => [
      "1 4\n1 2 3 4",
      "3 1\n1\n2\n3",
      randMatrix(3901, 40, 60, -1_000_000_000, 1_000_000_000),
      randMatrix(3902, 77, 13, 0, 9),
      randMatrix(3903, 1, 500, -50, 50),
    ],
    solve: (input) => {
      const rows = lines(input);
      const [r, c] = ints(rows[0]) as [number, number];
      const grid = rows.slice(1, r + 1).map((l) => ints(l));
      return Array.from({ length: c }, (_, j) => grid.map((row) => row[j]).join(" ")).join("\n");
    },
  },
  {
    slug: "spiral-walk",
    title: "Spiral Walk",
    difficulty: "medium",
    statement: `Read a table of numbers in a clockwise spiral: along the top row, down the right side, back along the bottom, up the left side, and so on inwards.

### Input
The first line contains two integers \`r\` and \`c\`. Each of the next \`r\` lines contains \`c\` integers.

### Output
Print all \`r × c\` values in spiral order on one line, separated by single spaces.

### Constraints
- 1 ≤ r, c ≤ 500`,
    samples: [{ input: "3 3\n1 2 3\n4 5 6\n7 8 9" }, { input: "2 4\n1 2 3 4\n5 6 7 8" }],
    hidden: () => [
      "1 1\n5",
      "1 5\n1 2 3 4 5",
      "5 1\n1\n2\n3\n4\n5",
      randMatrix(4001, 30, 47, -99, 99),
      randMatrix(4002, 50, 50, 0, 1_000_000),
    ],
    solve: (input) => {
      const rows = lines(input);
      const [r, c] = ints(rows[0]) as [number, number];
      const grid = rows.slice(1, r + 1).map((l) => ints(l));
      const out: number[] = [];
      let top = 0;
      let bottom = r - 1;
      let left = 0;
      let right = c - 1;
      while (top <= bottom && left <= right) {
        for (let j = left; j <= right; j++) out.push(grid[top]![j]!);
        for (let i = top + 1; i <= bottom; i++) out.push(grid[i]![right]!);
        if (top < bottom) for (let j = right - 1; j >= left; j--) out.push(grid[bottom]![j]!);
        if (left < right) for (let i = bottom - 1; i > top; i--) out.push(grid[i]![left]!);
        top++;
        bottom--;
        left++;
        right--;
      }
      return out.join(" ");
    },
  },
  {
    slug: "pack-letters",
    title: "Pack the Letters",
    difficulty: "medium",
    statement: `Shorten a word by writing each run of the same letter as the letter followed by how many times it repeats.

### Input
One line with a word of lowercase letters.

### Output
Print the packed word. For example \`aaabcc\` becomes \`a3b1c2\`.

### Constraints
- 1 ≤ length ≤ 100000`,
    samples: [{ input: "aaabcc" }, { input: "z" }],
    hidden: () => {
      const r = rng(4101);
      const runs = Array.from({ length: 300 }, () =>
        LOWER[randInt(r, 0, 3)]!.repeat(randInt(r, 1, 12)),
      ).join("");
      return [
        "abc",
        "a".repeat(1000),
        runs,
        randString(4102, 3000, "ab"),
        randString(4103, 3000, LOWER),
      ];
    },
    solve: (input) => {
      const word = (lines(input)[0] ?? "").trim();
      let out = "";
      for (let i = 0; i < word.length;) {
        let j = i;
        while (j < word.length && word[j] === word[i]) j++;
        out += `${word[i]}${j - i}`;
        i = j;
      }
      return out;
    },
  },
  {
    slug: "counting-primes",
    title: "Counting Primes",
    difficulty: "medium",
    statement: `Count the prime numbers that are less than or equal to \`n\`. A prime has exactly two divisors: 1 and itself.

### Input
One line with an integer \`n\`.

### Output
Print the number of primes from 2 to \`n\`.

### Constraints
- 1 ≤ n ≤ 1000000
- Testing every number by trial division is too slow for the largest tests.`,
    samples: [{ input: "10", explanation: "2, 3, 5, 7" }, { input: "1" }],
    hidden: () => {
      const r = rng(4201);
      return [
        "2",
        "1000000",
        "999983",
        String(randInt(r, 1, 1_000_000)),
        String(randInt(r, 500_000, 1_000_000)),
      ];
    },
    solve: (input) => {
      const n = Number((lines(input)[0] ?? "").trim());
      if (n < 2) return "0";
      const composite = new Uint8Array(n + 1);
      let count = 0;
      for (let i = 2; i <= n; i++) {
        if (composite[i]) continue;
        count++;
        for (let j = i * i; j <= n; j += i) composite[j] = 1;
      }
      return String(count);
    },
  },
  {
    slug: "how-many-small",
    title: "How Many Are Small",
    difficulty: "medium",
    statement: `Answer several questions about one list: for each query value \`x\`, how many values in the list are less than or equal to \`x\`?

### Input
- Line 1: an integer \`n\`.
- Line 2: \`n\` integers \`a_i\`.
- Line 3: an integer \`q\`.
- Line 4: \`q\` integers, the queries.

### Output
Print \`q\` lines, one answer per query, in the order given.

### Constraints
- 1 ≤ n, q ≤ 100000
- -10^9 ≤ a_i, x ≤ 10^9
- Counting the whole list for every query is too slow for the largest tests.`,
    samples: [{ input: "5\n3 1 4 1 5\n3\n0 1 4" }, { input: "1\n10\n2\n10 9" }],
    hidden: () => {
      const make = (seed: number, n: number, q: number, lo: number, hi: number) =>
        `${withCount(randArray(seed, n, lo, hi))}\n${withCount(randArray(seed + 50, q, lo, hi))}`;
      return [
        "3\n-5 -5 -5\n1\n-5",
        "2\n-1000000000 1000000000\n3\n-1000000000 0 1000000000",
        make(4301, 3000, 3000, -1_000_000_000, 1_000_000_000),
        make(4302, 3000, 3000, 0, 50),
        make(4303, 1, 3000, -5, 5),
      ];
    },
    solve: (input) => {
      const rows = lines(input);
      const sorted = ints(rows[1]).sort((a, b) => a - b);
      return ints(rows[3])
        .map((x) => upperBound(sorted, x))
        .join("\n");
    },
  },
  {
    slug: "next-taller",
    title: "Next Taller",
    difficulty: "medium",
    statement: `For each value in a list, find the first value to its right that is strictly greater.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print \`n\` numbers on one line: for each position, the next greater value, or \`-1\` if there is none.

### Constraints
- 1 ≤ n ≤ 100000
- 1 ≤ a_i ≤ 10^9
- Checking every pair of positions is too slow for the largest tests.`,
    samples: [{ input: "5\n2 1 3 2 4" }, { input: "3\n3 2 1" }],
    hidden: () => [
      "1\n5",
      "4\n1 2 3 4",
      "5\n5 5 5 5 5",
      withCount(randArray(4401, 3000, 1, 100)),
      withCount(randArray(4402, 3000, 1, 1_000_000_000)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]);
      const answer = new Array<number>(a.length).fill(-1);
      const stack: number[] = [];
      a.forEach((v, i) => {
        while (stack.length > 0 && a[stack[stack.length - 1]!]! < v) answer[stack.pop()!] = v;
        stack.push(i);
      });
      return answer.join(" ");
    },
  },
  {
    slug: "one-trade",
    title: "One Trade",
    difficulty: "medium",
    statement: `You know the price of an item on each of \`n\` days. Buy it on one day and sell it on a **later** day. What is the largest profit you can make? If no trade makes money, the answer is 0.

### Input
The first line contains an integer \`n\`. The second line contains \`n\` prices.

### Output
Print the largest profit.

### Constraints
- 1 ≤ n ≤ 100000
- 1 ≤ price ≤ 10^9`,
    samples: [
      { input: "6\n7 1 5 3 6 4", explanation: "Buy at 1, sell at 6." },
      { input: "4\n9 7 4 1", explanation: "Prices only fall." },
    ],
    hidden: () => [
      "1\n5",
      "2\n1 1000000000",
      withCount(Array.from({ length: 2000 }, (_, i) => 2000 - i)),
      withCount(randArray(4501, 3000, 1, 1_000_000_000)),
      withCount(randArray(4502, 3000, 1, 20)),
    ],
    solve: (input) => {
      let cheapest = Infinity;
      let best = 0;
      for (const price of ints(lines(input)[1])) {
        best = Math.max(best, price - cheapest);
        cheapest = Math.min(cheapest, price);
      }
      return String(best);
    },
  },
  {
    slug: "best-window",
    title: "Best Window",
    difficulty: "medium",
    statement: `Find the largest sum of exactly \`k\` consecutive values in a list.

### Input
The first line contains two integers \`n\` and \`k\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the largest sum of \`k\` consecutive values.

### Constraints
- 1 ≤ k ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- The answer can exceed 32 bits.`,
    samples: [{ input: "5 2\n1 -2 3 4 -1", explanation: "3 + 4 = 7" }, { input: "3 3\n-1 -1 -1" }],
    hidden: () => {
      const make = (seed: number, n: number, k: number, lo: number, hi: number) =>
        `${n} ${k}\n${randArray(seed, n, lo, hi).join(" ")}`;
      return [
        "1 1\n-9",
        make(4601, 3000, 1, -1_000_000_000, 1_000_000_000),
        make(4602, 3000, 1500, -1_000_000_000, 1_000_000_000),
        make(4603, 3000, 3000, -5, 5),
        make(4604, 3000, 37, -100, 100),
      ];
    },
    solve: (input) => {
      const [first, second] = lines(input);
      const k = ints(first)[1]!;
      const a = ints(second);
      let sum = a.slice(0, k).reduce((s, v) => s + v, 0);
      let best = sum;
      for (let i = k; i < a.length; i++) {
        sum += a[i]! - a[i - k]!;
        best = Math.max(best, sum);
      }
      return String(best);
    },
  },
  {
    slug: "closest-pair",
    title: "Closest Pair",
    difficulty: "medium",
    statement: `Find the smallest difference between any two values in a list (taken from two different positions).

### Input
The first line contains an integer \`n\`. The second line contains \`n\` integers \`a_i\`.

### Output
Print the smallest absolute difference between two values at different positions.

### Constraints
- 2 ≤ n ≤ 100000
- -10^9 ≤ a_i ≤ 10^9
- Comparing every pair is too slow for the largest tests.`,
    samples: [{ input: "4\n10 3 7 1", explanation: "1 and 3 differ by 2." }, { input: "2\n5 5" }],
    hidden: () => [
      "2\n-1000000000 1000000000",
      "3\n1 100 50",
      withCount(randArray(4701, 3000, -1_000_000_000, 1_000_000_000)),
      withCount(randArray(4702, 3000, 0, 1_000_000)),
      withCount(Array.from({ length: 2000 }, (_, i) => i * 3)),
    ],
    solve: (input) => {
      const a = ints(lines(input)[1]).sort((x, y) => x - y);
      let best = Infinity;
      for (let i = 1; i < a.length; i++) best = Math.min(best, a[i]! - a[i - 1]!);
      return String(best);
    },
  },

  // ================================================================= hard
  {
    slug: "fewest-edits",
    title: "Fewest Edits",
    difficulty: "hard",
    statement: `Turn one word into another using as few edits as possible. One edit inserts a letter, deletes a letter, or replaces a letter with another.

### Input
Two lines, each with a word of lowercase letters.

### Output
Print the minimum number of edits.

### Constraints
- 1 ≤ length of each word ≤ 1000`,
    samples: [
      { input: "kitten\nsitting", explanation: "k→s, e→i, then insert g." },
      { input: "abc\nabc" },
    ],
    hidden: () => [
      "a\nb",
      "a\nabcdef",
      `${randString(4801, 400, "ab")}\n${randString(4802, 400, "ab")}`,
      `${randString(4803, 500, LOWER)}\n${randString(4804, 450, LOWER)}`,
      `${randString(4805, 600, "abc")}\n${randString(4806, 300, "abc")}`,
    ],
    solve: (input) => {
      const [a, b] = lines(input).map((l) => l.trim()) as [string, string];
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
          const replace = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
          row.push(Math.min(replace, prev[j]! + 1, row[j - 1]! + 1));
        }
        prev = row;
      }
      return String(prev[b.length]);
    },
  },
  {
    slug: "common-thread",
    title: "Common Thread",
    difficulty: "hard",
    statement: `Find the length of the longest sequence of letters that appears in both words in the same order. The letters do not have to be next to each other.

### Input
Two lines, each with a word of lowercase letters.

### Output
Print the length of the longest common sequence.

### Constraints
- 1 ≤ length of each word ≤ 1000`,
    samples: [
      { input: "abcde\nace", explanation: "a, c, e appear in order in both." },
      { input: "abc\ndef" },
    ],
    hidden: () => [
      "a\na",
      "abc\ncba",
      `${randString(4901, 400, "ab")}\n${randString(4902, 400, "ab")}`,
      `${randString(4903, 500, LOWER)}\n${randString(4904, 450, LOWER)}`,
      `${randString(4905, 600, "abcd")}\n${randString(4906, 350, "abcd")}`,
    ],
    solve: (input) => {
      const [a, b] = lines(input).map((l) => l.trim()) as [string, string];
      let prev = new Array<number>(b.length + 1).fill(0);
      for (let i = 1; i <= a.length; i++) {
        const row = [0];
        for (let j = 1; j <= b.length; j++) {
          row.push(a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!));
        }
        prev = row;
      }
      return String(prev[b.length]);
    },
  },
  {
    slug: "pack-the-bag",
    title: "Pack the Bag",
    difficulty: "hard",
    statement: `You have \`n\` items, each with a weight and a value, and a bag that holds a total weight of at most \`W\`. Each item can be taken at most once. What is the largest total value you can carry?

### Input
The first line contains two integers \`n\` and \`W\`. Each of the next \`n\` lines contains two integers: an item's weight and value.

### Output
Print the largest total value.

### Constraints
- 1 ≤ n ≤ 100
- 1 ≤ W ≤ 10000
- 1 ≤ weight ≤ 10000, 1 ≤ value ≤ 10^6`,
    samples: [
      { input: "3 5\n2 3\n3 4\n4 5", explanation: "Take the first two items: weight 5, value 7." },
      { input: "1 1\n2 10", explanation: "The only item is too heavy." },
    ],
    hidden: () => {
      const make = (seed: number, n: number, cap: number, maxWeight: number) => {
        const r = rng(seed);
        const items = Array.from(
          { length: n },
          () => `${randInt(r, 1, maxWeight)} ${randInt(r, 1, 1000)}`,
        );
        return `${n} ${cap}\n${items.join("\n")}`;
      };
      return [
        "1 10\n10 7",
        "2 5\n6 100\n7 200",
        make(5001, 100, 5000, 500),
        make(5002, 60, 1000, 100),
        make(5003, 100, 10000, 10000),
      ];
    },
    solve: (input) => {
      const rows = lines(input);
      const cap = ints(rows[0])[1]!;
      const best = new Array<number>(cap + 1).fill(0);
      for (const row of rows.slice(1)) {
        const [weight, value] = ints(row) as [number, number];
        for (let w = cap; w >= weight; w--) best[w] = Math.max(best[w]!, best[w - weight]! + value);
      }
      return String(best[cap]);
    },
  },
  {
    slug: "cheapest-route",
    title: "Cheapest Route",
    difficulty: "hard",
    statement: `Towns 1 to \`n\` are joined by two-way roads, each with a toll. Find the cheapest total toll to travel from town 1 to town \`n\`.

### Input
The first line contains two integers \`n\` and \`m\`. Each of the next \`m\` lines contains three integers \`u\`, \`v\` and \`w\`: a road between towns \`u\` and \`v\` with toll \`w\`.

### Output
Print the cheapest total toll, or \`-1\` if town \`n\` cannot be reached.

### Constraints
- 1 ≤ n ≤ 10000, 0 ≤ m ≤ 20000
- 1 ≤ w ≤ 10^6
- Roads may repeat, and a road may join a town to itself.`,
    samples: [
      { input: "4 4\n1 2 5\n2 4 5\n1 3 2\n3 4 9", explanation: "1 → 2 → 4 costs 10." },
      { input: "3 1\n1 2 4", explanation: "Town 3 has no roads." },
    ],
    hidden: () => {
      const make = (seed: number, n: number, extra: number, chain: boolean) => {
        const r = rng(seed);
        const roads: string[] = [];
        if (chain) {
          for (let v = 2; v <= n; v++)
            roads.push(`${randInt(r, 1, v - 1)} ${v} ${randInt(r, 1, 1_000_000)}`);
        }
        for (let i = 0; i < extra; i++) {
          roads.push(`${randInt(r, 1, n)} ${randInt(r, 1, n)} ${randInt(r, 1, 1_000_000)}`);
        }
        const shuffled = shuffle(r, roads);
        return `${n} ${shuffled.length}\n${shuffled.join("\n")}`;
      };
      return [
        "1 0",
        "2 1\n1 2 7",
        "3 3\n1 2 1\n2 3 1\n1 3 5",
        make(5101, 2000, 4000, true),
        make(5102, 3000, 1500, false),
      ];
    },
    solve: (input) => {
      const n = ints(lines(input)[0])[0]!;
      const adjacent: [number, number][][] = Array.from({ length: n + 1 }, () => []);
      for (const [u, v, w] of edgeList(input) as [number, number, number][]) {
        adjacent[u]!.push([v, w]);
        adjacent[v]!.push([u, w]);
      }
      const dist = new Array<number>(n + 1).fill(Infinity);
      dist[1] = 0;
      // Binary heap of [distance, town].
      const heap: [number, number][] = [[0, 1]];
      const push = (item: [number, number]) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (heap[parent]![0] <= heap[i]![0]) break;
          [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
          i = parent;
        }
      };
      const pop = (): [number, number] => {
        const top = heap[0]!;
        const last = heap.pop()!;
        if (heap.length > 0) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let smallest = i;
            if (l < heap.length && heap[l]![0] < heap[smallest]![0]) smallest = l;
            if (r < heap.length && heap[r]![0] < heap[smallest]![0]) smallest = r;
            if (smallest === i) break;
            [heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!];
            i = smallest;
          }
        }
        return top;
      };
      while (heap.length > 0) {
        const [d, town] = pop();
        if (d > dist[town]!) continue;
        for (const [next, w] of adjacent[town]!) {
          if (d + w < dist[next]!) {
            dist[next] = d + w;
            push([d + w, next]);
          }
        }
      }
      return String(Number.isFinite(dist[n]!) ? dist[n] : -1);
    },
  },
  {
    slug: "paths-around-rocks",
    title: "Paths Around Rocks",
    difficulty: "hard",
    statement: `A grid has open cells (\`.\`) and rocks (\`#\`). Starting at the top-left cell and moving only right or down, count the ways to reach the bottom-right cell without stepping on a rock. The count can be huge, so print it modulo 1000000007.

### Input
The first line contains two integers \`r\` and \`c\`. Each of the next \`r\` lines contains \`c\` characters, each \`.\` or \`#\`.

### Output
Print the number of paths modulo 1000000007. If the start or the end is a rock, the answer is 0.

### Constraints
- 1 ≤ r, c ≤ 1000`,
    samples: [
      { input: "3 3\n...\n.#.\n...", explanation: "Around the rock on either side." },
      { input: "2 2\n.#\n#.", explanation: "Both ways are blocked." },
    ],
    hidden: () => [
      "1 1\n.",
      "1 1\n#",
      "2 3\n...\n...",
      `100 100\n${randGrid(5201, 100, 100, 0.1, "#", ".").join("\n")}`,
      `200 150\n${randGrid(5202, 200, 150, 0.2, "#", ".").join("\n")}`,
      `60 60\n${randGrid(5203, 60, 60, 0, "#", ".").join("\n")}`,
    ],
    solve: (input) => {
      const rows = lines(input);
      const [r, c] = ints(rows[0]) as [number, number];
      const grid = rows.slice(1, r + 1);
      const MOD = 1_000_000_007;
      const ways = new Array<number>(c).fill(0);
      for (let i = 0; i < r; i++) {
        for (let j = 0; j < c; j++) {
          if (grid[i]![j] === "#") ways[j] = 0;
          else if (i === 0 && j === 0) ways[j] = 1;
          else if (j > 0) ways[j] = (ways[j]! + ways[j - 1]!) % MOD;
        }
      }
      return String(ways[c - 1]);
    },
  },
  {
    slug: "task-order",
    title: "Task Order",
    difficulty: "hard",
    statement: `There are \`n\` tasks and \`m\` rules. A rule \`a b\` means task \`a\` must be done before task \`b\`. Can all tasks be done in some order that respects every rule?

### Input
The first line contains two integers \`n\` and \`m\`. Each of the next \`m\` lines contains two integers \`a\` and \`b\`.

### Output
Print \`YES\` if such an order exists, otherwise \`NO\`.

### Constraints
- 1 ≤ n ≤ 10000, 0 ≤ m ≤ 20000
- A rule may repeat. A rule \`a a\` can never be satisfied.`,
    samples: [
      { input: "3 2\n1 2\n2 3", explanation: "Do 1, then 2, then 3." },
      { input: "2 2\n1 2\n2 1", explanation: "Each task must come before the other." },
    ],
    hidden: () => {
      const dag = (seed: number, n: number, m: number, backEdge: boolean) => {
        const r = rng(seed);
        const order = shuffle(
          r,
          Array.from({ length: n }, (_, i) => i + 1),
        );
        const rules: string[] = [];
        for (let i = 0; i < m; i++) {
          let x = randInt(r, 0, n - 1);
          let y = randInt(r, 0, n - 1);
          if (x === y) y = (y + 1) % n;
          if (x > y) [x, y] = [y, x];
          rules.push(`${order[x]} ${order[y]}`);
        }
        if (backEdge) {
          // A chain through the first three tasks, closed into a loop.
          rules.push(
            `${order[0]} ${order[1]}`,
            `${order[1]} ${order[2]}`,
            `${order[2]} ${order[0]}`,
          );
        }
        const shuffled = shuffle(r, rules);
        return `${n} ${shuffled.length}\n${shuffled.join("\n")}`;
      };
      return [
        "1 0",
        "1 1\n1 1",
        "4 3\n1 2\n2 3\n3 4",
        dag(5301, 2000, 5000, false),
        dag(5302, 2000, 5000, true),
      ];
    },
    solve: (input) => {
      const n = ints(lines(input)[0])[0]!;
      const after: number[][] = Array.from({ length: n + 1 }, () => []);
      const waiting = new Array<number>(n + 1).fill(0);
      for (const [a, b] of edgeList(input) as [number, number][]) {
        after[a]!.push(b);
        waiting[b]!++;
      }
      const ready: number[] = [];
      for (let t = 1; t <= n; t++) if (waiting[t] === 0) ready.push(t);
      let done = 0;
      while (ready.length > 0) {
        const t = ready.pop()!;
        done++;
        for (const next of after[t]!) if (--waiting[next]! === 0) ready.push(next);
      }
      return done === n ? "YES" : "NO";
    },
  },
  {
    slug: "longest-mirror",
    title: "Longest Mirror Piece",
    difficulty: "hard",
    statement: `Find the longest block of consecutive letters in a word that reads the same forwards and backwards.

### Input
One line with a word of lowercase letters.

### Output
Print the length of the longest such block.

### Constraints
- 1 ≤ length ≤ 1000`,
    samples: [
      { input: "babad", explanation: '"bab" or "aba"' },
      { input: "cbbd", explanation: '"bb"' },
    ],
    hidden: () => {
      const r = rng(5401);
      const half = randWord(r, 150, 150, "abc");
      return [
        "a",
        "a".repeat(1000),
        randString(5402, 1000, "ab"),
        randString(5403, 1000, LOWER),
        randWord(r, 300, 300) + half + reverse(half) + randWord(r, 300, 300),
      ];
    },
    solve: (input) => {
      const s = (lines(input)[0] ?? "").trim();
      let best = 0;
      for (let center = 0; center < 2 * s.length - 1; center++) {
        let left = Math.floor(center / 2);
        let right = left + (center % 2);
        while (left >= 0 && right < s.length && s[left] === s[right]) {
          left--;
          right++;
        }
        best = Math.max(best, right - left - 1);
      }
      return String(best);
    },
  },
  {
    slug: "most-meetings",
    title: "Most Meetings",
    difficulty: "hard",
    statement: `Each meeting has a start time and an end time. You can attend only one meeting at a time, but you may start a meeting at the exact moment the previous one ends. What is the largest number of meetings you can attend in full?

### Input
The first line contains an integer \`n\`. Each of the next \`n\` lines contains two integers \`s\` and \`e\` with \`s < e\`.

### Output
Print the largest number of meetings you can attend.

### Constraints
- 1 ≤ n ≤ 100000
- 0 ≤ s < e ≤ 10^9`,
    samples: [
      { input: "4\n1 3\n2 4\n3 5\n6 7", explanation: "1–3, 3–5 and 6–7." },
      { input: "3\n1 10\n2 3\n4 5" },
    ],
    hidden: () => {
      const make = (seed: number, n: number, maxStart: number, maxLength: number) => {
        const r = rng(seed);
        const rows = Array.from({ length: n }, () => {
          const s = randInt(r, 0, maxStart);
          return `${s} ${s + randInt(r, 1, maxLength)}`;
        });
        return `${n}\n${rows.join("\n")}`;
      };
      return [
        "1\n5 6",
        "3\n1 2\n1 2\n1 2",
        "4\n1 10\n2 9\n3 8\n4 7",
        make(5501, 3000, 1_000_000, 10_000),
        make(5502, 3000, 100, 5),
      ];
    },
    solve: (input) => {
      const meetings = lines(input)
        .slice(1)
        .map((l) => ints(l) as [number, number])
        .sort((x, y) => x[1] - y[1]);
      let count = 0;
      let freeAt = -Infinity;
      for (const [s, e] of meetings) {
        if (s >= freeAt) {
          count++;
          freeAt = e;
        }
      }
      return String(count);
    },
  },
];
