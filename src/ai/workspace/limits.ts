/** 单文件读取字节上限（UTF-16 code units，约等于字符数）。 */
export const DEFAULT_MAX_READ_CHARS = 120_000;

/** 单次 read_file 默认最大行数（未指定 limit 时）。 */
export const DEFAULT_MAX_READ_LINES = 2_000;

/** list_dir 单次最多返回的条目数。 */
export const DEFAULT_MAX_DIR_ENTRIES = 500;

/** search_workspace 单文件最多返回的命中行数。 */
export const DEFAULT_MAX_SEARCH_HITS_PER_FILE = 10;

/** search_workspace 整体最多返回的命中条数。 */
export const DEFAULT_MAX_SEARCH_TOTAL_HITS = 80;

/** Agent 列表时忽略的目录名（与文件树策略对齐）。 */
export const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "dist",
  "node_modules",
  "src-tauri",
  "target",
  ".cursor",
  ".vscode",
]);
