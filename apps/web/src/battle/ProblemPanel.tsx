import Markdown from "react-markdown";
import type { BattleState } from "../lib/api";

type Problem = NonNullable<BattleState["problem"]>;

export function ProblemPanel({ problem }: { problem: Problem }) {
  return (
    <section aria-label="Problem" className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-2xl font-bold uppercase md:text-3xl">
          {problem.title}
        </h1>
        <span className="border border-you px-2 py-0.5 font-mono text-xs text-you uppercase">
          {problem.difficulty}
        </span>
      </div>

      {/* react-markdown renders no raw HTML, so statements cannot inject script. */}
      <div className="problem-text text-soft [&_code]:font-mono [&_code]:text-ink [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink [&_li]:my-0.5 [&_p]:my-2 [&_strong]:text-ink [&_ul]:my-1 [&_ul]:pl-5">
        <Markdown>{problem.statementMd}</Markdown>
      </div>

      <p className="m-0 font-mono text-sm text-muted">
        Limits: {problem.timeLimitMs / 1000} s · {Math.round(problem.memoryLimitKb / 1000)} MB
      </p>

      {problem.samples.map((sample, index) => (
        <div key={index} className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-semibold">Sample {index + 1}</h2>
          <div className="grid gap-2 font-mono text-sm sm:grid-cols-2">
            <div className="border border-line bg-panel p-2.5">
              <div className="text-xs tracking-wider text-muted uppercase">Input</div>
              <pre className="m-0 overflow-x-auto whitespace-pre">{sample.input}</pre>
            </div>
            <div className="border border-line bg-panel p-2.5">
              <div className="text-xs tracking-wider text-muted uppercase">Output</div>
              <pre className="m-0 overflow-x-auto whitespace-pre">{sample.output}</pre>
            </div>
          </div>
          {sample.explanation ? (
            <p className="m-0 text-sm text-muted">{sample.explanation}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
