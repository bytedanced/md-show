import { defineTool } from "./types";
import {
  asRecord,
  catchToolError,
  readString,
  toolErr,
  toolOk,
} from "./helpers";

/**
 * 列出工作区目录下的子目录与可读写文本文件。
 * 新增同类只读工具时：同目录新建文件 → 加入 builtins.ts 即可。
 */
export const listDirTool = defineTool({
  name: "list_dir",
  description:
    "列出某个目录的子项（目录 + 文件）。path 可相对工作区根或绝对路径；省略则列出工作区根。",
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "目录路径；相对工作区根或绝对路径。默认工作区根。",
      },
    },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    // 确保 WorkspaceBridge 已注入，否则无法访问文件系统
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法列出目录。", false);
    }

    try {
      // 解析输入参数，path 为空时默认当前工作区根目录
      const record = asRecord(input);
      const path = readString(record, "path")?.trim() || ".";
      // 调用 bridge 获取目录子项列表
      const entries = await ctx.bridge.listDir(path);
      // 将每个条目格式化为 [dir]/[file] 标记行
      const lines = entries.map((entry) => {
        const kind = entry.isDirectory ? "dir" : "file";
        return `- [${kind}] ${entry.name}\t${entry.path}`;
      });
      // path 为 "." 时用 workspaceRoot 替换，让输出更直观
      const header = `directory: ${path === "." ? ctx.bridge.workspaceRoot ?? "." : path}`;
      const body =
        lines.length > 0
          ? lines.join("\n")
          : "（空目录，或无可列文本文件）";
      return toolOk(`${header}\n${body}`, {
        count: entries.length,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
