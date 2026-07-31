import { defineTool } from "./types";
import {
  asRecord,
  catchToolError,
  readString,
  toolErr,
  toolOk,
} from "./helpers";
import {
  resolveWorkspacePath,
} from "../safety/pathPolicy";
import type { FileChange } from "../types";

/**
 * 创建新的文本文件。
 * 路径可相对工作区根或绝对路径；允许任意扩展名；目标文件必须尚不存在。
 */
export const createFileTool = defineTool({
  name: "create_file",
  description:
    "创建新的文本文件（任意扩展名，如 md/txt/ts/json/html 等）。路径可相对工作区根或绝对路径；允许在工作区外创建；目标文件必须尚不存在。",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "新文件路径；相对工作区根或绝对路径。",
      },
      content: {
        type: "string",
        description: "新文件的文本内容。",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法创建文件。", false);
    }

    try {
      const record = asRecord(input);
      const rawPath = readString(record, "path")?.trim();
      if (!rawPath) {
        return toolErr("缺少 path 参数。", true);
      }
      const content = readString(record, "content") ?? "";

      // 路径解析：允许工作区外，允许任意扩展名
      const portable = resolveWorkspacePath(
        ctx.bridge.workspaceRoot,
        rawPath,
      );

      // 检查文件是否已存在
      let exists = false;
      try {
        await ctx.bridge.readFile(rawPath);
        exists = true;
      } catch {
        // 读取失败即文件不存在，可继续创建
      }
      if (exists) {
        return toolErr(
          `目标文件已存在：${portable}。请用 edit_file 修改已有文件。`,
          true,
        );
      }

      // 构造变更（before 为空，表示新建）
      const change: FileChange = {
        path: portable,
        before: "",
        after: content,
        source: "create_file",
      };

      if (ctx.queueFileChange) {
        await ctx.queueFileChange(change);
        return toolOk(`新建文件已加入待确认队列：${portable}`, {
          path: portable,
          source: "create_file",
        });
      }
      if (ctx.applyFileChange) {
        await ctx.applyFileChange(change);
        return toolOk(`已创建文件：${portable}`, {
          path: portable,
          source: "create_file",
        });
      }
      return toolErr("未注入写操作回调，无法创建文件。", false);
    } catch (error) {
      return catchToolError(error);
    }
  },
});
