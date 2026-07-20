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
    "列出工作区内某个目录的子项（目录 + 文本文件）。path 可相对工作区根或绝对路径；省略则列出工作区根。",
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
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法列出目录。", false);
    }

    try {
      const record = asRecord(input);
      const path = readString(record, "path")?.trim() || ".";
      const entries = await ctx.bridge.listDir(path);
      const lines = entries.map((entry) => {
        const kind = entry.isDirectory ? "dir" : "file";
        return `- [${kind}] ${entry.name}\t${entry.path}`;
      });
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
