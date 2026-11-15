import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { CodeEditorProps } from "./CodeEditor";

const INDENT = "    ";

/**
 * Where the caret goes after pressing Enter: a new line with the current
 * line's indentation, one level deeper after a line that opens a block
 * (`:` in Python, `{` in Java, C++ and JavaScript).
 */
export function newLineFor(value: string, caret: number): string {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const indent = /^[ \t]*/.exec(line)![0];
  const opensBlock = /[:{[(]\s*$/.test(line);
  return `\n${indent}${opensBlock ? INDENT : ""}`;
}

/**
 * A plain code box for phones and tablets. Monaco is built for a mouse and a
 * hardware keyboard and works poorly with touch keyboards, so touch devices
 * get this instead: no autocorrect or auto-capitals, kept indentation, and
 * text large enough that iPhones do not zoom in on focus.
 */
export function PlainCodeEditor({ value, onChange, readOnly }: CodeEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the caret belongs after an inserted indent. Applied as soon as the
  // new text is on screen, before the next key press can land in between.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const area = ref.current;
    if (area && pendingCaret.current !== null) {
      area.selectionStart = area.selectionEnd = pendingCaret.current;
      pendingCaret.current = null;
    }
  }, [value]);

  function insert(text: string) {
    const area = ref.current!;
    const { selectionStart: start, selectionEnd: end } = area;
    pendingCaret.current = start + text.length;
    onChange(value.slice(0, start) + text + value.slice(end));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      insert(newLineFor(value, event.currentTarget.selectionStart));
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      insert(INDENT);
    }
  }

  return (
    <textarea
      ref={ref}
      aria-label="Code editor"
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      wrap="off"
      className="block h-full min-h-[50vh] w-full resize-none border-0 bg-transparent p-3 font-mono text-base leading-relaxed text-ink outline-none [tab-size:4]"
    />
  );
}
