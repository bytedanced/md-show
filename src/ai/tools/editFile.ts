import { defineTool } from "./types";
import {
  asRecord,
  catchToolError,
  readBool,
  readString,
  toolErr,
  toolOk,
} from "./helpers";
import type { FileChange } from "../types";

/**
 * 编辑工作区内文本文件：查找 old_string 并替换为 new_string。
 * 要求 old_string 在文件中唯一匹配（或启用 replace_all 替换全部）。
 */
export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "精准编辑工作区内的文本文件。提供 path（目标文件）、old_string（要替换的原文本）、new_string（替换后的新文本）。old_string 在文件中必须唯一出现一次；如需替换全部匹配项，设置 replace_all 为 true。",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "文件路径；相对工作区根或绝对路径。",
      },
      old_string: {
        type: "string",
        description: "要被替换的原文本片段，必须在文件中唯一匹配（或配合 replace_all）。",
      },
      new_string: {
        type: "string",
        description: "替换后的新文本。与原串一致则无变化。",
      },
      replace_all: {
        type: "boolean",
        description: "是否替换所有匹配项，默认 false（仅替换唯一匹配）。",
      },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.bridge) {
      return toolErr("未注入 WorkspaceBridge，无法编辑文件。", false);
    }

    try {
      const record = asRecord(input);
      const path = readString(record, "path")?.trim();
      if (!path) {
        return toolErr("缺少 path 参数。", true);
      }
      const oldStr = readString(record, "old_string") ?? "";
      const newStr = readString(record, "new_string") ?? "";
      const replaceAll = readBool(record, "replace_all") === true;

      // 读取当前文件内容
      const result = await ctx.bridge.readFile(path, { maxChars: Infinity });
      const current = result.content;

      // 统计 old_string 在文件中的出现次数
      const occurrences = countOccurrences(current, oldStr);
      if (occurrences === 0) {
        return toolErr(
          `未在文件中找到 old_string。请确认内容与文件中的原文完全一致（含缩进/空行）。文件：${path}`,
          true,
        );
      }
      if (occurrences > 1 && !replaceAll) {
        return toolErr(
          `old_string 在文件中出现了 ${occurrences} 次，无法唯一定位。请提供更多上下文使匹配唯一，或设置 replace_all=true。`,
          true,
        );
      }

      const after = replaceAll
        ? current.split(oldStr).join(newStr)
        : current.replace(oldStr, newStr);

      // 构造变更并提交
      const change: FileChange = {
        path: result.path,
        before: current,
        after,
        source: "edit_file",
      };

      return await submitFileChange(ctx, change, path);
    } catch (error) {
      return catchToolError(error);
    }
  },
});

/** 统计子串在文本中的出现次数（重叠不计）。 */
function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/** 提交 FileChange：优先加入待确认队列，其次直接应用。 */
async function submitFileChange(
  ctx: { queueFileChange?: (c: FileChange) => Promise<void>; applyFileChange?: (c: FileChange) => Promise<void> },
  change: FileChange,
  path: string,
) {
  if (ctx.queueFileChange) {
    await ctx.queueFileChange(change);
    return toolOk(`变更已加入待确认队列：${path}`, {
      path,
      source: "edit_file",
    });
  }
  if (ctx.applyFileChange) {
    await ctx.applyFileChange(change);
    return toolOk(`已应用变更：${path}`, {
      path,
      source: "edit_file",
    });
  }
  return toolErr("未注入写操作回调，无法编辑文件。", false);
}
