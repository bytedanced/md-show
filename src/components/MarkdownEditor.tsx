import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import type { Theme } from "../hooks/useTheme";

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  onEditorView?: (view: EditorView | null) => void;
  revealRequest?: { line: number; token: number } | null;
  theme: Theme;
}

export function MarkdownEditor({
  content,
  onChange,
  onEditorView,
  revealRequest,
  theme,
}: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [markdown(), search({ top: true }), keymap.of(searchKeymap)],
    [],
  );
  const editorViewRef = useRef<EditorView | null>(null);
  const onEditorViewRef = useRef(onEditorView);
  onEditorViewRef.current = onEditorView;

  useEffect(() => {
    return () => {
      onEditorViewRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !revealRequest) {
      return;
    }
    const line = view.state.doc.line(
      Math.min(Math.max(1, revealRequest.line), view.state.doc.lines),
    );
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      selection: { anchor: line.from },
    });
    view.focus();
  }, [revealRequest]);

  return (
    <CodeMirror
      aria-label="Markdown 文档内容"
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: true,
        lineNumbers: true,
      }}
      className="markdown-editor"
      extensions={extensions}
      height="100%"
      onChange={onChange}
      onCreateEditor={(view) => {
        editorViewRef.current = view;
        onEditorView?.(view);
      }}
      placeholder={"# 开始写作\n\n在这里输入 Markdown 内容……"}
      theme={theme === "dark" ? oneDark : "light"}
      value={content}
    />
  );
}
