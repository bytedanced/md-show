/** 允许 Agent 读写的文本扩展名（不含点）。 */
export const TEXT_EXTENSION_WHITELIST = [
  "md",
  "markdown",
  "txt",
  "mdx",
] as const;

export type PathPolicyErrorCode =
  | "no-workspace"
  | "outside-workspace"
  | "extension-denied"
  | "invalid-path";

export class PathPolicyError extends Error {
  readonly code: PathPolicyErrorCode;

  constructor(code: PathPolicyErrorCode, message: string) {
    super(message);
    this.name = "PathPolicyError";
    this.code = code;
  }
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 是否为绝对路径（POSIX / Windows 盘符 / UNC）。 */
export function isAbsolutePath(path: string): boolean {
  const trimmed = normalizeSlashes(path.trim());
  return (
    /^[a-zA-Z]:/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("//")
  );
}

/**
 * 去掉 `.` / `..` 段的规范化。
 * 相对路径保持相对；绝对路径保留盘符 / 根前缀。
 */
export function normalizePath(path: string): string {
  const trimmed = normalizeSlashes(path.trim());
  if (!trimmed) {
    throw new PathPolicyError("invalid-path", "路径为空。");
  }

  const windowsDrive = /^[a-zA-Z]:/.exec(trimmed)?.[0];
  const isUnc = trimmed.startsWith("//");
  const isUnixAbsolute = trimmed.startsWith("/");
  const raw = trimmed.replace(/^[a-zA-Z]:/, "").replace(/^\/+/, "");
  const segments = raw.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        throw new PathPolicyError("invalid-path", "路径非法：越界到根目录之上。");
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  const joined = resolved.join("/");
  if (windowsDrive) {
    return joined ? `${windowsDrive}/${joined}` : windowsDrive;
  }
  if (isUnc) {
    return `//${joined}`;
  }
  if (isUnixAbsolute) {
    return `/${joined}`;
  }
  return joined;
}

export function getExtension(path: string): string {
  const base = normalizeSlashes(path).split("/").pop() ?? "";
  const index = base.lastIndexOf(".");
  if (index <= 0) {
    return "";
  }
  return base.slice(index + 1).toLowerCase();
}

/**
 * 扩展名校验已放开：始终返回 true。
 * @deprecated 不再有扩展名限制。
 */
export function isTextExtensionAllowed(_path: string): boolean {
  return true;
}

/**
 * 将相对 / 绝对路径解析为 portable 路径。
 * - 绝对路径：直接规范化。
 * - 相对路径：若有 workspaceRoot 则相对其解析；否则保留相对路径。
 * - 不再限制工作区边界，允许访问工作区外文件。
 */
export function resolveWorkspacePath(
  workspaceRoot: string | null,
  targetPath: string,
): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new PathPolicyError("invalid-path", "路径为空。");
  }

  if (isAbsolutePath(trimmed)) {
    return normalizePath(trimmed);
  }

  if (trimmed === "." || trimmed === "./") {
    return workspaceRoot?.trim()
      ? normalizePath(workspaceRoot).replace(/\/+$/, "")
      : ".";
  }

  return workspaceRoot?.trim()
    ? normalizePath(`${normalizePath(workspaceRoot)}/${trimmed}`)
    : normalizePath(trimmed);
}

/**
 * 不再校验工作区边界，仅规范化路径。
 * @deprecated 工作区边界限制已放开。
 */
export function assertInsideWorkspace(
  _workspaceRoot: string | null,
  targetPath: string,
): string {
  return normalizePath(targetPath);
}

/**
 * 解析路径且不校验扩展名（已放开限制）。
 */
export function assertReadableTextPath(
  workspaceRoot: string | null,
  targetPath: string,
): string {
  return resolveWorkspacePath(workspaceRoot, targetPath);
}
