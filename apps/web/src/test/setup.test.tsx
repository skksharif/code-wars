// @vitest-environment jsdom
import { getConfig } from "@testing-library/react";
import { expect, it } from "vitest";

it("gives on-screen checks five seconds, as configured in setup.ts", () => {
  expect(getConfig().asyncUtilTimeout).toBe(5000);
});
