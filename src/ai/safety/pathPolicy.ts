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

export function isTextExtensionAllowed(path: string): boolean {
  const extension = getExtension(path);
  return (TEXT_EXTENSION_WHITELIST as readonly string[]).includes(extension);
}

/**
 * 将相对 / 绝对路径解析为工作区内的 portable 绝对路径。
 * 相对路径相对于 workspaceRoot；禁止 `..` 逃逸出工作区。
 */
export function resolveWorkspacePath(
  workspaceRoot: string | null,
  targetPath: string,
): string {
  if (!workspaceRoot?.trim()) {
    throw new PathPolicyError(
      "no-workspace",
      "未打开工作区，无法访问工作区文件。",
    );
  }

  const root = normalizePath(workspaceRoot).replace(/\/+$/, "");
  const trimmed = targetPath.trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return assertInsideWorkspace(workspaceRoot, root);
  }

  const candidate = isAbsolutePath(trimmed)
    ? normalizePath(trimmed)
    : normalizePath(`${root}/${trimmed}`);

  return assertInsideWorkspace(workspaceRoot, candidate);
}

/**
 * 校验目标路径是否位于工作区内。
 * Windows 盘符路径比较前统一小写。
 */
export function assertInsideWorkspace(
  workspaceRoot: string | null,
  targetPath: string,
): string {
  if (!workspaceRoot?.trim()) {
    throw new PathPolicyError(
      "no-workspace",
      "未打开工作区，无法访问工作区文件。",
    );
  }

  const root = normalizePath(workspaceRoot).replace(/\/+$/, "");
  const target = normalizePath(targetPath);
  const rootKey = root.toLowerCase();
  const targetKey = target.toLowerCase();

  if (targetKey !== rootKey && !targetKey.startsWith(`${rootKey}/`)) {
    throw new PathPolicyError(
      "outside-workspace",
      "路径超出当前工作区范围。",
    );
  }

  return target;
}

export function assertReadableTextPath(
  workspaceRoot: string | null,
  targetPath: string,
): string {
  const safePath = assertInsideWorkspace(workspaceRoot, targetPath);
  if (!isTextExtensionAllowed(safePath)) {
    throw new PathPolicyError(
      "extension-denied",
      `不允许访问该类型文件：${getExtension(safePath) || "(无扩展名)"}`,
    );
  }
  return safePath;
}
