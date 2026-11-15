/**
 * Runs before every test file. In browser-like tests, give on-screen checks
 * longer than the 1 s default: when the database test files run in parallel
 * the first render of a page can be slow.
 */
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 5000 });
  // jsdom has no layout, so scrolling does nothing (and would log a warning).
  window.scrollTo = () => undefined;
}

export {};
