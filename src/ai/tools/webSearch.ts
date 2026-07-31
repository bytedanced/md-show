import { invoke } from "@tauri-apps/api/core";
import { defineTool } from "./types";
import {
  asRecord,
  catchToolError,
  readPositiveInt,
  readString,
  toolErr,
  toolOk,
} from "./helpers";

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "使用 DuckDuckGo 搜索互联网。返回标题、URL 和摘要。需要联网获取最新信息、新闻、技术文档等时使用。搜索后可用 web_fetch 获取页面完整内容。",
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      maxResults: {
        type: "integer",
        description: "最多返回结果数，默认 10，最大 20",
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(input) {
    try {
      const record = asRecord(input);
      const query = readString(record, "query")?.trim();
      if (!query) {
        return toolErr("缺少 query 参数或为空。", true);
      }

      const maxResults = readPositiveInt(record, "maxResults");

      const results = await invoke<WebSearchHit[]>("web_search", {
        query,
        maxResults,
      });

      if (results.length === 0) {
        return toolOk(`搜索: ${query}\n\n（无结果）`, {
          query,
          count: 0,
        });
      }

      const body = results
        .map(
          (hit, idx) =>
            `${idx + 1}. ${hit.title}\n   URL: ${hit.url}\n   ${hit.snippet}`,
        )
        .join("\n\n");

      return toolOk(`搜索: ${query} (${results.length} 条结果)\n\n${body}`, {
        query,
        count: results.length,
        results,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
