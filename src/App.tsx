import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorView } from "@codemirror/view";
import {
  captureEditorRange,
  createSnippetId,
  createWorkspaceBridge,
  ensureBuiltinToolsRegistered,
  getEditorSelection,
  insertAtCursor,
  isDuplicateSnippet,
  loadAiSettings,
  mcpSyncFromConfig,
  replaceSelection,
  saveAiSettings,
  snippetRangeLabel,
  type AiSettings,
  type ContextSnippet,
  type OpenTabSnapshot,
} from "./ai";
import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { AppHeader } from "./components/AppHeader";
import {
  CommandPalette,
  type AppCommand,
} from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { InputDialog } from "./components/InputDialog";
import {
  DEFAULT_CUSTOM_CSS,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_PREVIEW_FONT_SIZE,
  DEFAULT_PREVIEW_THEME,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SettingsDialog,
  type SettingsTab,
} from "./components/SettingsDialog";
import { AgentConfigPanel } from "./components/AgentConfigPanel";
import { AiSidePanel } from "./components/AiSidePanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toast, type ToastMessage } from "./components/Toast";
import { Workspace } from "./components/Workspace";
import type { PreviewTheme } from "./components/MarkdownPreview";
import { useTheme } from "./hooks/useTheme";
import {
  useWorkspaceManager,
  type WorkspaceEntry,
} from "./hooks/useWorkspaceManager";
import "./App.css";

const PREVIEW_THEME_KEY = "md-show-preview-theme";
const PREVIEW_CSS_KEY = "md-show-preview-css";
const EDITOR_FONT_SIZE_KEY = "md-show-editor-font-size";
const PREVIEW_FONT_SIZE_KEY = "md-show-preview-font-size";
const AI_PANEL_OPEN_KEY = "md-show-ai-panel-open";
const AI_PANEL_WIDTH_KEY = "md-show:ai-panel-width";
const MIN_AI_PANEL_WIDTH = 280;
const MAX_AI_PANEL_WIDTH = 640;
const DEFAULT_AI_PANEL_WIDTH = 320;

function readAiPanelWidth(): number {
  const saved = localStorage.getItem(AI_PANEL_WIDTH_KEY);
  const parsed = saved ? Number(saved) : DEFAULT_AI_PANEL_WIDTH;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AI_PANEL_WIDTH;
  }
  return Math.min(MAX_AI_PANEL_WIDTH, Math.max(MIN_AI_PANEL_WIDTH, parsed));
}

interface InputRequest {
  description: string;
  entry?: WorkspaceEntry;
  initialValue?: string;
  kind: "file" | "folder" | "rename";
  parentPath?: string;
  title: string;
}

function readPreviewTheme(): PreviewTheme {
  const saved = localStorage.getItem(PREVIEW_THEME_KEY);
  return saved === "midnight" || saved === "sepia" || saved === "ocean"
    ? saved
    : "paper";
}

function readFontSize(key: string, fallback: number) {
  const parsed = Number(localStorage.getItem(key));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(parsed)));
}

function dispatchExport(action: "html" | "package" | "pdf" | "rich-text") {
  window.dispatchEvent(
    new CustomEvent("md-show:export", { detail: action }),
  );
}

function dispatchViewMode(mode: "edit" | "split" | "preview") {
  window.dispatchEvent(
    new CustomEvent("md-show:set-view-mode", { detail: mode }),
  );
}

function dispatchSidebarMode(
  mode: "files" | "workspaces" | "search" | "outline",
) {
  window.dispatchEvent(
    new CustomEvent("md-show:set-sidebar-mode", { detail: mode }),
  );
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [inputRequest, setInputRequest] = useState<InputRequest | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("help");
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>(readPreviewTheme);
  const [customCss, setCustomCss] = useState(
    () => localStorage.getItem(PREVIEW_CSS_KEY) ?? "",
  );
  const [editorFontSize, setEditorFontSize] = useState(() =>
    readFontSize(EDITOR_FONT_SIZE_KEY, DEFAULT_EDITOR_FONT_SIZE),
  );
  const [previewFontSize, setPreviewFontSize] = useState(() =>
    readFontSize(PREVIEW_FONT_SIZE_KEY, DEFAULT_PREVIEW_FONT_SIZE),
  );
  const [revealRequest, setRevealRequest] = useState<{
    line: number;
    token: number;
  } | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(
    () => localStorage.getItem(AI_PANEL_OPEN_KEY) === "1",
  );
  const [aiPanelWidth, setAiPanelWidth] = useState(readAiPanelWidth);
  const [isAiPanelResizing, setIsAiPanelResizing] = useState(false);
  const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
  const [editorSelection, setEditorSelection] = useState("");
  const [editorSelectionLine, setEditorSelectionLine] = useState<{
    start: number | null;
    end: number | null;
  }>({ start: null, end: null });
  const [aiContextSnippets, setAiContextSnippets] = useState<ContextSnippet[]>(
    [],
  );
  const [includeActiveDocument, setIncludeActiveDocument] = useState(true);
  const editorViewRef = useRef<EditorView | null>(null);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const activeTabPathRef = useRef<string | null>(null);
  const aiContextSnippetsRef = useRef(aiContextSnippets);

  useEffect(() => {
    aiContextSnippetsRef.current = aiContextSnippets;
  }, [aiContextSnippets]);

  const openSettings = useCallback((tab: SettingsTab = "help") => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  }, []);

  const handleAiSettingsChange = useCallback((settings: AiSettings) => {
    setAiSettings(settings);
    saveAiSettings(settings);
  }, []);

  const setAiPanelOpen = useCallback((open: boolean) => {
    setIsAiPanelOpen(open);
    localStorage.setItem(AI_PANEL_OPEN_KEY, open ? "1" : "0");
  }, []);

  const toggleAiPanel = useCallback(() => {
    setAiPanelOpen(!isAiPanelOpen);
  }, [isAiPanelOpen, setAiPanelOpen]);

  useEffect(() => {
    localStorage.setItem(AI_PANEL_WIDTH_KEY, String(aiPanelWidth));
  }, [aiPanelWidth]);

  useEffect(() => {
    if (!isAiPanelResizing) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const body = appBodyRef.current;
      if (!body) {
        return;
      }
      const rect = body.getBoundingClientRect();
      const nextWidth = rect.right - event.clientX;
      setAiPanelWidth(
        Math.min(MAX_AI_PANEL_WIDTH, Math.max(MIN_AI_PANEL_WIDTH, nextWidth)),
      );
    };

    const stopResizing = () => setIsAiPanelResizing(false);

    document.body.classList.add("is-ai-panel-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.classList.remove("is-ai-panel-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isAiPanelResizing]);

  const startAiPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsAiPanelResizing(true);
  }, []);

  const syncEditorSelection = useCallback((view: EditorView | null) => {
    const text = getEditorSelection(view);
    setEditorSelection(text);
    if (!view || !text.trim()) {
      setEditorSelectionLine({ start: null, end: null });
      return;
    }
    const range = captureEditorRange(view);
    if (range) {
      setEditorSelectionLine({ start: range.startLine, end: range.endLine });
    } else {
      setEditorSelectionLine({ start: null, end: null });
    }
  }, []);

  const handleEditorViewChange = useCallback((view: EditorView | null) => {
    editorViewRef.current = view;
    syncEditorSelection(view);
  }, [syncEditorSelection]);

  useEffect(() => {
    const syncSelection = () => {
      syncEditorSelection(editorViewRef.current);
    };
    window.addEventListener("mouseup", syncSelection);
    window.addEventListener("keyup", syncSelection);
    return () => {
      window.removeEventListener("mouseup", syncSelection);
      window.removeEventListener("keyup", syncSelection);
    };
  }, [syncEditorSelection]);

  useEffect(() => {
    const handleToggle = (event: Event) => {
      const detail = (event as CustomEvent<boolean | undefined>).detail;
      if (typeof detail === "boolean") {
        setAiPanelOpen(detail);
      } else {
        setIsAiPanelOpen((open) => {
          const next = !open;
          localStorage.setItem(AI_PANEL_OPEN_KEY, next ? "1" : "0");
          return next;
        });
      }
    };
    window.addEventListener("md-show:toggle-ai-panel", handleToggle);
    return () => {
      window.removeEventListener("md-show:toggle-ai-panel", handleToggle);
    };
  }, [setAiPanelOpen]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    setSettingsTab("help");
  }, []);

  const resetAppearance = useCallback(() => {
    setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
    setPreviewFontSize(DEFAULT_PREVIEW_FONT_SIZE);
    setPreviewTheme(DEFAULT_PREVIEW_THEME);
    setCustomCss(DEFAULT_CUSTOM_CSS);
  }, []);

  const clampFontSize = useCallback((size: number) => {
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
  }, []);

  const nudgeFontSizes = useCallback(
    (delta: number) => {
      setEditorFontSize((size) => clampFontSize(size + delta));
      setPreviewFontSize((size) => clampFontSize(size + delta));
    },
    [clampFontSize],
  );

  const resetFontSizes = useCallback(() => {
    setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
    setPreviewFontSize(DEFAULT_PREVIEW_FONT_SIZE);
  }, []);

  useEffect(() => {
    localStorage.setItem(PREVIEW_THEME_KEY, previewTheme);
  }, [previewTheme]);

  useEffect(() => {
    localStorage.setItem(PREVIEW_CSS_KEY, customCss);
  }, [customCss]);

  useEffect(() => {
    localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(editorFontSize));
  }, [editorFontSize]);

  useEffect(() => {
    localStorage.setItem(PREVIEW_FONT_SIZE_KEY, String(previewFontSize));
  }, [previewFontSize]);

  const notify = useCallback((message: Omit<ToastMessage, "id">) => {
    setToast({ ...message, id: Date.now() });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  const notifyMedia = useCallback(
    (message: string, isError?: boolean) => {
      notify({
        message,
        title: isError ? "媒体导入失败" : "媒体已导入",
        tone: isError ? "error" : "info",
      });
    },
    [notify],
  );
  const {
    activeTab,
    activeTabId,
    cancelPendingConfirmation,
    closeTab,
    confirmPendingAction,
    createWorkspaceFile,
    createWorkspaceFolder,
    deleteWorkspaceEntry,
    isDirty,
    moveWorkspaceEntry,
    newDocument,
    openDocument,
    openPathInTab,
    openWorkspace,
    openWorkspacePath,
    outline,
    pendingConfirmation,
    pinnedWorkspaces,
    readingMinutes,
    renameWorkspaceEntry,
    recentWorkspaces,
    removeRecentWorkspace,
    saveAsDocument,
    saveDocument,
    searchWorkspace,
    setActiveTabId,
    tabs,
    togglePinnedWorkspace,
    updateContent,
    updateTabByPath,
    wordCount,
    workspaceRoot,
    workspaceTree,
    refreshWorkspace,
  } = useWorkspaceManager(notify);

  const [mcpSyncVersion, setMcpSyncVersion] = useState(0);

  useEffect(() => {
    ensureBuiltinToolsRegistered();
  }, []);

  useEffect(() => {
    mcpSyncFromConfig(aiSettings.mcpServers).then(() => {
      setMcpSyncVersion((v) => v + 1);
    });
  }, [aiSettings.mcpServers]);

  const openTabSnapshots = useMemo<OpenTabSnapshot[]>(
    () =>
      tabs.map((tab) => ({
        path: tab.path,
        content: tab.content,
        dirty: tab.content !== tab.savedContent,
      })),
    [tabs],
  );

  const workspaceBridge = useMemo(
    () =>
      createWorkspaceBridge({
        workspaceRoot,
        openTabs: openTabSnapshots,
        readDir: async (path) => {
          const entries = await readDir(path);
          return entries.map((entry) => ({
            name: entry.name,
            isDirectory: Boolean(entry.isDirectory),
            isFile: Boolean(entry.isFile),
            isSymlink: Boolean(entry.isSymlink),
          }));
        },
        readTextFile,
        writeTextFile,
        joinPath: (base, name) => join(base, name),
        search: (query) =>
          searchWorkspace(query).then((hits) =>
            hits.map((hit) => ({
              line: hit.line,
              name: hit.name,
              path: hit.path,
              preview: hit.preview,
            })),
          ),
        updateTabContent: updateTabByPath,
        onFileChanged: () => {
          void refreshWorkspace();
        },
      }),
    [openTabSnapshots, searchWorkspace, workspaceRoot, updateTabByPath, refreshWorkspace],
  );

  useEffect(() => {
    activeTabPathRef.current = activeTab.path;
  }, [activeTab.path]);

  const addAiContextFromEditor = useCallback(() => {
    const range = captureEditorRange(editorViewRef.current);
    if (!range) {
      notify({
        message: "没有可加入的内容（请选中文字，或将光标放在非空行）。",
        title: "AI 上下文",
        tone: "error",
      });
      return;
    }

    const candidate = {
      path: activeTabPathRef.current,
      startLine: range.startLine,
      endLine: range.endLine,
      text: range.text,
    };

    if (isDuplicateSnippet(aiContextSnippetsRef.current, candidate)) {
      notify({
        message: "该片段已在上下文中。",
        title: "AI 上下文",
        tone: "info",
      });
      setAiPanelOpen(true);
      return;
    }

    const next: ContextSnippet = {
      id: createSnippetId(),
      ...candidate,
    };
    setAiContextSnippets((prev) => [...prev, next]);
    setAiPanelOpen(true);
    notify({
      message: `已加入 ${snippetRangeLabel(next)}（${range.text.trim().length} 字）`,
      title: "AI 上下文",
      tone: "info",
    });
  }, [notify, setAiPanelOpen]);

  const removeAiContextSnippet = useCallback((id: string) => {
    setAiContextSnippets((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dismissActiveDocumentContext = useCallback(() => {
    setIncludeActiveDocument(false);
  }, []);

  const insertAiText = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      if (!insertAtCursor(view, text) || !view) {
        notify({
          message: "无法插入到编辑器，请先切换到编辑或分栏模式。",
          title: "AI",
          tone: "error",
        });
        return;
      }
      updateContent(view.state.doc.toString());
      notify({ message: "已插入到光标处。", title: "AI", tone: "info" });
    },
    [notify, updateContent],
  );

  const replaceAiText = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      const hadSelection = Boolean(getEditorSelection(view));
      if (!replaceSelection(view, text) || !view) {
        notify({
          message: "无法写入编辑器，请先切换到编辑或分栏模式。",
          title: "AI",
          tone: "error",
        });
        return;
      }
      updateContent(view.state.doc.toString());
      syncEditorSelection(view);
      notify({
        message: hadSelection
          ? "已替换选区。"
          : "当前无选区，已插入到光标处。",
        title: "AI",
        tone: "info",
      });
    },
    [notify, syncEditorSelection, updateContent],
  );

  const requestCreateFile = useCallback((parentPath: string) => {
    setInputRequest({
      description: "文件将创建在所选目录中。",
      kind: "file",
      parentPath,
      title: "新建 Markdown 文件",
    });
  }, []);

  const requestCreateFolder = useCallback((parentPath: string) => {
    setInputRequest({
      description: "输入新文件夹的名称。",
      kind: "folder",
      parentPath,
      title: "新建文件夹",
    });
  }, []);

  const requestRenameEntry = useCallback((entry: WorkspaceEntry) => {
    setInputRequest({
      description: "输入新的文件或文件夹名称。",
      entry,
      initialValue: entry.name,
      kind: "rename",
      title: "重命名",
    });
  }, []);

  const submitInputRequest = useCallback(
    (value: string) => {
      const request = inputRequest;
      setInputRequest(null);
      if (!request) return;
      if (request.kind === "file" && request.parentPath) {
        void createWorkspaceFile(request.parentPath, value);
      } else if (request.kind === "folder" && request.parentPath) {
        void createWorkspaceFolder(request.parentPath, value);
      } else if (request.kind === "rename" && request.entry) {
        void renameWorkspaceEntry(request.entry, value);
      }
    },
    [
      createWorkspaceFile,
      createWorkspaceFolder,
      inputRequest,
      renameWorkspaceEntry,
    ],
  );

  const revealLine = useCallback((line: number) => {
    setRevealRequest({ line, token: Date.now() });
  }, []);

  const openCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
  }, []);

  const commands = useMemo<AppCommand[]>(
    () => [
      {
        id: "file.new",
        group: "文件",
        label: "新建文档",
        keywords: ["new", "新建", "文档"],
        shortcut: "Ctrl+N",
        run: newDocument,
      },
      {
        id: "file.open",
        group: "文件",
        label: "打开文档",
        keywords: ["open", "打开", "文件"],
        shortcut: "Ctrl+O",
        run: () => void openDocument(),
      },
      {
        id: "file.open-workspace",
        group: "文件",
        label: "打开工作区",
        keywords: ["workspace", "文件夹", "工作区"],
        run: () => void openWorkspace(),
      },
      {
        id: "file.save",
        group: "文件",
        label: "保存文档",
        keywords: ["save", "保存"],
        shortcut: "Ctrl+S",
        run: () => void saveDocument(),
      },
      {
        id: "file.save-as",
        group: "文件",
        label: "另存为",
        keywords: ["save as", "另存为"],
        shortcut: "Ctrl+Shift+S",
        run: () => void saveAsDocument(),
      },
      {
        id: "file.close-tab",
        group: "文件",
        label: "关闭当前标签",
        keywords: ["close", "关闭", "标签"],
        shortcut: "Ctrl+W",
        run: () => closeTab(activeTabId),
      },
      {
        id: "view.edit",
        group: "视图",
        label: "仅编辑模式",
        keywords: ["edit", "编辑", "视图"],
        shortcut: "Ctrl+1",
        run: () => dispatchViewMode("edit"),
      },
      {
        id: "view.split",
        group: "视图",
        label: "分栏模式",
        keywords: ["split", "分栏", "预览"],
        shortcut: "Ctrl+2",
        run: () => dispatchViewMode("split"),
      },
      {
        id: "view.preview",
        group: "视图",
        label: "仅预览模式",
        keywords: ["preview", "预览", "视图"],
        shortcut: "Ctrl+3",
        run: () => dispatchViewMode("preview"),
      },
      {
        id: "sidebar.files",
        group: "侧边栏",
        label: "切换到文件树",
        keywords: ["files", "文件", "目录"],
        run: () => dispatchSidebarMode("files"),
      },
      {
        id: "sidebar.workspaces",
        group: "侧边栏",
        label: "切换到工作区",
        keywords: ["workspaces", "工作区", "收藏"],
        run: () => dispatchSidebarMode("workspaces"),
      },
      {
        id: "sidebar.search",
        group: "侧边栏",
        label: "切换到搜索",
        keywords: ["search", "搜索", "全文"],
        run: () => dispatchSidebarMode("search"),
      },
      {
        id: "sidebar.outline",
        group: "侧边栏",
        label: "切换到大纲",
        keywords: ["outline", "大纲", "标题"],
        run: () => dispatchSidebarMode("outline"),
      },
      {
        id: "ai.toggle",
        group: "AI",
        label: isAiPanelOpen ? "关闭右侧 AI 面板" : "打开右侧 AI 面板",
        keywords: ["ai", "chat", "助手", "对话", "gpt", "面板"],
        run: () => toggleAiPanel(),
      },
      {
        id: "ai.add-selection",
        group: "AI",
        label: "将选区加入 AI 上下文",
        keywords: ["ai", "context", "选区", "上下文", "ctrl+l"],
        shortcut: "Ctrl+L",
        run: () => addAiContextFromEditor(),
      },
      {
        id: "settings.ai",
        group: "AI",
        label: "打开 AI 设置",
        keywords: ["ai", "api", "model", "模型", "设置"],
        run: () => openSettings("ai"),
      },
      {
        id: "export.html",
        group: "导出",
        label: "导出 HTML",
        keywords: ["export", "html", "导出"],
        run: () => dispatchExport("html"),
      },
      {
        id: "export.pdf",
        group: "导出",
        label: "导出 PDF",
        keywords: ["export", "pdf", "打印"],
        run: () => dispatchExport("pdf"),
      },
      {
        id: "export.package",
        group: "导出",
        label: "导出完整文档包",
        keywords: ["export", "package", "zip", "文档包"],
        run: () => dispatchExport("package"),
      },
      {
        id: "export.rich-text",
        group: "导出",
        label: "复制为富文本",
        keywords: ["copy", "rich text", "富文本", "复制"],
        run: () => dispatchExport("rich-text"),
      },
      {
        id: "settings.open",
        group: "外观",
        label: "打开设置与使用说明",
        keywords: ["settings", "help", "帮助", "说明", "设置"],
        run: () => openSettings("help"),
      },
      {
        id: "settings.preview",
        group: "外观",
        label: "打开外观设置",
        keywords: ["preview", "css", "主题", "字号", "字体", "设置"],
        run: () => openSettings("preview"),
      },
      {
        id: "settings.font-increase",
        group: "外观",
        label: "增大字号",
        keywords: ["font", "zoom", "字号", "放大", "字体"],
        shortcut: "Ctrl+=",
        run: () => nudgeFontSizes(1),
      },
      {
        id: "settings.font-decrease",
        group: "外观",
        label: "减小字号",
        keywords: ["font", "zoom", "字号", "缩小", "字体"],
        shortcut: "Ctrl+-",
        run: () => nudgeFontSizes(-1),
      },
      {
        id: "settings.font-reset",
        group: "外观",
        label: "恢复默认字号",
        keywords: ["font", "reset", "字号", "默认", "字体"],
        shortcut: "Ctrl+0",
        run: resetFontSizes,
      },
      {
        id: "settings.theme",
        group: "外观",
        label: theme === "light" ? "切换到暗色主题" : "切换到明亮主题",
        keywords: ["theme", "dark", "light", "主题", "暗色", "明亮"],
        run: toggleTheme,
      },
    ],
    [
      activeTabId,
      addAiContextFromEditor,
      closeTab,
      isAiPanelOpen,
      newDocument,
      nudgeFontSizes,
      openDocument,
      openSettings,
      openWorkspace,
      resetFontSizes,
      saveAsDocument,
      saveDocument,
      theme,
      toggleAiPanel,
      toggleTheme,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key;
      const code = event.code;
      const isZoomIn =
        key === "=" ||
        key === "+" ||
        code === "NumpadAdd" ||
        code === "Equal";
      const isZoomOut =
        key === "-" ||
        key === "_" ||
        code === "NumpadSubtract" ||
        code === "Minus";
      const isZoomReset =
        key === "0" || code === "Digit0" || code === "Numpad0";

      if (isZoomIn || isZoomOut || isZoomReset) {
        if (pendingConfirmation || inputRequest) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (isZoomIn) {
          nudgeFontSizes(1);
        } else if (isZoomOut) {
          nudgeFontSizes(-1);
        } else {
          resetFontSizes();
        }
        return;
      }

      if (
        !event.shiftKey &&
        (key === "1" ||
          key === "2" ||
          key === "3" ||
          code === "Digit1" ||
          code === "Digit2" ||
          code === "Digit3" ||
          code === "Numpad1" ||
          code === "Numpad2" ||
          code === "Numpad3")
      ) {
        if (pendingConfirmation || inputRequest || isSettingsOpen) {
          return;
        }
        const mode =
          key === "1" || code === "Digit1" || code === "Numpad1"
            ? "edit"
            : key === "2" || code === "Digit2" || code === "Numpad2"
              ? "split"
              : "preview";
        event.preventDefault();
        event.stopPropagation();
        dispatchViewMode(mode);
        return;
      }

      const normalized = key.toLowerCase();

      if (!event.shiftKey && normalized === "l") {
        if (pendingConfirmation || inputRequest || isSettingsOpen) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        addAiContextFromEditor();
        return;
      }

      const isPaletteShortcut =
        (normalized === "k" && !event.shiftKey) ||
        (normalized === "p" && event.shiftKey);

      if (!isPaletteShortcut) {
        return;
      }

      if (pendingConfirmation || inputRequest || isSettingsOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsCommandPaletteOpen((open) => !open);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    addAiContextFromEditor,
    inputRequest,
    isSettingsOpen,
    nudgeFontSizes,
    pendingConfirmation,
    resetFontSizes,
  ]);

  const shellStyle = {
    ["--editor-font-size" as string]: `${editorFontSize}px`,
    ["--preview-font-size" as string]: `${previewFontSize}px`,
  };

  return (
    <div className="app-shell" style={shellStyle}>
      <AppHeader
        isAiPanelOpen={isAiPanelOpen}
        onExport={dispatchExport}
        onOpenCommandPalette={openCommandPalette}
        onOpenDocument={openDocument}
        onOpenWorkspace={() => void openWorkspace()}
        onSaveAsDocument={() => void saveAsDocument()}
        onSaveDocument={() => void saveDocument()}
        onToggleAiPanel={toggleAiPanel}
        onToggleTheme={toggleTheme}
        theme={theme}
      />
      <div
        className={`app-body${isAiPanelOpen ? " is-ai-open" : ""}${isAiPanelResizing ? " is-ai-resizing" : ""
          }`}
        ref={appBodyRef}
      >
        {isAgentConfigOpen ? (
          <AgentConfigPanel
            aiSettings={aiSettings}
            onAiSettingsChange={handleAiSettingsChange}
            onClose={() => setIsAgentConfigOpen(false)}
            mcpSyncVersion={mcpSyncVersion}
          />
        ) : (
          <>
            <Sidebar
              filePath={activeTab.path}
              onCreateFile={requestCreateFile}
              onCreateFolder={requestCreateFolder}
              onDeleteEntry={deleteWorkspaceEntry}
              onMoveEntry={(entry, targetDirectory) =>
                void moveWorkspaceEntry(entry, targetDirectory)
              }
              onOpenEntry={(path) => void openPathInTab(path)}
              onOpenSearchResult={(result) => {
                void openPathInTab(result.path).then(() => revealLine(result.line));
              }}
              onOpenWorkspace={() => void openWorkspace()}
              onOpenWorkspacePath={(path) => void openWorkspacePath(path)}
              onOpenSettings={() => openSettings("help")}
              onOutlineSelect={(item) => revealLine(item.line)}
              onRenameEntry={requestRenameEntry}
              onRemoveRecentWorkspace={removeRecentWorkspace}
              onSearchWorkspace={searchWorkspace}
              onTogglePinnedWorkspace={togglePinnedWorkspace}
              outline={outline}
              pinnedWorkspaces={pinnedWorkspaces}
              recentWorkspaces={recentWorkspaces}
              workspaceRoot={workspaceRoot}
              workspaceTree={workspaceTree}
            />
            <Workspace
              activeTabId={activeTabId}
              content={activeTab.content}
              contentVersion={activeTab.contentVersion}
              customCss={customCss}
              filePath={activeTab.path}
              onActivateTab={setActiveTabId}
              onCloseTab={closeTab}
              onContentChange={updateContent}
              onEditorViewChange={handleEditorViewChange}
              onMediaNotice={notifyMedia}
              onNotice={(message, title, isError = false) =>
                notify({
                  message,
                  title,
                  tone: isError ? "error" : "info",
                })
              }
              onNewTab={newDocument}
              previewTheme={previewTheme}
              revealRequest={revealRequest}
              tabs={tabs}
              theme={theme}
            />
            <AiSidePanel
              aiSettings={aiSettings}
              document={{
                path: activeTab.path,
                content: activeTab.content,
                selection: editorSelection,
                selectionStartLine: editorSelectionLine.start,
                selectionEndLine: editorSelectionLine.end,
                outline: outline.map((item) => item.text),
                snippets: aiContextSnippets,
                includeActiveDocument,
              }}
              isOpen={isAiPanelOpen}
              isResizing={isAiPanelResizing}
              onAiSettingsChange={handleAiSettingsChange}
              onClose={() => setAiPanelOpen(false)}
              onDismissActiveDocument={dismissActiveDocumentContext}
              onInsert={insertAiText}
              onOpenAgentConfig={() => setIsAgentConfigOpen(true)}
              onOpenSettings={() => openSettings("ai")}
              onRemoveSnippet={removeAiContextSnippet}
              onReplace={replaceAiText}
              onResizeStart={startAiPanelResize}
              width={aiPanelWidth}
              workspaceBridge={workspaceBridge}
            />
          </>
        )}
      </div>
      <StatusBar
        content={activeTab.content}
        editorFontSize={editorFontSize}
        filePath={activeTab.path}
        isDirty={isDirty}
        previewFontSize={previewFontSize}
        readingMinutes={readingMinutes}
        wordCount={wordCount}
      />
      <ConfirmDialog
        confirmLabel="放弃修改"
        description={pendingConfirmation?.description ?? ""}
        isOpen={pendingConfirmation !== null}
        onCancel={cancelPendingConfirmation}
        onConfirm={confirmPendingAction}
        title={pendingConfirmation?.title ?? ""}
      />
      <InputDialog
        description={inputRequest?.description ?? ""}
        initialValue={inputRequest?.initialValue}
        isOpen={inputRequest !== null}
        label="名称"
        onCancel={() => setInputRequest(null)}
        onConfirm={submitInputRequest}
        title={inputRequest?.title ?? ""}
      />
      <CommandPalette
        commands={commands}
        isOpen={isCommandPaletteOpen}
        onClose={closeCommandPalette}
      />
      <SettingsDialog
        aiSettings={aiSettings}
        customCss={customCss}
        editorFontSize={editorFontSize}
        isOpen={isSettingsOpen}
        onAiSettingsChange={handleAiSettingsChange}
        onClose={closeSettings}
        onCustomCssChange={setCustomCss}
        onEditorFontSizeChange={setEditorFontSize}
        onPreviewFontSizeChange={setPreviewFontSize}
        onPreviewThemeChange={setPreviewTheme}
        onResetAppearance={resetAppearance}
        onTabChange={setSettingsTab}
        previewFontSize={previewFontSize}
        previewTheme={previewTheme}
        tab={settingsTab}
      />
      <Toast onDismiss={dismissToast} toast={toast} />
    </div>
  );
}

export default App;
