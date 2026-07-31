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
  DEFAULT_MAX_SEARCH_HITS_PER_FILE,
  DEFAULT_MAX_SEARCH_TOTAL_HITS,
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

export interface WorkspaceSearchHit {
  /** 1-based 行号 */
  line: number;
  name: string;
  /** 工作区内 portable 路径（正斜杠） */
  path: string;
  preview: string;
}

export interface WorkspaceSearchOptions {
  /** 大小写不敏感的关键字；空串返回空数组 */
  query: string;
  /** 单文件最多返回的命中行数；默认 10 */
  maxHitsPerFile?: number;
  /** 整体最多返回的命中条数；默认 80 */
  maxTotalHits?: number;
}

export interface WorkspaceSearchResultDto {
  query: string;
  hits: WorkspaceSearchHit[];
  truncated: boolean;
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
  searchWorkspace(
    options: WorkspaceSearchOptions,
  ): Promise<WorkspaceSearchResultDto>;
  /** 将文本写入工作区内的文件（会校验路径安全性）。 */
  writeFile(path: string, content: string): Promise<void>;
}

export interface WorkspaceFsEntry {
  name: string;
  isDirectory: boolean;
  isFile?: boolean;
  isSymlink?: boolean;
}

/** 创建 WorkspaceBridge 所需的依赖注入，由应用层提供真实的 FS 与标签页状态。 */
export interface WorkspaceBridgeDeps {
  workspaceRoot: string | null;
  openTabs: OpenTabSnapshot[];
  readDir: (path: string) => Promise<WorkspaceFsEntry[]>;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  /** 拼接子路径，返回可交给 FS 的原生路径 */
  joinPath: (base: string, name: string) => Promise<string>;
  /**
   * 在工作区内做大小写不敏感的全文搜索。
   * 应用层复用 useWorkspaceManager 的 searchWorkspace（已处理工作区扫描）。
   */
  search: (query: string) => Promise<WorkspaceSearchHit[]>;
  /** 可选：写文件后同步更新对应标签页内容，避免标签页缓存覆写磁盘。 */
  updateTabContent?: (path: string, content: string) => void;
}

/** 大小写不敏感地比较两个路径是否指向同一文件。 */
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

/** 在已打开标签页列表中查找匹配指定路径的标签（大小写不敏感）。 */
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

/** 按行切片读取：从 offset 行起取 limit 行，超出 maxChars 字符则截断。 */
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

    async searchWorkspace(options) {
      const query = options.query.trim();
      if (!query) {
        return { query: "", hits: [], truncated: false };
      }
      if (!deps.workspaceRoot?.trim()) {
        throw new PathPolicyError(
          "no-workspace",
          "未打开工作区，无法搜索。",
        );
      }

      const maxPerFile =
        options.maxHitsPerFile ?? DEFAULT_MAX_SEARCH_HITS_PER_FILE;
      const maxTotal =
        options.maxTotalHits ?? DEFAULT_MAX_SEARCH_TOTAL_HITS;

      let raw: WorkspaceSearchHit[];
      try {
        raw = await deps.search(query);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PathPolicyError("invalid-path", `搜索失败：${message}`);
      }

      const grouped = new Map<string, WorkspaceSearchHit[]>();
      const order: string[] = [];
      for (const hit of raw) {
        let bucket = grouped.get(hit.path);
        if (!bucket) {
          bucket = [];
          grouped.set(hit.path, bucket);
          order.push(hit.path);
        }
        if (bucket.length < maxPerFile) {
          bucket.push(hit);
        }
      }

      const hits: WorkspaceSearchHit[] = [];
      let truncated = false;
      for (const path of order) {
        const bucket = grouped.get(path);
        if (!bucket) continue;
        for (const hit of bucket) {
          if (hits.length >= maxTotal) {
            truncated = true;
            break;
          }
          hits.push(hit);
        }
        if (truncated) break;
      }

      const bucketTruncated = raw.length > 0 && hits.length < raw.length;
      return { query, hits, truncated: truncated || bucketTruncated };
    },

    async writeFile(rawPath, content) {
      const portable = assertReadableTextPath(
        deps.workspaceRoot,
        resolveWorkspacePath(deps.workspaceRoot, rawPath),
      );
      await deps.writeTextFile(toFsPath(portable), content);
      deps.updateTabContent?.(portable, content);
    },
  };
}
