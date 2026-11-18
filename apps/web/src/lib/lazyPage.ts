import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "code-wars:chunk-reload-at";

/**
 * Loads a page's code on demand, and recovers when that download fails, for
 * example just after a deploy, when an open tab still asks for an older file.
 * It retries once; if that fails too it reloads the page (at most once a
 * minute, so a real outage shows an error rather than reloading forever).
 */
export function loadWithRecovery<T>(
  load: () => Promise<T>,
  { retryDelayMs = 1000, storage = safeSession(), reload = () => window.location.reload() } = {},
): Promise<T> {
  return load().catch(
    () =>
      new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          load().then(resolve, (error: unknown) => {
            const last = Number(storage?.getItem(RELOAD_KEY) ?? 0);
            if (storage && Date.now() - last > 60_000) {
              storage.setItem(RELOAD_KEY, String(Date.now()));
              reload();
              return; // The page is going away; leave the promise pending.
            }
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }, retryDelayMs);
      }),
  );
}

export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(() => loadWithRecovery(load).then((component) => ({ default: component })));
}

function safeSession(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
