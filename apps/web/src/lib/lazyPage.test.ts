import { describe, expect, it, vi } from "vitest";
import { loadWithRecovery } from "./lazyPage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("loading a page's code", () => {
  it("retries once when the download fails, without reloading", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("stale")).mockResolvedValue("page");
    const reload = vi.fn();
    await expect(
      loadWithRecovery(load, { retryDelayMs: 0, storage: memoryStorage(), reload }),
    ).resolves.toBe("page");
    expect(load).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the page once if the retry fails too, then gives up with an error", async () => {
    const load = vi.fn().mockRejectedValue(new Error("gone"));
    const storage = memoryStorage();
    const reload = vi.fn();
    void loadWithRecovery(load, { retryDelayMs: 0, storage, reload });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // Straight after that reload it fails again: show the error, no reload loop.
    await expect(loadWithRecovery(load, { retryDelayMs: 0, storage, reload })).rejects.toThrow(
      "gone",
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
