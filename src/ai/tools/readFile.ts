import { defineTool } from "./types";
import {
  asRecord,
  catchToolError,
  readPositiveInt,
  readString,
  toolErr,
  toolOk,
} from "./helpers";

/**
 * 读取工作区内文本文件；已打开标签优先返回未保存内容。
 */
export const readFileTool = defineTool({
  name: "read_file",
  description:
    "读取工作区内的文本文件（md/txt 等）。若文件已在编辑器打开，优先返回标签页内容（含未保存修改）。可用 offset/limit 按行分段读取。",
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "文件路径；相对工作区根或绝对路径。",
      },
      offset: {
        type: "integer",
        description: "起始行号（1-based），默认 1。",
        minimum: 1,
      },
      limit: {
        type: "integer",
        description: "最多读取行数。",
        minimum: 1,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法读取文件。", false);
    }

    try {
      const record = asRecord(input);
      const path = readString(record, "path")?.trim();
      if (!path) {
        return toolErr("缺少 path 参数。", true);
      }

      const result = await ctx.bridge.readFile(path, {
        offset: readPositiveInt(record, "offset"),
        limit: readPositiveInt(record, "limit"),
      });

      const header = [
        `path: ${result.path}`,
        `source: ${result.source}`,
        `lines: ${result.startLine}-${result.endLine} / ${result.totalLines}`,
        result.truncated ? "truncated: true" : "truncated: false",
      ].join("\n");

      return toolOk(`${header}\n\n${result.content}`, {
        path: result.path,
        source: result.source,
        truncated: result.truncated,
        totalLines: result.totalLines,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
