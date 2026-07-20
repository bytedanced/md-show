import {
  assertInsideWorkspace,
  assertReadableTextPath,
  isTextExtensionAllowed,
  normalizePath,
  PathPolicyError,
  resolveWorkspacePath,
} from "../safety/pathPolicy";
import type { OpenTabSnapshot } from "../types";
import {
  DEFAULT_MAX_DIR_ENTRIES,
  DEFAULT_MAX_READ_CHARS,
  DEFAULT_MAX_READ_LINES,
  IGNORED_DIRECTORY_NAMES,
} from "./limits";

export interface WorkspaceDirEntry {
  name: string;
  /** 工作区内 portable 路径（正斜杠） */
  path: string;
  isDirectory: boolean;
}

export interface WorkspaceReadOptions {
  /** 1-based 起始行，默认 1 */
  offset?: number;
  /** 最多返回行数；默认 DEFAULT_MAX_READ_LINES */
  limit?: number;
  maxChars?: number;
}

export interface WorkspaceReadResult {
  path: string;
  content: string;
  source: "tab" | "disk";
  truncated: boolean;
  totalLines: number;
  startLine: number;
  endLine: number;
}

/**
 * AI 工具访问工作区的唯一出口。
 * 实现由应用层注入 FS / 打开标签快照，工具层禁止直接调用 Tauri。
 */
export interface WorkspaceBridge {
  readonly workspaceRoot: string | null;
  readonly openTabs: OpenTabSnapshot[];
  listDir(path?: string): Promise<WorkspaceDirEntry[]>;
  readFile(
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult>;
}

export interface WorkspaceFsEntry {
  name: string;
  isDirectory: boolean;
  isFile?: boolean;
  isSymlink?: boolean;
}

export interface WorkspaceBridgeDeps {
  workspaceRoot: string | null;
  openTabs: OpenTabSnapshot[];
  readDir: (path: string) => Promise<WorkspaceFsEntry[]>;
  readTextFile: (path: string) => Promise<string>;
  /** 拼接子路径，返回可交给 FS 的原生路径 */
  joinPath: (base: string, name: string) => Promise<string>;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase();
}

/** portable（正斜杠）→ 尽量贴近原生分隔符，供 plugin-fs 使用。 */
export function toFsPath(portablePath: string): string {
  const normalized = normalizePath(portablePath);
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return normalized.replace(/\//g, "\\");
  }
  return normalized;
}

function findOpenTab(
  openTabs: OpenTabSnapshot[],
  portablePath: string,
): OpenTabSnapshot | null {
  return (
    openTabs.find(
      (tab) => tab.path !== null && pathsEqual(tab.path, portablePath),
    ) ?? null
  );
}

function sliceLines(
  content: string,
  offset: number,
  limit: number,
  maxChars: number,
): Omit<WorkspaceReadResult, "path" | "source"> {
  const lines = content.split(/\r\n|\r|\n/);
  const totalLines = lines.length;
  const start = Math.max(1, Math.floor(offset));
  const maxLines = Math.max(1, Math.floor(limit));
  const from = Math.min(start, totalLines + 1);
  const slice = lines.slice(from - 1, from - 1 + maxLines);
  let text = slice.join("\n");
  let truncated = from - 1 + slice.length < totalLines || start > totalLines;

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n\n…（已截断，超过 ${maxChars} 字符上限）`;
    truncated = true;
  } else if (truncated) {
    text = `${text}\n\n…（已截断，全文共 ${totalLines} 行，本次 L${from}–L${from - 1 + slice.length}）`;
  }

  return {
    content: text,
    truncated,
    totalLines,
    startLine: slice.length === 0 ? from : from,
    endLine: slice.length === 0 ? from - 1 : from - 1 + slice.length,
  };
}

/**
 * 基于注入的 FS 回调与打开标签，创建 WorkspaceBridge。
 * App / hook 层持有真实状态，此处只做策略与优先读 tab。
 */
export function createWorkspaceBridge(
  deps: WorkspaceBridgeDeps,
): WorkspaceBridge {
  return {
    get workspaceRoot() {
      return deps.workspaceRoot;
    },

    get openTabs() {
      return deps.openTabs;
    },

    async listDir(rawPath = ".") {
      const portable = resolveWorkspacePath(deps.workspaceRoot, rawPath);
      const fsPath = toFsPath(portable);
      let entries: WorkspaceFsEntry[];
      try {
        entries = await deps.readDir(fsPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PathPolicyError(
          "invalid-path",
          `无法列出目录：${message}`,
        );
      }

      const result: WorkspaceDirEntry[] = [];
      for (const entry of entries) {
        if (result.length >= DEFAULT_MAX_DIR_ENTRIES) {
          break;
        }
        const isDirectory = Boolean(entry.isDirectory);
        const isFile =
          Boolean(entry.isFile) ||
          (!isDirectory && !entry.isSymlink);

        if (isDirectory) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
            continue;
          }
        } else if (!isFile || !isTextExtensionAllowed(entry.name)) {
          continue;
        }

        const childNative = await deps.joinPath(fsPath, entry.name);
        const childPortable = assertInsideWorkspace(
          deps.workspaceRoot,
          childNative,
        );
        result.push({
          name: entry.name,
          path: childPortable,
          isDirectory,
        });
      }

      return result.sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      });
    },

    async readFile(rawPath, options = {}) {
      const portable = assertReadableTextPath(
        deps.workspaceRoot,
        resolveWorkspacePath(deps.workspaceRoot, rawPath),
      );
      const offset = options.offset ?? 1;
      const limit = options.limit ?? DEFAULT_MAX_READ_LINES;
      const maxChars = options.maxChars ?? DEFAULT_MAX_READ_CHARS;

      const tab = findOpenTab(deps.openTabs, portable);
      if (tab) {
        const sliced = sliceLines(tab.content, offset, limit, maxChars);
        return {
          path: portable,
          source: "tab",
          ...sliced,
        };
      }

      let diskContent: string;
      try {
        diskContent = await deps.readTextFile(toFsPath(portable));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PathPolicyError("invalid-path", `无法读取文件：${message}`);
      }

      const sliced = sliceLines(diskContent, offset, limit, maxChars);
      return {
        path: portable,
        source: "disk",
        ...sliced,
      };
    },
  };
}
