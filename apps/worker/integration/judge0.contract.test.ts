import { describe, expect, it } from "vitest";
import { Judge0Provider } from "../src/judge/judge0";
import type { ExecuteRequest } from "../src/judge/types";

/**
 * Contract test against the REAL Judge0 service. Each test is one paid
 * execution, so it only runs when asked for:
 *
 *   JUDGE0_CONTRACT=1 JUDGE0_API_URL=... JUDGE0_API_HOST=... JUDGE0_API_KEY=... npx vitest run judge0.contract
 */
declare const process: { env: Record<string, string | undefined> };
const env = process.env;
const enabled = env.JUDGE0_CONTRACT === "1" && Boolean(env.JUDGE0_API_URL && env.JUDGE0_API_KEY);

const judge = new Judge0Provider({
  apiUrl: env.JUDGE0_API_URL ?? "",
  apiKey: env.JUDGE0_API_KEY ?? "",
  apiHost: env.JUDGE0_API_HOST || undefined,
});

const request = (overrides: Partial<ExecuteRequest>): ExecuteRequest => ({
  language: "python",
  sourceCode: "",
  stdin: "20 22\n",
  timeLimitMs: 2000,
  memoryLimitKb: 128000,
  ...overrides,
});

// Each program reads two integers and prints their sum, using the starter-code style.
const SUM_PROGRAMS = {
  python: "import sys\na, b = map(int, sys.stdin.read().split())\nprint(a + b)\n",
  java: `import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        System.out.println(in.nextInt() + in.nextInt());
    }
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;
int main() {
    long long a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`,
  javascript: `const [a, b] = require("fs").readFileSync(0, "utf8").trim().split(" ").map(Number);
console.log(a + b);
`,
} as const;

describe.skipIf(!enabled)("Judge0 contract (real service, paid executions)", () => {
  for (const language of ["python", "java", "cpp", "javascript"] as const) {
    it(`runs ${language} and returns its output`, async () => {
      const result = await judge.execute(request({ language, sourceCode: SUM_PROGRAMS[language] }));
      expect(result.status, result.compileOutput).toBe("ok");
      expect(result.stdout.trim()).toBe("42");
    }, 60_000);
  }

  it("reports a compile error with the compiler's message", async () => {
    const result = await judge.execute(
      request({ language: "cpp", sourceCode: "int main() { return missing; }" }),
    );
    expect(result.status).toBe("compile_error");
    expect(result.compileOutput).toContain("missing");
  }, 60_000);

  it("reports a time limit for an endless loop", async () => {
    const result = await judge.execute(
      request({ sourceCode: "while True:\n    pass\n", timeLimitMs: 1000 }),
    );
    expect(result.status).toBe("time_limit");
  }, 60_000);
});
