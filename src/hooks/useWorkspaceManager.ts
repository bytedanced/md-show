import { getCurrentWindow } from "@tauri-apps/api/window";
import { dirname, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToastMessage } from "../components/Toast";

const RECENT_FILES_KEY = "md-show-recent-files";
const RECENT_WORKSPACES_KEY = "md-show-recent-workspaces";
const PINNED_WORKSPACES_KEY = "md-show-pinned-workspaces";
const SESSION_KEY = "md-show-workspace-session";
const MAX_RECENT_FILES = 8;
const MAX_RECENT_WORKSPACES = 8;
const ignoredDirectories = new Set([
  ".git",
  "dist",
  "node_modules",
  "src-tauri",
  "target",
]);

export interface RecentFile {
  name: string;
  path: string;
  updatedAt: number;
}

export interface WorkspaceLocation {
  name: string;
  path: string;
  updatedAt: number;
}

export interface DocumentTab {
  content: string;
  contentVersion: number;
  id: string;
  name: string;
  path: string | null;
  savedContent: string;
}

export interface WorkspaceEntry {
  children?: WorkspaceEntry[];
  isDirectory: boolean;
  name: string;
  path: string;
}

export interface WorkspaceSearchResult {
  line: number;
  name: string;
  path: string;
  preview: string;
}

export interface OutlineItem {
  level: number;
  line: number;
  text: string;
}

interface PendingConfirmation {
  action: () => void | Promise<void>;
  description: string;
  title: string;
}

interface StoredSession {
  activeTabId: string;
  tabs: DocumentTab[];
  workspaceRoot: string | null;
}

type Notify = (message: Omit<ToastMessage, "id">) => void;

const markdownFilters = [
  {
    name: "Markdown 文档",
    extensions: ["md", "markdown", "mdown", "mkd"],
  },
];

function createUntitledTab(): DocumentTab {
  return {
    content: "",
    contentVersion: 0,
    id: crypto.randomUUID(),
    name: "未命名.md",
    path: null,
    savedContent: "",
  };
}

function getFileName(path: string | null) {
  return path?.split(/[\\/]/).pop() || "未命名.md";
}

function ensureMarkdownExtension(path: string) {
  return /\.(md|markdown|mdown|mkd)$/i.test(path) ? path : `${path}.md`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePortablePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/")
    ? "/"
    : (/^[a-z]:/i.exec(normalized)?.[0] ?? "");
  const parts = normalized.slice(prefix.length).split("/").filter(Boolean);
  const resolvedParts: string[] = [];
  parts.forEach((part) => {
    if (part === ".") return;
    if (part === "..") resolvedParts.pop();
    else resolvedParts.push(part);
  });
  return `${prefix}${prefix && prefix !== "/" ? "/" : ""}${resolvedParts.join("/")}`;
}

function resolvePortablePath(baseDirectory: string, relativePath: string) {
  return normalizePortablePath(`${baseDirectory}/${relativePath}`);
}

function relativePortablePath(fromDirectory: string, targetPath: string) {
  const from = normalizePortablePath(fromDirectory).split("/");
  const target = normalizePortablePath(targetPath).split("/");
  let commonLength = 0;
  while (
    commonLength < from.length &&
    commonLength < target.length &&
    from[commonLength].toLocaleLowerCase() ===
    target[commonLength].toLocaleLowerCase()
  ) {
    commonLength += 1;
  }
  if (commonLength === 0) return targetPath;
  const result = [
    ...Array.from({ length: from.length - commonLength }, () => ".."),
    ...target.slice(commonLength),
  ].join("/");
  return result.startsWith(".") ? result : `./${result}`;
}

function rewriteMovedDocumentMediaPaths(
  content: string,
  oldDocumentPath: string,
  newDocumentPath: string,
) {
  const oldDirectory = normalizePortablePath(oldDocumentPath)
    .split("/")
    .slice(0, -1)
    .join("/");
  const newDirectory = normalizePortablePath(newDocumentPath)
    .split("/")
    .slice(0, -1)
    .join("/");
  if (oldDirectory === newDirectory) return content;

  const rewriteSource = (source: string) => {
    if (
      /^(?:[a-z]+:|#|\/|\\\\)/i.test(source) ||
      /^[a-z]:[\\/]/i.test(source)
    ) {
      return source;
    }
    const absoluteMediaPath = resolvePortablePath(
      oldDirectory,
      decodeURIComponent(source),
    );
    return relativePortablePath(newDirectory, absoluteMediaPath);
  };

  return content
    .replace(
      /(!\[[^\]]*\]\()([^\s)]+)([^)]*\))/g,
      (_, prefix: string, source: string, suffix: string) =>
        `${prefix}${rewriteSource(source)}${suffix}`,
    )
    .replace(
      /(@\[(?:video|audio)\]\()([^\s)]+)([^)]*\))/g,
      (_, prefix: string, source: string, suffix: string) =>
        `${prefix}${rewriteSource(source)}${suffix}`,
    )
    .replace(
      /(\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
      (_, prefix: string, source: string, suffix: string) =>
        `${prefix}${rewriteSource(source)}${suffix}`,
    );
}

function loadRecentFiles(): RecentFile[] {
  try {
    const saved = localStorage.getItem(RECENT_FILES_KEY);
    return saved ? (JSON.parse(saved) as RecentFile[]) : [];
  } catch {
    return [];
  }
}

function loadWorkspaceLocations(key: string): WorkspaceLocation[] {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as WorkspaceLocation[]) : [];
  } catch {
    return [];
  }
}

function getWorkspaceName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function loadSession(): StoredSession {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const session = JSON.parse(saved) as StoredSession;
      if (session.tabs?.length) {
        session.tabs = session.tabs.map((tab) => ({
          ...tab,
          contentVersion: tab.contentVersion ?? 0,
        }));
        return session;
      }
    }
  } catch {
    // 损坏的恢复数据会被新的会话覆盖。
  }

  // 无会话记录时不自动创建标签页，主界面显示空白欢迎页。
  return { activeTabId: "", tabs: [], workspaceRoot: null };
}

async function readWorkspaceTree(
  rootPath: string,
  depth = 0,
): Promise<WorkspaceEntry[]> {
  if (depth > 12) {
    return [];
  }

  const entries = await readDir(rootPath);
  const tree = await Promise.all(
    entries
      .filter((entry) => {
        const isDirectory = Boolean(entry.isDirectory);
        const isFile = Boolean(entry.isFile) || (!isDirectory && !entry.isSymlink);
        return (
          (isDirectory && !ignoredDirectories.has(entry.name)) || isFile
        );
      })
      .map(async (entry): Promise<WorkspaceEntry> => {
        const isDirectory = Boolean(entry.isDirectory);
        const path = await join(rootPath, entry.name);
        return {
          children: isDirectory
            ? await readWorkspaceTree(path, depth + 1)
            : undefined,
          isDirectory,
          name: entry.name,
          path,
        };
      }),
  );

  return tree.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

function flattenAllFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) =>
    entry.isDirectory ? flattenAllFiles(entry.children ?? []) : [entry],
  );
}

export function useWorkspaceManager(notify: Notify) {
  const initialSession = useMemo(() => loadSession(), []);
  const [tabs, setTabs] = useState(initialSession.tabs);
  const [activeTabId, setActiveTabId] = useState(initialSession.activeTabId);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecentFiles);
  const [recentWorkspaces, setRecentWorkspaces] = useState<
    WorkspaceLocation[]
  >(() => loadWorkspaceLocations(RECENT_WORKSPACES_KEY));
  const [pinnedWorkspaces, setPinnedWorkspaces] = useState<
    WorkspaceLocation[]
  >(() => loadWorkspaceLocations(PINNED_WORKSPACES_KEY));
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(
    initialSession.workspaceRoot,
  );
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceEntry[]>([]);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const allowWindowCloseRef = useRef(false);
  const hasDirtyTabsRef = useRef(false);

  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ??
    tabs[0] ??
    createUntitledTab();
  const isDirty = activeTab.content !== activeTab.savedContent;
  const hasDirtyTabs = tabs.some((tab) => tab.content !== tab.savedContent);

  useEffect(() => {
    hasDirtyTabsRef.current = hasDirtyTabs;
  }, [hasDirtyTabs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ activeTabId, tabs, workspaceRoot }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeTabId, tabs, workspaceRoot]);

  const rememberFile = useCallback((path: string) => {
    setRecentFiles((currentFiles) => {
      const nextFile = {
        name: getFileName(path),
        path,
        updatedAt: Date.now(),
      };
      const nextFiles = [
        nextFile,
        ...currentFiles.filter((file) => file.path !== path),
      ].slice(0, MAX_RECENT_FILES);
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(nextFiles));
      return nextFiles;
    });
  }, []);

  const rememberWorkspace = useCallback((path: string) => {
    setRecentWorkspaces((currentWorkspaces) => {
      const workspace = {
        name: getWorkspaceName(path),
        path,
        updatedAt: Date.now(),
      };
      const nextWorkspaces = [
        workspace,
        ...currentWorkspaces.filter((item) => item.path !== path),
      ].slice(0, MAX_RECENT_WORKSPACES);
      localStorage.setItem(
        RECENT_WORKSPACES_KEY,
        JSON.stringify(nextWorkspaces),
      );
      return nextWorkspaces;
    });
  }, []);

  const updateContent = useCallback(
    (content: string) => {
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content } : tab,
        ),
      );
    },
    [activeTabId],
  );

  /** 按路径更新标签页内容（用于 AI 工具写文件后同步标签页）。 */
  const updateTabByPath = useCallback(
    (targetPath: string, content: string) => {
      const normalized = targetPath.replace(/\\/g, "/");
      setTabs((prev) =>
        prev.map((tab) =>
          tab.path && tab.path.replace(/\\/g, "/") === normalized
            ? { ...tab, content, savedContent: content, contentVersion: tab.contentVersion + 1 }
            : tab,
        ),
      );
    },
    [],
  );

  const openPathInTab = useCallback(
    async (path: string) => {
      const existingTab = tabs.find((tab) => tab.path === path);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      try {
        const content = await readTextFile(path);
        const tab: DocumentTab = {
          content,
          contentVersion: 0,
          id: crypto.randomUUID(),
          name: getFileName(path),
          path,
          savedContent: content,
        };
        setTabs((currentTabs) => {
          const removableBlank =
            currentTabs.length === 1 &&
            currentTabs[0].path === null &&
            currentTabs[0].content === "";
          return removableBlank ? [tab] : [...currentTabs, tab];
        });
        setActiveTabId(tab.id);
        rememberFile(path);
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法打开文档",
          tone: "error",
        });
      }
    },
    [notify, rememberFile, tabs],
  );

  const openDocument = useCallback(
    async (defaultPath?: string) => {
      try {
        const selectedPath = await open({
          defaultPath,
          directory: false,
          filters: markdownFilters,
          multiple: false,
          title: "打开 Markdown 文档",
        });
        if (typeof selectedPath === "string") {
          await openPathInTab(selectedPath);
        }
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法选择文档",
          tone: "error",
        });
      }
    },
    [notify, openPathInTab],
  );

  const newDocument = useCallback(() => {
    const tab = createUntitledTab();
    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }, []);

  const saveTab = useCallback(
    async (tabId: string, saveAs = false) => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) {
        return false;
      }

      try {
        let destination = saveAs ? null : tab.path;
        if (!destination) {
          destination = await save({
            defaultPath: tab.name,
            filters: markdownFilters,
            title: saveAs ? "Markdown 文档另存为" : "保存 Markdown 文档",
          });
        }
        if (!destination) {
          return false;
        }

        destination = ensureMarkdownExtension(destination);
        const contentToSave = tab.content;
        await writeTextFile(destination, contentToSave);
        setTabs((currentTabs) =>
          currentTabs.map((item) =>
            item.id === tabId
              ? {
                ...item,
                name: getFileName(destination),
                path: destination,
                savedContent: contentToSave,
              }
              : item,
          ),
        );
        rememberFile(destination);
        return true;
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法保存文档",
          tone: "error",
        });
        return false;
      }
    },
    [notify, rememberFile, tabs],
  );

  const requestConfirmation = useCallback(
    (
      action: () => void | Promise<void>,
      title: string,
      description: string,
    ) => {
      setPendingConfirmation({ action, description, title });
    },
    [],
  );

  const closeTabImmediately = useCallback(
    (tabId: string) => {
      setTabs((currentTabs) => {
        const index = currentTabs.findIndex((tab) => tab.id === tabId);
        const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
        if (nextTabs.length === 0) {
          setActiveTabId("");
          return [];
        }
        if (activeTabId === tabId) {
          setActiveTabId(
            nextTabs[Math.max(0, index - 1)]?.id ?? nextTabs[0].id,
          );
        }
        return nextTabs;
      });
    },
    [activeTabId],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) {
        return;
      }
      if (tab.content !== tab.savedContent) {
        requestConfirmation(
          () => closeTabImmediately(tabId),
          "关闭未保存的文档？",
          `${tab.name} 的修改尚未保存，继续关闭将丢失这些修改。`,
        );
      } else {
        closeTabImmediately(tabId);
      }
    },
    [closeTabImmediately, requestConfirmation, tabs],
  );

  const refreshWorkspace = useCallback(
    async (root = workspaceRoot) => {
      if (!root) {
        setWorkspaceTree([]);
        return;
      }
      try {
        const rootExists = await exists(root);
        if (!rootExists) {
          setWorkspaceTree([]);
          notify({
            message: "工作区目录已不存在，请重新打开工作区。",
            title: "无法读取工作区",
            tone: "error",
          });
          return;
        }
        setWorkspaceTree(await readWorkspaceTree(root));
      } catch (error) {
        setWorkspaceTree([]);
        notify({
          message: `${getErrorMessage(error)}。若刚重启应用，请重新打开一次工作区以恢复目录访问权限。`,
          title: "无法读取工作区",
          tone: "error",
        });
      }
    },
    [notify, workspaceRoot],
  );

  const openWorkspacePath = useCallback(
    async (path: string) => {
      setWorkspaceRoot(path);
      rememberWorkspace(path);
      await refreshWorkspace(path);
    },
    [rememberWorkspace, refreshWorkspace],
  );

  const openWorkspace = useCallback(async () => {
    try {
      const selectedPath = await open({
        defaultPath: workspaceRoot ?? undefined,
        directory: true,
        multiple: false,
        recursive: true,
        title: "打开 Markdown 工作区",
      });
      if (typeof selectedPath === "string") {
        await openWorkspacePath(selectedPath);
      }
    } catch (error) {
      notify({
        message: getErrorMessage(error),
        title: "无法打开工作区",
        tone: "error",
      });
    }
  }, [notify, openWorkspacePath, workspaceRoot]);

  const togglePinnedWorkspace = useCallback((path: string) => {
    setPinnedWorkspaces((currentWorkspaces) => {
      const existingWorkspace = currentWorkspaces.find(
        (workspace) => workspace.path === path,
      );
      const nextWorkspaces = existingWorkspace
        ? currentWorkspaces.filter((workspace) => workspace.path !== path)
        : [
          {
            name: getWorkspaceName(path),
            path,
            updatedAt: Date.now(),
          },
          ...currentWorkspaces,
        ];
      localStorage.setItem(
        PINNED_WORKSPACES_KEY,
        JSON.stringify(nextWorkspaces),
      );
      return nextWorkspaces;
    });
  }, []);

  const removeRecentWorkspace = useCallback((path: string) => {
    setRecentWorkspaces((currentWorkspaces) => {
      const nextWorkspaces = currentWorkspaces.filter(
        (workspace) => workspace.path !== path,
      );
      localStorage.setItem(
        RECENT_WORKSPACES_KEY,
        JSON.stringify(nextWorkspaces),
      );
      return nextWorkspaces;
    });
  }, []);

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    const timer = window.setTimeout(() => {
      void refreshWorkspace(workspaceRoot);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshWorkspace, workspaceRoot]);

  const createWorkspaceFile = useCallback(
    async (parentPath: string, name: string) => {
      try {
        const path = await join(parentPath, ensureMarkdownExtension(name));
        await writeTextFile(path, "");
        await refreshWorkspace();
        await openPathInTab(path);
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法新建文件",
          tone: "error",
        });
      }
    },
    [notify, openPathInTab, refreshWorkspace],
  );

  const createWorkspaceFolder = useCallback(
    async (parentPath: string, name: string) => {
      try {
        await mkdir(await join(parentPath, name), { recursive: false });
        await refreshWorkspace();
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法新建文件夹",
          tone: "error",
        });
      }
    },
    [notify, refreshWorkspace],
  );

  const renameWorkspaceEntry = useCallback(
    async (entry: WorkspaceEntry, newName: string) => {
      try {
        const destination = await join(await dirname(entry.path), newName);
        await rename(entry.path, destination);
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (!tab.path) {
              return tab;
            }
            const movedPath =
              tab.path === entry.path
                ? destination
                : tab.path.startsWith(`${entry.path}\\`) ||
                  tab.path.startsWith(`${entry.path}/`)
                  ? `${destination}${tab.path.slice(entry.path.length)}`
                  : tab.path;
            return movedPath === tab.path
              ? tab
              : { ...tab, name: getFileName(movedPath), path: movedPath };
          }),
        );
        await refreshWorkspace();
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法重命名",
          tone: "error",
        });
      }
    },
    [notify, refreshWorkspace],
  );

  const moveWorkspaceEntry = useCallback(
    async (entry: WorkspaceEntry, targetDirectory: string) => {
      try {
        const normalizePath = (path: string) =>
          path.replace(/\\/g, "/").replace(/\/+$/, "");
        const sourcePath = normalizePath(entry.path);
        const targetPath = normalizePath(targetDirectory);

        if (
          sourcePath === targetPath ||
          targetPath.startsWith(`${sourcePath}/`)
        ) {
          return;
        }

        const destination = await join(targetDirectory, entry.name);
        if (normalizePath(destination) === sourcePath) {
          return;
        }

        const openTab = tabs.find((tab) => tab.path === entry.path);
        const originalContent =
          !entry.isDirectory && !openTab
            ? await readTextFile(entry.path)
            : openTab?.content;
        await rename(entry.path, destination);
        const rewrittenContent =
          !entry.isDirectory && originalContent !== undefined
            ? rewriteMovedDocumentMediaPaths(
              originalContent,
              entry.path,
              destination,
            )
            : undefined;
        if (
          rewrittenContent !== undefined &&
          (openTab !== undefined || rewrittenContent !== originalContent)
        ) {
          await writeTextFile(destination, rewrittenContent);
        }
        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (!tab.path) return tab;
            const movedPath =
              tab.path === entry.path
                ? destination
                : tab.path.startsWith(`${entry.path}\\`) ||
                  tab.path.startsWith(`${entry.path}/`)
                  ? `${destination}${tab.path.slice(entry.path.length)}`
                  : tab.path;
            return movedPath === tab.path
              ? tab
              : {
                ...tab,
                content:
                  tab.path === entry.path && rewrittenContent !== undefined
                    ? rewrittenContent
                    : tab.content,
                name: getFileName(movedPath),
                path: movedPath,
                savedContent:
                  tab.path === entry.path && rewrittenContent !== undefined
                    ? rewrittenContent
                    : tab.savedContent,
              };
          }),
        );
        await refreshWorkspace();
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法移动",
          tone: "error",
        });
      }
    },
    [notify, refreshWorkspace, tabs],
  );

  const deleteWorkspaceEntry = useCallback(
    (entry: WorkspaceEntry) => {
      requestConfirmation(
        async () => {
          try {
            await remove(entry.path, { recursive: entry.isDirectory });
            setTabs((currentTabs) => {
              const remaining = currentTabs.filter(
                (tab) =>
                  !tab.path ||
                  (tab.path !== entry.path &&
                    !tab.path.startsWith(`${entry.path}\\`) &&
                    !tab.path.startsWith(`${entry.path}/`)),
              );
              if (remaining.length > 0) {
                if (!remaining.some((tab) => tab.id === activeTabId)) {
                  setActiveTabId(remaining[0].id);
                }
                return remaining;
              }
              setActiveTabId("");
              return [];
            });
            await refreshWorkspace();
          } catch (error) {
            notify({
              message: getErrorMessage(error),
              title: "无法删除",
              tone: "error",
            });
          }
        },
        `删除${entry.isDirectory ? "文件夹" : "文件"}？`,
        `“${entry.name}”将被永久删除，此操作无法撤销。`,
      );
    },
    [activeTabId, notify, refreshWorkspace, requestConfirmation],
  );

  const searchWorkspace = useCallback(
    async (query: string): Promise<WorkspaceSearchResult[]> => {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      if (!normalizedQuery) {
        return [];
      }

      const files = flattenAllFiles(workspaceTree);
      const results: WorkspaceSearchResult[] = [];
      for (const file of files) {
        try {
          const content = await readTextFile(file.path);
          const lines = content.split(/\r\n|\r|\n/);
          lines.forEach((line, index) => {
            if (
              results.length < 80 &&
              line.toLocaleLowerCase().includes(normalizedQuery)
            ) {
              results.push({
                line: index + 1,
                name: file.name,
                path: file.path,
                preview: line.trim() || "（空行）",
              });
            }
          });
        } catch {
          // 单个文件不可读时继续搜索其他文件。
        }
      }
      return results;
    },
    [workspaceTree],
  );

  useEffect(() => {
    const timers = tabs
      .filter((tab) => tab.path && tab.content !== tab.savedContent)
      .map((tab) =>
        window.setTimeout(async () => {
          try {
            await writeTextFile(tab.path!, tab.content);
            setTabs((currentTabs) =>
              currentTabs.map((item) =>
                item.id === tab.id && item.content === tab.content
                  ? { ...item, savedContent: tab.content }
                  : item,
              ),
            );
          } catch {
            // 手动保存时会提供完整错误信息，自动保存失败保留未保存状态。
          }
        }, 1800),
      );
    return () => timers.forEach(window.clearTimeout);
  }, [tabs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        newDocument();
      } else if (key === "o") {
        event.preventDefault();
        void openDocument();
      } else if (key === "s") {
        event.preventDefault();
        void saveTab(activeTabId, event.shiftKey);
      } else if (key === "w") {
        event.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, closeTab, newDocument, openDocument, saveTab]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return undefined;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowWindowCloseRef.current || !hasDirtyTabsRef.current) {
          return;
        }
        event.preventDefault();
        setPendingConfirmation({
          action: async () => {
            allowWindowCloseRef.current = true;
            await getCurrentWindow().destroy();
          },
          description: "仍有文档尚未保存。关闭应用将丢失这些修改。",
          title: "确定关闭应用？",
        });
      })
      .then((removeListener) => {
        if (disposed) {
          removeListener();
        } else {
          unlisten = removeListener;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const outline = useMemo<OutlineItem[]>(
    () =>
      activeTab.content.split(/\r\n|\r|\n/).flatMap((line, index) => {
        const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
        return match
          ? [{ level: match[1].length, line: index + 1, text: match[2] }]
          : [];
      }),
    [activeTab.content],
  );

  const wordCount = useMemo(() => {
    const chineseCharacters =
      activeTab.content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const latinWords =
      activeTab.content.match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g)?.length ??
      0;
    return chineseCharacters + latinWords;
  }, [activeTab.content]);

  return {
    activeTab,
    activeTabId,
    cancelPendingConfirmation: () => setPendingConfirmation(null),
    closeTab,
    confirmPendingAction: () => {
      const action = pendingConfirmation?.action;
      setPendingConfirmation(null);
      if (action) void action();
    },
    createWorkspaceFile,
    createWorkspaceFolder,
    deleteWorkspaceEntry,
    hasDirtyTabs,
    isDirty,
    newDocument,
    moveWorkspaceEntry,
    openDocument: () => openDocument(),
    openPathInTab,
    openRecentDocument: (recent: RecentFile) => openDocument(recent.path),
    openWorkspace,
    openWorkspacePath,
    outline,
    pendingConfirmation,
    pinnedWorkspaces,
    readingMinutes:
      wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 400)),
    recentFiles,
    recentWorkspaces,
    refreshWorkspace,
    removeRecentWorkspace,
    renameWorkspaceEntry,
    saveAsDocument: () => saveTab(activeTabId, true),
    saveDocument: () => saveTab(activeTabId),
    searchWorkspace,
    setActiveTabId,
    tabs,
    togglePinnedWorkspace,
    updateContent,
    updateTabByPath,
    wordCount,
    workspaceRoot,
    workspaceTree,
  };
}
