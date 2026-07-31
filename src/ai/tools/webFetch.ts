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

interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  truncated: boolean;
}

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "抓取指定 URL 的网页内容，提取正文文本（自动去除导航、广告等无关内容）。web_search 找到相关链接后，用此工具获取完整内容。支持 HTML 和纯文本页面。",
  mutates: false,
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "要抓取的网页 URL（必须以 http:// 或 https:// 开头）",
      },
      maxChars: {
        type: "integer",
        description: "最多返回字符数，默认 50000，最大 500000",
        minimum: 1000,
        maximum: 500000,
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(input) {
    try {
      const record = asRecord(input);
      const url = readString(record, "url")?.trim();
      if (!url) {
        return toolErr("缺少 url 参数或为空。", true);
      }
      if (!/^https?:\/\//i.test(url)) {
        return toolErr("url 必须以 http:// 或 https:// 开头。", true);
      }

      const maxChars = readPositiveInt(record, "maxChars");

      const result = await invoke<WebFetchResult>("web_fetch", {
        url,
        maxChars,
      });

      const header = [
        `标题: ${result.title || "（无标题）"}`,
        `URL: ${result.url}`,
        result.truncated ? "状态: 内容已截断" : "",
      ]
        .filter(Boolean)
        .join("\n");

      return toolOk(`${header}\n\n---\n\n${result.content}`, {
        url: result.url,
        title: result.title,
        truncated: result.truncated,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
