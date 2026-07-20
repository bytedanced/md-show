import type { EditorView } from "@codemirror/view";

export function getEditorSelection(view: EditorView | null): string {
  if (!view) {
    return "";
  }
  const { from, to } = view.state.selection.main;
  if (from === to) {
    return "";
  }
  return view.state.sliceDoc(from, to);
}

export interface CapturedEditorRange {
  text: string;
  from: number;
  to: number;
  /** 1-based */
  startLine: number;
  /** 1-based inclusive */
  endLine: number;
}

/**
 * 捕获当前选区；无选区时退化为当前行。
 * 空白内容返回 null。
 */
export function captureEditorRange(
  view: EditorView | null,
): CapturedEditorRange | null {
  if (!view) {
    return null;
  }
  let { from, to } = view.state.selection.main;
  if (from === to) {
    const line = view.state.doc.lineAt(from);
    from = line.from;
    to = line.to;
  }
  const text = view.state.sliceDoc(from, to);
  if (!text.trim()) {
    return null;
  }
  const startLine = view.state.doc.lineAt(from).number;
  const endLine = view.state.doc.lineAt(Math.max(from, to - 1)).number;
  return { text, from, to, startLine, endLine };
}

export function insertAtCursor(view: EditorView | null, text: string): boolean {
  if (!view || !text) {
    return false;
  }
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
  return true;
}

export function replaceSelection(view: EditorView | null, text: string): boolean {
  if (!view || !text) {
    return false;
  }
  const { from, to } = view.state.selection.main;
  if (from === to) {
    return insertAtCursor(view, text);
  }
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
  return true;
}
