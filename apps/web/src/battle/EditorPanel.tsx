import { LANGUAGE_LABELS, LANGUAGES, LIMITS, type Language } from "@code-wars/shared";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../components/ui";
import { ApiError, type RunResult, type SubmitResult } from "../lib/api";
import { useServices } from "../services";
import { loadCode, loadLanguage, saveCode, saveLanguage } from "./codeStore";
import { PlainCodeEditor } from "./PlainCodeEditor";
import { VERDICT_LABELS } from "./labels";

const CodeEditor = lazy(() => import("./CodeEditor"));

/** Phones and tablets: a finger, not a mouse, is the main pointer. */
function isTouchDevice(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

type Kind = "run" | "submit";

const COOLDOWN_MS: Record<Kind, number> = {
  run: LIMITS.runCooldownMs,
  submit: LIMITS.submitCooldownMs,
};

type Outcome =
  | { kind: "run"; result: RunResult }
  | { kind: "submit"; result: SubmitResult }
  | { kind: "error"; message: string };

export function EditorPanel({
  battleId,
  enabled,
  onSubmitted,
}: {
  battleId: string;
  /** False during the get-ready countdown and after time is up. */
  enabled: boolean;
  onSubmitted: () => void;
}) {
  const { api } = useServices();
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const [code, setCode] = useState(() => loadCode(battleId, loadLanguage()));
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // When each button becomes usable again (ms since epoch). The server enforces
  // the real cooldown; this only mirrors it so the buttons can count down.
  const [readyAt, setReadyAt] = useState<Record<Kind, number>>({ run: 0, submit: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [touch] = useState(isTouchDevice);

  const coolingDown = readyAt.run > now || readyAt.submit > now;
  useEffect(() => {
    if (!coolingDown) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [coolingDown]);

  const waitSeconds = (kind: Kind) => Math.max(0, Math.ceil((readyAt[kind] - now) / 1000));

  function changeLanguage(next: Language) {
    setLanguage(next);
    saveLanguage(next);
    setCode(loadCode(battleId, next));
  }

  function changeCode(next: string) {
    setCode(next);
    saveCode(battleId, language, next);
  }

  async function send(kind: Kind) {
    const startedAt = Date.now();
    const startCooldown = (until: number) => {
      setReadyAt((current) => ({ ...current, [kind]: until }));
      setNow(Date.now());
    };
    setBusy(kind);
    setOutcome(null);
    try {
      if (kind === "run") {
        setOutcome({ kind, result: await api.run(battleId, language, code) });
      } else {
        setOutcome({ kind, result: await api.submit(battleId, language, code) });
        onSubmitted();
      }
      // The server's cooldown counts from when the request arrived.
      startCooldown(startedAt + COOLDOWN_MS[kind]);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "COOLDOWN" && caught.retryAfterMs) {
        startCooldown(Date.now() + caught.retryAfterMs);
      }
      setOutcome({
        kind: "error",
        message: caught instanceof ApiError ? caught.message : "Something went wrong.",
      });
    } finally {
      setBusy(null);
    }
  }

  const blocked = !enabled || busy !== null || code.trim().length === 0;
  const label = (kind: Kind, idle: string, working: string) =>
    busy === kind ? working : waitSeconds(kind) > 0 ? `${idle} (${waitSeconds(kind)}s)` : idle;

  return (
    <section aria-label="Editor" className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-2 md:px-4">
        <div className="flex items-center gap-2">
          <label htmlFor="language" className="text-xs tracking-wider text-muted uppercase">
            Language
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => changeLanguage(e.target.value as Language)}
            className="h-11 border border-line-strong bg-panel px-3 text-base text-ink"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-muted md:text-sm">Your code is saved in this browser.</span>
      </div>

      <div className="min-h-[380px] flex-1 bg-[#07080d]">
        {touch ? (
          <PlainCodeEditor language={language} value={code} onChange={changeCode} />
        ) : (
          <Suspense fallback={<p className="p-4 text-muted">Loading editor…</p>}>
            <CodeEditor language={language} value={code} onChange={changeCode} />
          </Suspense>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-panel px-3 py-3 md:px-4">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center md:justify-end">
          <Button
            variant="outline"
            className="px-2 text-sm tracking-wider whitespace-nowrap md:px-7 md:text-base md:tracking-widest"
            disabled={blocked || waitSeconds("run") > 0}
            onClick={() => void send("run")}
          >
            {label("run", "Run samples", "Running…")}
          </Button>
          <Button
            className="px-2 text-sm tracking-wider whitespace-nowrap md:px-7 md:text-base md:tracking-widest"
            disabled={blocked || waitSeconds("submit") > 0}
            onClick={() => void send("submit")}
          >
            {label("submit", "Submit", "Judging…")}
          </Button>
        </div>
        <OutcomeView outcome={outcome} />
      </div>
    </section>
  );
}

function OutcomeView({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) {
    return (
      <p className="m-0 text-sm text-muted">
        Run checks the sample tests. Submit runs the hidden tests; their inputs are never shown.
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p role="alert" className="m-0 text-rival">
        {outcome.message}
      </p>
    );
  }

  const { result } = outcome;
  const good = result.verdict === "accepted";
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="m-0">
        <strong className={good ? "text-you" : "text-rival"}>
          {VERDICT_LABELS[result.verdict]}
        </strong>{" "}
        · {outcome.kind === "run" ? "sample" : "hidden"} tests: {result.passed} of {result.total}{" "}
        passed
      </p>
      {result.compileOutput ? (
        <pre className="m-0 max-h-40 overflow-auto border border-line bg-ground p-2 font-mono text-sm whitespace-pre-wrap text-soft">
          {result.compileOutput}
        </pre>
      ) : null}
      {outcome.kind === "run" && !result.compileOutput ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {outcome.result.cases.map((testCase, index) => (
            <li key={index} className="border border-line bg-ground p-2 font-mono text-sm">
              <div className={testCase.status === "accepted" ? "text-you" : "text-rival"}>
                Sample {index + 1}: {VERDICT_LABELS[testCase.status]}
              </div>
              {testCase.status !== "accepted" ? (
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted uppercase">Expected</div>
                    <pre className="m-0 overflow-x-auto">{testCase.expected}</pre>
                  </div>
                  <div>
                    <div className="text-xs text-muted uppercase">Your output</div>
                    <pre className="m-0 overflow-x-auto">{testCase.actual || "(nothing)"}</pre>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
