import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "supabase/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Database test files each start an in-process Postgres and load the seed.
    // With many files in parallel that setup can take well over the 10 s default.
    setupFiles: ["apps/web/src/test/setup.ts"],
    globalSetup: ["supabase/tests/global-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
