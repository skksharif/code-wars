import { describe, expect, it } from "vitest";
import { isLanguage, LANGUAGES, LIMITS, matchWindow, USERNAME_PATTERN } from "./index";

describe("shared constants", () => {
  it("offers exactly the four approved languages", () => {
    expect([...LANGUAGES].sort()).toEqual(["cpp", "java", "javascript", "python"]);
  });

  it("recognises only approved languages", () => {
    expect(isLanguage("python")).toBe(true);
    expect(isLanguage("rust")).toBe(false);
    expect(isLanguage(42)).toBe(false);
  });

  it("matches the approved battle rules", () => {
    expect(LIMITS.initialRating).toBe(1200);
    expect(LIMITS.eloK).toBe(32);
    expect(LIMITS.battleDurationMs).toBe(900_000);
  });

  it("widens the match window by 50 every 10 seconds from 100", () => {
    expect(matchWindow(0)).toBe(100);
    expect(matchWindow(9_999)).toBe(100);
    expect(matchWindow(10_000)).toBe(150);
    expect(matchWindow(35_000)).toBe(250);
    expect(matchWindow(-5)).toBe(100);
  });

  it("validates usernames", () => {
    expect(USERNAME_PATTERN.test("coder_42")).toBe(true);
    expect(USERNAME_PATTERN.test("ab")).toBe(false);
    expect(USERNAME_PATTERN.test("has space")).toBe(false);
    expect(USERNAME_PATTERN.test("<script>")).toBe(false);
  });
});
