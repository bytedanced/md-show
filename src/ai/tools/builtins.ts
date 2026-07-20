import { getTool, registerTool } from "./registry";
import type { ToolHandler } from "./types";
import { listDirTool } from "./listDir";
import { readFileTool } from "./readFile";

/**
 * 内置工具清单。新增工具：
 * 1. 在本目录新建 `fooBar.ts` 并 `defineTool`
 * 2. 加入下方数组
 * 3. 如需在某模式可用，更新 `agent/modes.ts` 白名单
 */
export const BUILTIN_TOOLS: readonly ToolHandler[] = [
  listDirTool,
  readFileTool,
  // search_workspace / edit_file / create_file — 后续追加
];

/** 幂等注册内置工具，可在 App 启动或面板挂载时调用。 */
export function ensureBuiltinToolsRegistered(): void {
  for (const tool of BUILTIN_TOOLS) {
    if (!getTool(tool.name)) {
      registerTool(tool);
    }
  }
}

export function listBuiltinToolNames(): string[] {
  return BUILTIN_TOOLS.map((tool) => tool.name);
}
