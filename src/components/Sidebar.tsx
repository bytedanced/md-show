import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  OutlineItem,
  WorkspaceEntry,
  WorkspaceLocation,
  WorkspaceSearchResult,
} from "../hooks/useWorkspaceManager";
import { Icon } from "./Icon";

const TREE_DRAG_THRESHOLD_PX = 4;

interface SidebarProps {
  filePath: string | null;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDeleteEntry: (entry: WorkspaceEntry) => void;
  onMoveEntry: (entry: WorkspaceEntry, targetDirectory: string) => void;
  onOpenEntry: (path: string) => void;
  onOpenSearchResult: (result: WorkspaceSearchResult) => void;
  onOpenWorkspace: () => void;
  onOpenWorkspacePath: (path: string) => void;
  onOpenSettings: () => void;
  onOutlineSelect: (item: OutlineItem) => void;
  onRenameEntry: (entry: WorkspaceEntry) => void;
  onRemoveRecentWorkspace: (path: string) => void;
  onSearchWorkspace: (query: string) => Promise<WorkspaceSearchResult[]>;
  onTogglePinnedWorkspace: (path: string) => void;
  outline: OutlineItem[];
  pinnedWorkspaces: WorkspaceLocation[];
  recentWorkspaces: WorkspaceLocation[];
  workspaceRoot: string | null;
  workspaceTree: WorkspaceEntry[];
}

type SidebarMode = "files" | "outline" | "search" | "workspaces";

interface TreeContextMenuState {
  entry: WorkspaceEntry | null;
  x: number;
  y: number;
}

interface ContextMenuItem {
  danger?: boolean;
  label: string;
  onSelect: () => void;
  separatorBefore?: boolean;
}

interface TreeEntryProps {
  activePath: string | null;
  depth: number;
  draggingPath: string | null;
  dropTargetPath: string | null;
  entry: WorkspaceEntry;
  expandedPaths: Set<string>;
  onActivate: (entry: WorkspaceEntry) => void;
  onContextMenu: (entry: WorkspaceEntry, event: ReactMouseEvent) => void;
  onPointerDownEntry: (
    entry: WorkspaceEntry,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
}

interface WorkspaceLocationsProps {
  currentWorkspacePath: string | null;
  onOpenWorkspacePath: (path: string) => void;
  onRemoveRecentWorkspace: (path: string) => void;
  onTogglePinnedWorkspace: (path: string) => void;
  pinnedWorkspaces: WorkspaceLocation[];
  recentWorkspaces: WorkspaceLocation[];
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function normalizeTreePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function getParentDirectory(path: string) {
  const normalized = normalizeTreePath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized : normalized.slice(0, index);
}

function canDropOnDirectory(
  entry: WorkspaceEntry,
  targetDirectory: string,
): boolean {
  const sourcePath = normalizeTreePath(entry.path);
  const targetPath = normalizeTreePath(targetDirectory);
  if (sourcePath === targetPath) {
    return false;
  }
  if (getParentDirectory(sourcePath) === targetPath) {
    return false;
  }
  if (entry.isDirectory && targetPath.startsWith(`${sourcePath}/`)) {
    return false;
  }
  return true;
}

function findDropDirectoryPath(clientX: number, clientY: number) {
  const element = document.elementFromPoint(clientX, clientY);
  const dropTarget = element?.closest("[data-drop-path]");
  if (!(dropTarget instanceof HTMLElement)) {
    return null;
  }
  return dropTarget.dataset.dropPath ?? null;
}

function TreeContextMenu({
  items,
  onClose,
  x,
  y,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPosition({
      left: Math.max(8, left),
      top: Math.max(8, top),
    });
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.separatorBefore && <div className="context-menu__separator" />}
          <button
            className={`context-menu__item ${item.danger ? "is-danger" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            role="menuitem"
            type="button"
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function WorkspaceLocations({
  currentWorkspacePath,
  onOpenWorkspacePath,
  onRemoveRecentWorkspace,
  onTogglePinnedWorkspace,
  pinnedWorkspaces,
  recentWorkspaces,
}: WorkspaceLocationsProps) {
  const isPinned = (path: string) =>
    pinnedWorkspaces.some((workspace) => workspace.path === path);
  const isCurrent = (path: string) =>
    currentWorkspacePath !== null &&
    normalizeWorkspacePath(currentWorkspacePath) ===
      normalizeWorkspacePath(path);
  const visibleRecentWorkspaces = recentWorkspaces.filter(
    (workspace) => !isPinned(workspace.path),
  );

  if (!pinnedWorkspaces.length && !visibleRecentWorkspaces.length) {
    return <p className="tree__empty">还没有工作区记录。</p>;
  }

  return (
    <div className="workspace-locations">
      {pinnedWorkspaces.length > 0 && (
        <section>
          <h2>收藏工作区</h2>
          {pinnedWorkspaces.map((workspace) => (
            <div
              className={`workspace-location${isCurrent(workspace.path) ? " is-current" : ""}`}
              key={workspace.path}
            >
              <button
                aria-current={isCurrent(workspace.path) ? "true" : undefined}
                className="workspace-location__select"
                onClick={() => onOpenWorkspacePath(workspace.path)}
                title={workspace.path}
                type="button"
              >
                <Icon name="folder" size={14} />
                <span>{workspace.name}</span>
                {isCurrent(workspace.path) && (
                  <em className="workspace-location__badge">当前</em>
                )}
              </button>
              <button
                aria-label={`取消收藏 ${workspace.name}`}
                className="workspace-location__action is-pinned"
                onClick={() => onTogglePinnedWorkspace(workspace.path)}
                title="取消收藏"
                type="button"
              >
                ★
              </button>
            </div>
          ))}
        </section>
      )}
      {visibleRecentWorkspaces.length > 0 && (
        <section>
          <h2>最近工作区</h2>
          {visibleRecentWorkspaces.map((workspace) => (
            <div
              className={`workspace-location${isCurrent(workspace.path) ? " is-current" : ""}`}
              key={workspace.path}
            >
              <button
                aria-current={isCurrent(workspace.path) ? "true" : undefined}
                className="workspace-location__select"
                onClick={() => onOpenWorkspacePath(workspace.path)}
                title={workspace.path}
                type="button"
              >
                <Icon name="folder" size={14} />
                <span>{workspace.name}</span>
                {isCurrent(workspace.path) && (
                  <em className="workspace-location__badge">当前</em>
                )}
              </button>
              <button
                aria-label={`收藏 ${workspace.name}`}
                className="workspace-location__action"
                onClick={() => onTogglePinnedWorkspace(workspace.path)}
                title="收藏"
                type="button"
              >
                ☆
              </button>
              <button
                aria-label={`移除 ${workspace.name}`}
                className="workspace-location__action"
                onClick={() => onRemoveRecentWorkspace(workspace.path)}
                title="从最近记录中移除"
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function TreeEntry({
  activePath,
  depth,
  draggingPath,
  dropTargetPath,
  entry,
  expandedPaths,
  onActivate,
  onContextMenu,
  onPointerDownEntry,
}: TreeEntryProps) {
  const isExpanded = expandedPaths.has(entry.path);
  const isDropTarget =
    entry.isDirectory && dropTargetPath === entry.path && draggingPath !== null;

  return (
    <>
      <div
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        className={`workspace-tree__entry ${
          activePath === entry.path ? "is-active" : ""
        } ${draggingPath === entry.path ? "is-dragging" : ""} ${
          isDropTarget ? "is-drop-target" : ""
        }`}
        data-drop-path={entry.isDirectory ? entry.path : undefined}
        onClick={() => onActivate(entry)}
        onContextMenu={(event) => onContextMenu(entry, event)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onActivate(entry);
          }
        }}
        onPointerDown={(event) => onPointerDownEntry(entry, event)}
        role="treeitem"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        tabIndex={0}
        title={`${entry.path}（按住拖到文件夹可移动，右键打开菜单）`}
      >
        <div className="workspace-tree__name">
          {entry.isDirectory ? (
            <span
              className={`workspace-tree__chevron ${
                isExpanded ? "is-expanded" : ""
              }`}
            >
              <Icon name="chevron" size={12} />
            </span>
          ) : (
            <span className="workspace-tree__spacer" />
          )}
          <Icon name={entry.isDirectory ? "folder" : "file"} size={14} />
          <span>{entry.name}</span>
        </div>
      </div>
      {entry.isDirectory &&
        isExpanded &&
        entry.children?.map((child) => (
          <TreeEntry
            activePath={activePath}
            depth={depth + 1}
            draggingPath={draggingPath}
            dropTargetPath={dropTargetPath}
            entry={child}
            expandedPaths={expandedPaths}
            key={child.path}
            onActivate={onActivate}
            onContextMenu={onContextMenu}
            onPointerDownEntry={onPointerDownEntry}
          />
        ))}
    </>
  );
}

export function Sidebar({
  filePath,
  onCreateFile,
  onCreateFolder,
  onDeleteEntry,
  onMoveEntry,
  onOpenEntry,
  onOpenSearchResult,
  onOpenWorkspace,
  onOpenWorkspacePath,
  onOpenSettings,
  onOutlineSelect,
  onRenameEntry,
  onRemoveRecentWorkspace,
  onSearchWorkspace,
  onTogglePinnedWorkspace,
  outline,
  pinnedWorkspaces,
  recentWorkspaces,
  workspaceRoot,
  workspaceTree,
}: SidebarProps) {
  const [mode, setMode] = useState<SidebarMode>("files");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(
    null,
  );
  const dragSessionRef = useRef<{
    active: boolean;
    entry: WorkspaceEntry;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    const handleSetMode = (event: Event) => {
      const next = (event as CustomEvent<SidebarMode>).detail;
      if (
        next === "files" ||
        next === "workspaces" ||
        next === "search" ||
        next === "outline"
      ) {
        setMode(next);
      }
    };
    window.addEventListener("md-show:set-sidebar-mode", handleSetMode);
    return () => {
      window.removeEventListener("md-show:set-sidebar-mode", handleSetMode);
    };
  }, []);

  useEffect(() => {
    const finishDrag = (clientX: number, clientY: number) => {
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      document.body.classList.remove("is-tree-dragging");
      setDraggingPath(null);
      setDropTargetPath(null);
      if (!session?.active) {
        return;
      }
      suppressNextClickRef.current = true;
      const targetPath = findDropDirectoryPath(clientX, clientY);
      if (targetPath && canDropOnDirectory(session.entry, targetPath)) {
        onMoveEntry(session.entry, targetPath);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - session.startX,
        event.clientY - session.startY,
      );
      if (!session.active) {
        if (distance < TREE_DRAG_THRESHOLD_PX) {
          return;
        }
        session.active = true;
        document.body.classList.add("is-tree-dragging");
        setDraggingPath(session.entry.path);
      }
      const targetPath = findDropDirectoryPath(event.clientX, event.clientY);
      if (targetPath && canDropOnDirectory(session.entry, targetPath)) {
        setDropTargetPath(targetPath);
      } else {
        setDropTargetPath(null);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      finishDrag(event.clientX, event.clientY);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      dragSessionRef.current = null;
      document.body.classList.remove("is-tree-dragging");
      setDraggingPath(null);
      setDropTargetPath(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      document.body.classList.remove("is-tree-dragging");
    };
  }, [onMoveEntry]);

  const handlePointerDownEntry = (
    entry: WorkspaceEntry,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    dragSessionRef.current = {
      active: false,
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleActivateEntry = (entry: WorkspaceEntry) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (entry.isDirectory) {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
      return;
    }
    onOpenEntry(entry.path);
  };

  const openContextMenu = (
    entry: WorkspaceEntry | null,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      entry,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const contextMenuItems = ((): ContextMenuItem[] => {
    if (!contextMenu || !workspaceRoot) {
      return [];
    }

    const copyPath = (path: string) => {
      void navigator.clipboard.writeText(path);
    };

    if (!contextMenu.entry) {
      return [
        {
          label: "新建文件",
          onSelect: () => onCreateFile(workspaceRoot),
        },
        {
          label: "新建文件夹",
          onSelect: () => onCreateFolder(workspaceRoot),
        },
        {
          label: "复制路径",
          onSelect: () => copyPath(workspaceRoot),
          separatorBefore: true,
        },
        {
          label: "打开所在位置",
          onSelect: () => {
            void revealItemInDir(workspaceRoot);
          },
        },
      ];
    }

    const entry = contextMenu.entry;
    const items: ContextMenuItem[] = [];

    if (!entry.isDirectory) {
      items.push({
        label: "打开",
        onSelect: () => onOpenEntry(entry.path),
      });
    }

    if (entry.isDirectory) {
      items.push(
        {
          label: "新建文件",
          onSelect: () => onCreateFile(entry.path),
        },
        {
          label: "新建文件夹",
          onSelect: () => onCreateFolder(entry.path),
        },
      );
    }

    items.push(
      {
        label: "复制路径",
        onSelect: () => copyPath(entry.path),
        separatorBefore: items.length > 0,
      },
      {
        label: "打开所在位置",
        onSelect: () => {
          void revealItemInDir(entry.path);
        },
      },
      {
        label: "重命名",
        onSelect: () => onRenameEntry(entry),
      },
      {
        danger: true,
        label: "删除",
        onSelect: () => onDeleteEntry(entry),
      },
    );

    return items;
  })();

  useEffect(() => {
    if (mode !== "search" || !query.trim()) {
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      const results = await onSearchWorkspace(query);
      if (active) {
        setSearchResults(results);
        setIsSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mode, onSearchWorkspace, query]);

  const workspaceName = workspaceRoot?.split(/[\\/]/).pop() ?? "尚未打开工作区";

  return (
    <aside className="sidebar">
      <div className="sidebar-modes">
        {(["files", "workspaces", "search", "outline"] as const).map(
          (item) => (
            <button
              className={mode === item ? "is-active" : ""}
              key={item}
              onClick={() => {
                setMode(item);
                setIsSearching(false);
                if (item !== "search") {
                  setQuery("");
                  setSearchResults([]);
                }
              }}
              type="button"
            >
              {item === "files"
                ? "文件"
                : item === "workspaces"
                  ? "工作区"
                  : item === "search"
                    ? "搜索"
                    : "大纲"}
            </button>
          ),
        )}
      </div>

      {mode === "files" && (
        <div className="workspace-tree">
          {workspaceRoot ? (
            <>
              <div
                className={`workspace-tree__root ${
                  dropTargetPath === workspaceRoot ? "is-drop-target" : ""
                }`}
                data-drop-path={workspaceRoot}
                onContextMenu={(event) => openContextMenu(null, event)}
                title={`${workspaceRoot}（右键打开菜单）`}
              >
                <div className="workspace-tree__root-label">
                  <Icon name="folder" size={14} />
                  <span>{workspaceName}</span>
                </div>
              </div>
              {workspaceTree.map((entry) => (
                <TreeEntry
                  activePath={filePath}
                  depth={0}
                  draggingPath={draggingPath}
                  dropTargetPath={dropTargetPath}
                  entry={entry}
                  expandedPaths={expandedPaths}
                  key={entry.path}
                  onActivate={handleActivateEntry}
                  onContextMenu={openContextMenu}
                  onPointerDownEntry={handlePointerDownEntry}
                />
              ))}
              {contextMenu && contextMenuItems.length > 0 && (
                <TreeContextMenu
                  items={contextMenuItems}
                  onClose={() => setContextMenu(null)}
                  x={contextMenu.x}
                  y={contextMenu.y}
                />
              )}
            </>
          ) : (
            <div className="sidebar__empty">
              <div className="sidebar__empty-icon">
                <Icon name="folder" size={20} />
              </div>
              <strong>打开 Markdown 工作区</strong>
              <p>选择一个文件夹以管理其中的文档。</p>
              <button
                className="button button--secondary"
                onClick={onOpenWorkspace}
                type="button"
              >
                打开文件夹
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "workspaces" && (
        <div className="sidebar-panel">
          <WorkspaceLocations
            currentWorkspacePath={workspaceRoot}
            onOpenWorkspacePath={onOpenWorkspacePath}
            onRemoveRecentWorkspace={onRemoveRecentWorkspace}
            onTogglePinnedWorkspace={onTogglePinnedWorkspace}
            pinnedWorkspaces={pinnedWorkspaces}
            recentWorkspaces={recentWorkspaces}
          />
        </div>
      )}

      {mode === "search" && (
        <div className="sidebar-panel">
          <label className="search-box">
            <Icon name="search" size={15} />
            <input
              aria-label="搜索工作区内容"
              onChange={(event) => {
                const nextQuery = event.currentTarget.value;
                setQuery(nextQuery);
                if (!nextQuery.trim()) {
                  setSearchResults([]);
                  setIsSearching(false);
                }
              }}
              placeholder="全文搜索"
              type="search"
              value={query}
            />
          </label>
          <div className="search-results">
            {isSearching && <p className="tree__empty">正在搜索…</p>}
            {!isSearching &&
              searchResults.map((result, index) => (
                <button
                  key={`${result.path}:${result.line}:${index}`}
                  onClick={() => onOpenSearchResult(result)}
                  type="button"
                >
                  <strong>
                    {result.name}:{result.line}
                  </strong>
                  <span>{result.preview}</span>
                </button>
              ))}
            {!isSearching && query && searchResults.length === 0 && (
              <p className="tree__empty">没有找到匹配内容</p>
            )}
          </div>
        </div>
      )}

      {mode === "outline" && (
        <div className="outline-list">
          {outline.length ? (
            outline.map((item, index) => (
              <button
                key={`${item.line}:${index}`}
                onClick={() => onOutlineSelect(item)}
                style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
                title={`第 ${item.line} 行`}
                type="button"
              >
                {item.text}
              </button>
            ))
          ) : (
            <p className="tree__empty">当前文档没有标题</p>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <button
          className="sidebar-footer__settings"
          onClick={onOpenSettings}
          title="设置与使用说明"
          type="button"
        >
          <Icon name="settings" size={16} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
