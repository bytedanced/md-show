import {
  createMessageId,
  type ContextSnippet,
  type DocumentContextInput,
  type Message,
} from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "你是墨览 Markdown 写作助手。优先输出可直接粘贴的 Markdown。除非用户要求，不要解释过程。";

/** 无选区时附带全文的最大字符数，超出则截断并提示。 */
export const DEFAULT_CONTENT_CHAR_LIMIT = 50_000;

/** 多片段合计最大字符数。 */
export const DEFAULT_SNIPPETS_CHAR_LIMIT = 50_000;

export interface BuildContextOptions {
  document: DocumentContextInput;
  systemPrompt?: string;
  contentCharLimit?: number;
  snippetsCharLimit?: number;
}

export interface BuiltContext {
  systemMessage: Message;
  contextMessage: Message | null;
  truncated: boolean;
}

function truncateContent(
  content: string,
  limit: number,
): { text: string; truncated: boolean } {
  if (content.length <= limit) {
    return { text: content, truncated: false };
  }
  return {
    text: `${content.slice(0, limit)}\n\n…（已截断，原文共 ${content.length} 字符）`,
    truncated: true,
  };
}

function fileLabel(path: string | null): string {
  if (!path) {
    return "未命名文档";
  }
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function formatSnippetBlock(snippet: ContextSnippet): string {
  const lines =
    snippet.startLine === snippet.endLine
      ? `L${snippet.startLine}`
      : `L${snippet.startLine}-L${snippet.endLine}`;
  const pathLine = snippet.path
    ? `文件：${snippet.path}（${lines}）`
    : `文件：未保存文档（${lines}）`;
  return `${pathLine}\n\`\`\`\n${snippet.text}\n\`\`\``;
}

function formatSnippets(
  snippets: ContextSnippet[],
  limit: number,
): { text: string; truncated: boolean } {
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;

  for (let index = 0; index < snippets.length; index += 1) {
    const snippet = snippets[index];
    const block = formatSnippetBlock(snippet);
    const separator = blocks.length > 0 ? "\n\n" : "";
    const nextUsed = used + separator.length + block.length;
    if (nextUsed > limit && blocks.length > 0) {
      truncated = true;
      blocks.push(
        `…（其余 ${snippets.length - index} 个片段未附带，已达长度上限）`,
      );
      break;
    }
    if (block.length > limit && blocks.length === 0) {
      const sliced = truncateContent(snippet.text, Math.max(limit - 80, 0));
      truncated = true;
      blocks.push(
        formatSnippetBlock({ ...snippet, text: sliced.text }),
      );
      break;
    }
    blocks.push(block);
    used = nextUsed;
    if (used >= limit) {
      truncated = truncated || index < snippets.length - 1;
      break;
    }
  }

  return {
    text: `用户附带的上下文片段（共 ${snippets.length} 个）：\n\n${blocks.join("\n\n")}`,
    truncated,
  };
}

/**
 * 将当前文档 / 显式片段拼成 system + context 消息。
 * 优先使用 snippets；否则在 includeActiveDocument !== false 时附带全文或旧版 selection。
 */
export function buildDocumentContext(
  options: BuildContextOptions,
): BuiltContext {
  const {
    document,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    contentCharLimit = DEFAULT_CONTENT_CHAR_LIMIT,
    snippetsCharLimit = DEFAULT_SNIPPETS_CHAR_LIMIT,
  } = options;

  const systemMessage: Message = {
    id: createMessageId(),
    role: "system",
    content: systemPrompt,
  };

  const snippets = (document.snippets ?? []).filter((item) =>
    item.text.trim(),
  );
  const includeActiveDocument = document.includeActiveDocument !== false;

  const parts: string[] = [];
  let truncated = false;

  if (snippets.length > 0) {
    if (document.path) {
      parts.push(`当前打开文档：${document.path}`);
    }
    if (document.outline?.length) {
      parts.push(
        `当前文档大纲：\n${document.outline.map((item) => `- ${item}`).join("\n")}`,
      );
    }
    const packed = formatSnippets(snippets, snippetsCharLimit);
    truncated = packed.truncated;
    parts.push(packed.text);
  } else if (includeActiveDocument) {
    if (document.path) {
      parts.push(`当前文档路径：${document.path}`);
    } else {
      parts.push("当前文档：未保存的新建文档");
    }

    if (document.outline?.length) {
      parts.push(
        `文档大纲：\n${document.outline.map((item) => `- ${item}`).join("\n")}`,
      );
    }

    const selection = document.selection?.trim();
    if (selection) {
      parts.push(`用户选中内容：\n\`\`\`\n${selection}\n\`\`\``);
    } else if (document.content.trim()) {
      const result = truncateContent(document.content, contentCharLimit);
      truncated = result.truncated;
      parts.push(`文档全文：\n\`\`\`markdown\n${result.text}\n\`\`\``);
    }
  }

  if (parts.length === 0) {
    return { systemMessage, contextMessage: null, truncated: false };
  }

  return {
    systemMessage,
    contextMessage: {
      id: createMessageId(),
      role: "system",
      content: parts.join("\n\n"),
    },
    truncated,
  };
}

export function composeRequestMessages(options: {
  document: DocumentContextInput;
  history: Message[];
  userText: string;
  systemPrompt?: string;
}): Message[] {
  const { systemMessage, contextMessage } = buildDocumentContext({
    document: options.document,
    systemPrompt: options.systemPrompt,
  });

  const messages: Message[] = [systemMessage];
  if (contextMessage) {
    messages.push(contextMessage);
  }
  for (const message of options.history) {
    if (message.role === "system") {
      continue;
    }
    messages.push(message);
  }
  messages.push({
    id: createMessageId(),
    role: "user",
    content: options.userText,
  });
  return messages;
}

export function snippetDisplayName(snippet: ContextSnippet): string {
  return fileLabel(snippet.path);
}

export function snippetRangeLabel(snippet: ContextSnippet): string {
  if (snippet.startLine === snippet.endLine) {
    return `L${snippet.startLine}`;
  }
  return `L${snippet.startLine}-${snippet.endLine}`;
}

/** 相同路径与行号范围视为重复。 */
export function isDuplicateSnippet(
  existing: ContextSnippet[],
  candidate: Pick<ContextSnippet, "path" | "startLine" | "endLine" | "text">,
): boolean {
  return existing.some(
    (item) =>
      item.path === candidate.path &&
      item.startLine === candidate.startLine &&
      item.endLine === candidate.endLine &&
      item.text === candidate.text,
  );
}
