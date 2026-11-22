// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AD_UNITS } from "../lib/ads";
import { AdSlot } from "./AdSlot";

afterEach(() => {
  cleanup();
  AD_UNITS.result = "";
  delete window.adsbygoogle;
});

describe("AdSlot", () => {
  it("renders nothing, and reserves no space, until its unit id is set", () => {
    const { container } = render(<AdSlot unit="result" />);
    expect(container).toBeEmptyDOMElement();
    expect(window.adsbygoogle).toBeUndefined();
  });

  it("shows a labelled, space-reserving AdSense slot and requests one ad", () => {
    AD_UNITS.result = "1234567890";
    render(<AdSlot unit="result" />);
    const ad = screen.getByRole("complementary", { name: "Advertisement" });
    expect(ad).toHaveTextContent("Advertisement");
    const slot = ad.querySelector("ins.adsbygoogle");
    expect(slot).toHaveAttribute("data-ad-client", "ca-pub-2765142427670001");
    expect(slot).toHaveAttribute("data-ad-slot", "1234567890");
    expect(slot?.parentElement).toHaveClass("min-h-[250px]");
    expect(window.adsbygoogle).toHaveLength(1);
  });
});
