import type { Language } from "@code-wars/shared";
import Editor from "@monaco-editor/react";

const MONACO_LANGUAGE: Record<Language, string> = {
  python: "python",
  java: "java",
  cpp: "cpp",
  javascript: "javascript",
};

export interface CodeEditorProps {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

/** Monaco editor. Loaded lazily by EditorPanel because it is large. */
export default function CodeEditor({ language, value, onChange, readOnly }: CodeEditorProps) {
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={MONACO_LANGUAGE[language]}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        ariaLabel: "Code editor",
      }}
    />
  );
}
