import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeedSql } from "../seed/generate.ts";
import { PROBLEMS, setHiddenTestSalt } from "../seed/problems.ts";
import { all, createDb, TEST_SALT } from "./helpers.ts";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(() => db.close());

describe("seed problems", () => {
  it("derives randomised hidden tests from the secret salt", () => {
    const hiddenWith = (salt: string) => {
      setHiddenTestSalt(salt);
      return PROBLEMS.map((p) => p.hidden());
    };
    const a1 = hiddenWith("first-secret-salt-value");
    const a2 = hiddenWith("first-secret-salt-value");
    const b = hiddenWith("other-secret-salt-value");
    setHiddenTestSalt(TEST_SALT);

    expect(a2).toEqual(a1);
    // Every problem has at least one hidden test that changes with the salt.
    PROBLEMS.forEach((p, i) => {
      const changed = a1[i]!.filter((input, j) => input !== b[i]![j]).length;
      expect(changed, p.slug).toBeGreaterThan(0);
    });
    // Samples are public by design and do not depend on the salt.
    const sampleJson = JSON.stringify({
      input: "5\n1 2 3 4 5",
      output: "6",
      explanation: "2 + 4 = 6",
    });
    expect(buildSeedSql("first-secret-salt-value")).toContain(sampleJson);
    expect(buildSeedSql("other-secret-salt-value")).toContain(sampleJson);
  });

  it("refuses a short salt", () => {
    expect(() => buildSeedSql("short")).toThrow("at least 16 characters");
  });

  it("every problem has two samples and at least five hidden tests", async () => {
    const rows = await all<{ slug: string; samples: number; hidden: number }>(
      db,
      `select p.slug, jsonb_array_length(p.samples) as samples,
              (select count(*)::int from public.problem_tests t where t.problem_id = p.id) as hidden
       from public.problems p order by p.slug`,
    );
    expect(rows).toHaveLength(PROBLEMS.length);
    for (const row of rows) {
      expect(row.samples, row.slug).toBe(2);
      expect(row.hidden, row.slug).toBeGreaterThanOrEqual(5);
    }
  });

  it("covers every difficulty", async () => {
    const rows = await all<{ difficulty: string; n: number }>(
      db,
      "select difficulty, count(*)::int as n from public.problems group by difficulty order by difficulty",
    );
    expect(rows).toEqual([
      { difficulty: "easy", n: 20 },
      { difficulty: "hard", n: 12 },
      { difficulty: "medium", n: 18 },
    ]);
  });

  it("reference solutions give known answers", () => {
    const solve = (slug: string, input: string) =>
      PROBLEMS.find((p) => p.slug === slug)!.solve(input);
    expect(solve("sum-of-evens", "5\n1 2 3 4 5")).toBe("6");
    expect(solve("count-vowels", "Hello World")).toBe("3");
    expect(solve("second-largest", "5\n3 9 9 4 1")).toBe("4");
    expect(solve("second-largest", "3\n5 5 5")).toBe("-1");
    expect(solve("reverse-words", "code wars is fun")).toBe("fun is wars code");
    expect(solve("digit-root", "9875")).toBe("2");
    expect(solve("peak-count", "7\n1 3 2 5 5 4 6")).toBe("1");
    expect(solve("balanced-brackets", "{[()]}()")).toBe("YES");
    expect(solve("balanced-brackets", "([)]")).toBe("NO");
    expect(solve("longest-unique-run", "abcabcbb")).toBe("3");
    expect(solve("pair-sum-count", "5 6\n1 5 3 3 2")).toBe("2");
    expect(solve("merge-intervals", "4\n1 3\n2 6\n8 10\n10 12")).toBe("2 9");
    expect(solve("fewest-coins", "3 11\n1 5 6")).toBe("2");
    expect(solve("fewest-coins", "2 7\n2 4")).toBe("-1");
    expect(solve("grid-escape", "3 4\nS.#.\n.##.\n...E")).toBe("5");
    expect(solve("grid-escape", "1 3\nS#E")).toBe("-1");
    expect(solve("rotate-array", "5 2\n1 2 3 4 5")).toBe("4 5 1 2 3");
    expect(solve("rotate-array", "3 7\n10 20 30")).toBe("30 10 20");
    expect(solve("rotate-array", "1 1000000000\n9")).toBe("9");
    expect(solve("longest-increasing", "8\n10 9 2 5 3 7 101 18")).toBe("4");
    expect(solve("longest-increasing", "5\n5 5 5 5 5")).toBe("1");
    expect(solve("longest-increasing", "6\n1 2 3 4 5 6")).toBe("6");
    expect(solve("count-islands", "4 5\n##..#\n#...#\n..#..\n....#")).toBe("4");
    expect(solve("count-islands", "2 2\n..\n..")).toBe("0");
    expect(solve("count-islands", "3 3\n#.#\n.#.\n#.#")).toBe("5");
    expect(solve("count-islands", "3 3\n###\n#.#\n###")).toBe("1");
  });

  it("gives the expected answers for every sample of the extended set", () => {
    // Checked against independent Python solutions before being written here.
    const expected: Record<string, [string, string]> = {
      "list-range": ["8", "0"],
      "below-zero": ["3", "0"],
      "mirror-word": ["YES", "NO"],
      "multiples-count": ["7", "3"],
      "even-digits": ["3", "1"],
      "running-total": ["1 3 6 10", "5 0 5"],
      "longest-word": ["5", "3"],
      "capital-count": ["2", "0"],
      "distinct-values": ["3", "1"],
      "average-floor": ["2", "-2"],
      "max-positions": ["2 4", "1"],
      "swap-case": ["hELLO wORLD", "ABC xyz"],
      "leap-years": ["2", "0"],
      "odd-one-out": ["4", "7"],
      "same-letters": ["YES", "NO"],
      "majority-value": ["2", "-1"],
      "best-stretch": ["6", "-2"],
      "top-letter": ["a 3", "a 2"],
      "flip-grid": ["1 4\n2 5\n3 6", "7"],
      "spiral-walk": ["1 2 3 6 9 8 7 4 5", "1 2 3 4 8 7 6 5"],
      "pack-letters": ["a3b1c2", "z1"],
      "counting-primes": ["4", "0"],
      "how-many-small": ["0\n2\n4", "1\n0"],
      "next-taller": ["3 3 4 4 -1", "-1 -1 -1"],
      "one-trade": ["5", "0"],
      "best-window": ["7", "-3"],
      "closest-pair": ["2", "0"],
      "fewest-edits": ["3", "0"],
      "common-thread": ["3", "0"],
      "pack-the-bag": ["7", "0"],
      "cheapest-route": ["10", "-1"],
      "paths-around-rocks": ["2", "0"],
      "task-order": ["YES", "NO"],
      "longest-mirror": ["3", "2"],
      "most-meetings": ["3", "2"],
    };
    const extended = PROBLEMS.slice(15);
    expect(extended.map((p) => p.slug).sort()).toEqual(Object.keys(expected).sort());
    for (const p of extended) {
      expect(
        p.samples.map((s) => p.solve(s.input)),
        p.slug,
      ).toEqual(expected[p.slug]);
    }
  });

  it("test inputs have no blank lines, carriage returns or stray whitespace", () => {
    for (const p of PROBLEMS) {
      for (const input of [...p.hidden(), ...p.samples.map((s) => s.input)]) {
        expect(input.length, p.slug).toBeGreaterThan(0);
        expect(input, p.slug).not.toMatch(/\n\n|\s$|^\s|\r/);
      }
    }
  });
});
