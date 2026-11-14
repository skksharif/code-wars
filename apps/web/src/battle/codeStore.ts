import { isLanguage, type Language } from "@code-wars/shared";

/** Minimal programs that read stdin, so players start from something that runs. */
export const STARTER_CODE: Record<Language, string> = {
  python: `import sys

def main():
    data = sys.stdin.read().split()
    # Write your solution here.

main()
`,
  java: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        // Write your solution here.
    }
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Write your solution here.
    return 0;
}
`,
  javascript: `const lines = require("fs").readFileSync(0, "utf8").split("\\n");
// Write your solution here.
`,
};

const LANGUAGE_KEY = "cw:language";
const codeKey = (battleId: string, language: Language) => `cw:code:${battleId}:${language}`;

/** Browser storage can be unavailable (private mode); the app works without it. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the code simply is not saved across reloads.
  }
}

export function loadLanguage(): Language {
  const saved = read(LANGUAGE_KEY);
  return isLanguage(saved) ? saved : "python";
}

export function saveLanguage(language: Language): void {
  write(LANGUAGE_KEY, language);
}

export function loadCode(battleId: string, language: Language): string {
  return read(codeKey(battleId, language)) ?? STARTER_CODE[language];
}

export function saveCode(battleId: string, language: Language, code: string): void {
  write(codeKey(battleId, language), code);
}
