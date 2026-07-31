import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { EditorView } from "@codemirror/view";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useMediaDrop } from "../hooks/useMediaDrop";
import {
  getLineAtScrollerCenter,
  scrollScrollerToLine,
} from "../lib/sourceLine";
import type { Theme } from "../hooks/useTheme";
import type { DocumentTab } from "../hooks/useWorkspaceManager";
import { DocumentTabs } from "./DocumentTabs";
import { Icon } from "./Icon";
import { MarkdownEditor } from "./MarkdownEditor";
import {
  MarkdownPreview,
  type PreviewTheme,
} from "./MarkdownPreview";

type ViewMode = "edit" | "split" | "preview";

const SPLIT_RATIO_KEY = "md-show-split-ratio";
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const SCROLL_SYNC_KEY = "md-show-scroll-sync";

const exportStyles = `
body { max-width: 900px; margin: 40px auto; padding: 0 32px; color: #17211d; font: 16px/1.75 system-ui, sans-serif; }
img, video { max-width: 100%; height: auto; } pre { overflow: auto; padding: 16px; background: #f3f5f4; }
code { font-family: ui-monospace, monospace; } blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #4b9271; color: #52615a; }
table { border-collapse: collapse; } th, td { padding: 6px 10px; border: 1px solid #cbd5cf; }
`;

function readSplitRatio(): number {
  const saved = localStorage.getItem(SPLIT_RATIO_KEY);
  const parsed = saved ? Number(saved) : 0.5;
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, parsed));
}

interface WorkspaceProps {
  activeTabId: string;
  content: string;
  contentVersion: number;
  customCss: string;
  filePath: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onContentChange: (content: string) => void;
  onEditorViewChange?: (view: EditorView | null) => void;
  onMediaNotice: (message: string, isError?: boolean) => void;
  onNotice: (message: string, title: string, isError?: boolean) => void;
  onNewTab: () => void;
  previewTheme: PreviewTheme;
  revealRequest: { line: number; token: number } | null;
  tabs: DocumentTab[];
  theme: Theme;
}

export function Workspace({
  activeTabId,
  content,
  contentVersion,
  customCss,
  filePath,
  onActivateTab,
  onCloseTab,
  onContentChange,
  onEditorViewChange,
  onMediaNotice,
  onNotice,
  onNewTab,
  previewTheme,
  revealRequest,
  tabs,
  theme,
}: WorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [splitRatio, setSplitRatio] = useState(readSplitRatio);
  const [isResizing, setIsResizing] = useState(false);
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(
    () => localStorage.getItem(SCROLL_SYNC_KEY) !== "0",
  );
  const panesRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isSyncingScrollRef = useRef(false);
  const handleEditorView = useCallback(
    (view: EditorView | null) => {
      editorViewRef.current = view;
      onEditorViewChange?.(view);
    },
    [onEditorViewChange],
  );
  const previewContent = useDebouncedValue(content);
  const isDraggingMedia = useMediaDrop({
    content,
    documentPath: filePath,
    onContentChange,
    onNotice: onMediaNotice,
  });

  useEffect(() => {
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    localStorage.setItem(SCROLL_SYNC_KEY, scrollSyncEnabled ? "1" : "0");
  }, [scrollSyncEnabled]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const panes = panesRef.current;
      if (!panes) {
        return;
      }
      const rect = panes.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const nextRatio = (event.clientX - rect.left) / rect.width;
      setSplitRatio(
        Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, nextRatio)),
      );
    };

    const stopResizing = () => setIsResizing(false);

    document.body.classList.add("is-pane-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.classList.remove("is-pane-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
    },
    [],
  );

  const getPreviewHtml = useCallback(() => {
    const preview = previewPaneRef.current?.querySelector(".markdown-preview");
    if (!preview) {
      throw new Error("请先切换到包含预览的视图。");
    }

    const copy = preview.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("button").forEach((button) => button.remove());
    return copy.innerHTML;
  }, []);

  const documentName = filePath?.split(/[\\/]/).pop()?.replace(/\.\w+$/, "") ?? "未命名";

  const exportHtml = useCallback(async () => {
    try {
      const destination = await save({
        defaultPath: `${documentName}.html`,
        filters: [{ extensions: ["html"], name: "HTML 文档" }],
        title: "导出 HTML",
      });
      if (!destination) return;
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${documentName}</title><style>${exportStyles}\n${customCss}</style></head><body>${getPreviewHtml()}</body></html>`;
      await writeTextFile(destination, html);
      onNotice(destination, "HTML 已导出");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), "导出失败", true);
    }
  }, [customCss, documentName, getPreviewHtml, onNotice]);

  const exportPackage = useCallback(async () => {
    if (!filePath) {
      onNotice("请先将文档保存到本地后再导出文档包。", "无法导出", true);
      return;
    }
    try {
      const destination = await save({
        defaultPath: `${documentName}.zip`,
        filters: [{ extensions: ["zip"], name: "ZIP 文档包" }],
        title: "导出完整文档包",
      });
      if (!destination) return;
      await invoke("export_document_package", {
        content,
        destinationPath: destination,
        documentPath: filePath,
      });
      onNotice(destination, "完整文档包已导出");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), "导出失败", true);
    }
  }, [content, documentName, filePath, onNotice]);

  const copyRichText = useCallback(async () => {
    try {
      const html = getPreviewHtml();
      const text = previewPaneRef.current?.innerText ?? "";
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      onNotice("可粘贴到 Word、邮件等富文本编辑器中。", "已复制为富文本");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), "复制失败", true);
    }
  }, [getPreviewHtml, onNotice]);

  useEffect(() => {
    const handleExport = (event: Event) => {
      const action = (event as CustomEvent<"html" | "package" | "pdf" | "rich-text">)
        .detail;
      if (action === "html") {
        void exportHtml();
      } else if (action === "package") {
        void exportPackage();
      } else if (action === "pdf") {
        window.print();
      } else if (action === "rich-text") {
        void copyRichText();
      }
    };
    const handleSetViewMode = (event: Event) => {
      const mode = (event as CustomEvent<ViewMode>).detail;
      if (mode === "edit" || mode === "split" || mode === "preview") {
        setViewMode(mode);
      }
    };

    window.addEventListener("md-show:export", handleExport);
    window.addEventListener("md-show:set-view-mode", handleSetViewMode);
    return () => {
      window.removeEventListener("md-show:export", handleExport);
      window.removeEventListener("md-show:set-view-mode", handleSetViewMode);
    };
  }, [copyRichText, exportHtml, exportPackage]);

  useEffect(() => {
    const editorScroller =
      editorPaneRef.current?.querySelector<HTMLElement>(".cm-scroller");
    const previewPane = previewPaneRef.current;

    if (
      !editorScroller ||
      !previewPane ||
      viewMode !== "split" ||
      !scrollSyncEnabled
    ) {
      return undefined;
    }

    const getEditorCenterLine = () => {
      const editorView = editorViewRef.current;
      if (!editorView) {
        return null;
      }

      const centerY =
        editorScroller.scrollTop + editorScroller.clientHeight / 2;
      const block = editorView.lineBlockAtHeight(centerY);
      return editorView.state.doc.lineAt(block.from).number;
    };

    const syncEditorToPreview = () => {
      if (isSyncingScrollRef.current) {
        return;
      }

      const line = getEditorCenterLine();
      if (line === null) {
        return;
      }

      isSyncingScrollRef.current = true;
      scrollScrollerToLine(previewPane, line, "center");
      window.requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    };

    const syncPreviewToEditor = () => {
      const editorView = editorViewRef.current;
      if (isSyncingScrollRef.current || !editorView) {
        return;
      }

      const line = getLineAtScrollerCenter(previewPane);
      if (line === null) {
        return;
      }

      const docLine = editorView.state.doc.line(
        Math.min(Math.max(1, line), editorView.state.doc.lines),
      );

      isSyncingScrollRef.current = true;
      editorView.dispatch({
        effects: EditorView.scrollIntoView(docLine.from, { y: "center" }),
      });
      window.requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    };

    const resyncAfterLayout = () => {
      if (isSyncingScrollRef.current) {
        return;
      }
      syncEditorToPreview();
    };

    editorScroller.addEventListener("scroll", syncEditorToPreview, {
      passive: true,
    });
    previewPane.addEventListener("scroll", syncPreviewToEditor, {
      passive: true,
    });

    const previewContentRoot =
      previewPane.querySelector<HTMLElement>(".markdown-preview");
    const resizeObserver =
      previewContentRoot &&
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resyncAfterLayout)
        : null;
    if (previewContentRoot && resizeObserver) {
      resizeObserver.observe(previewContentRoot);
    }

    return () => {
      editorScroller.removeEventListener("scroll", syncEditorToPreview);
      previewPane.removeEventListener("scroll", syncPreviewToEditor);
      resizeObserver?.disconnect();
    };
  }, [previewContent, scrollSyncEnabled, viewMode]);

  useEffect(() => {
    if (!revealRequest || viewMode === "edit") {
      return;
    }

    const previewPane = previewPaneRef.current;
    if (!previewPane) {
      return;
    }

    const targetLine = revealRequest.line;
    const revealPreviewLine = () => {
      scrollScrollerToLine(previewPane, targetLine, "center");
    };

    revealPreviewLine();
    const frame = window.requestAnimationFrame(revealPreviewLine);
    const timers = [100, 300, 600].map((delay) =>
      window.setTimeout(revealPreviewLine, delay),
    );

    const previewContentRoot =
      previewPane.querySelector<HTMLElement>(".markdown-preview");
    const mutationObserver =
      previewContentRoot && typeof MutationObserver !== "undefined"
        ? new MutationObserver(revealPreviewLine)
        : null;
    if (previewContentRoot && mutationObserver) {
      mutationObserver.observe(previewContentRoot, {
        childList: true,
        subtree: true,
      });
    }

    const stopObserving = window.setTimeout(() => {
      mutationObserver?.disconnect();
    }, 1200);

    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(stopObserving);
      mutationObserver?.disconnect();
    };
  }, [revealRequest, viewMode]);

  const panesStyle =
    viewMode === "split"
      ? {
          gridTemplateColumns: `minmax(0, ${splitRatio}fr) 6px minmax(0, ${1 - splitRatio}fr)`,
        }
      : undefined;

  return (
    <main
      className={`workspace workspace--${viewMode}${isResizing ? " is-resizing" : ""}`}
    >
      <DocumentTabs
        activeTabId={activeTabId}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onNew={onNewTab}
        tabs={tabs}
      />

      <div
        className="view-switcher view-switcher--floating"
        aria-label="视图模式"
      >
        {(["edit", "split", "preview"] as const).map((mode) => (
          <button
            aria-pressed={viewMode === mode}
            className={viewMode === mode ? "is-active" : ""}
            key={mode}
            onClick={() => setViewMode(mode)}
            title={
              mode === "edit"
                ? "仅编辑 (Ctrl+1)"
                : mode === "split"
                  ? "编辑与预览 (Ctrl+2)"
                  : "仅预览 (Ctrl+3)"
            }
            type="button"
          >
            {mode === "edit" ? "编辑" : mode === "split" ? "分栏" : "预览"}
          </button>
        ))}
        {viewMode === "split" && (
          <button
            aria-pressed={scrollSyncEnabled}
            className={`view-switcher__sync${scrollSyncEnabled ? " is-active" : ""}`}
            onClick={() => setScrollSyncEnabled((enabled) => !enabled)}
            title={scrollSyncEnabled ? "关闭同步滚动" : "开启同步滚动"}
            type="button"
          >
            同步滚动
          </button>
        )}
      </div>
      <div className="panes" ref={panesRef} style={panesStyle}>
        {viewMode !== "preview" && (
          <section
            className="pane editor-pane"
            aria-label="Markdown 编辑区"
            ref={editorPaneRef}
          >
            <div className="editor-surface">
              <MarkdownEditor
                key={contentVersion}
                content={content}
                onChange={onContentChange}
                onEditorView={handleEditorView}
                revealRequest={revealRequest}
                theme={theme}
              />
            </div>
          </section>
        )}

        {viewMode === "split" && (
          <div
            aria-orientation="vertical"
            aria-label="调整分栏宽度"
            aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)}
            aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)}
            aria-valuenow={Math.round(splitRatio * 100)}
            className="pane-resizer"
            onPointerDown={startResize}
            role="separator"
            title="拖拽调整分栏宽度"
          />
        )}

        {viewMode !== "edit" && (
          <section
            className="pane preview-pane"
            aria-label="Markdown 预览区"
            ref={previewPaneRef}
          >
            <article className="preview-content">
              <MarkdownPreview
                content={previewContent}
                customCss={customCss}
                documentPath={filePath}
                previewTheme={previewTheme}
              />
            </article>
          </section>
        )}
      </div>
      {isDraggingMedia && (
        <div className="media-drop-overlay">
          <div>
            <Icon name="plus" size={22} />
            <strong>松开以导入媒体文件</strong>
            <span>文件将复制到当前文档目录的 assets 文件夹</span>
          </div>
        </div>
      )}
    </main>
  );
}
