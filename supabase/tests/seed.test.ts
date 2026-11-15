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
      { difficulty: "easy", n: 6 },
      { difficulty: "hard", n: 2 },
      { difficulty: "medium", n: 4 },
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
