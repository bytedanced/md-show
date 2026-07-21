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
 * 在工作区内做大小写不敏感的全文搜索；复用 WorkspaceBridge.searchWorkspace。
 */
export const searchWorkspaceTool = defineTool({
  name: "search_workspace",
  description:
    "在工作区内全文搜索（大小写不敏感）。返回命中的文件路径、行号与行预览。用于回答「某主题在哪些文档」类问题；找到后再用 read_file 读取对应行。",
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键字，大小写不敏感；空串返回空结果。",
      },
      maxHitsPerFile: {
        type: "integer",
        description: "单个文件最多返回的命中行数，默认 10。",
        minimum: 1,
      },
      maxTotalHits: {
        type: "integer",
        description: "整体最多返回的命中条数，默认 80。",
        minimum: 1,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法搜索工作区。", false);
    }

    try {
      const record = asRecord(input);
      const query = readString(record, "query")?.trim();
      if (!query) {
        return toolErr("缺少 query 参数或为空。", true);
      }

      const result = await ctx.bridge.searchWorkspace({
        query,
        maxHitsPerFile: readPositiveInt(record, "maxHitsPerFile"),
        maxTotalHits: readPositiveInt(record, "maxTotalHits"),
      });

      const header = [
        `query: ${result.query}`,
        `hits: ${result.hits.length}${result.truncated ? "（已截断）" : ""}`,
      ].join("\n");

      if (result.hits.length === 0) {
        return toolOk(`${header}\n\n（无命中）`, {
          query: result.query,
          count: 0,
          truncated: false,
        });
      }

      const body = result.hits
        .map(
          (hit) =>
            `- ${hit.path}:${hit.line} (${hit.name})\n  ${hit.preview}`,
        )
        .join("\n");

      return toolOk(`${header}\n\n${body}`, {
        query: result.query,
        count: result.hits.length,
        truncated: result.truncated,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
