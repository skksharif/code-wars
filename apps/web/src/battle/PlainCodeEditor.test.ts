import { describe, expect, it } from "vitest";
import { newLineFor } from "./PlainCodeEditor";

const at = (text: string) => newLineFor(text, text.length);

describe("plain code box: new lines", () => {
  it("keeps the current line's indentation", () => {
    expect(at("    x = 1")).toBe("\n    ");
    expect(at("\tx = 1")).toBe("\n\t");
    expect(at("x = 1")).toBe("\n");
  });

  it("indents one level after a line that opens a block", () => {
    expect(at("def f(a):")).toBe("\n    ");
    expect(at("    for (int i = 0; i < n; i++) {")).toBe("\n        ");
    expect(at("const xs = [")).toBe("\n    ");
    expect(at("if (x) {  ")).toBe("\n    ");
  });

  it("looks only at the line the caret is on", () => {
    const text = "def f():\n    return 1\nx = f()";
    expect(newLineFor(text, text.indexOf("return 1") + "return 1".length)).toBe("\n    ");
    expect(newLineFor(text, text.length)).toBe("\n");
    expect(newLineFor(text, "def f():".length)).toBe("\n    ");
  });
});
