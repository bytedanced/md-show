import {
  createMessageId,
  type ContextSnippet,
  type DocumentContextInput,
  type Message,
} from "./types";

export const DEFAULT_SYSTEM_PROMPT =
  "你是墨览 Markdown 写作助手";

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
    text: `用户当前选中的内容（共 ${snippets.length} 个）：\n\n${blocks.join("\n\n")}`,
    truncated,
  };
}

/**
 * 将当前文档 / 显式片段拼成 system + 用户上下文消息。
 * 不变的静态信息（工作区根目录、运行平台）并入首条 system 提示词；
 * 变化的信息（文档路径、大纲、选中内容/片段）以 user 角色、紧贴当前提问发送，
 * 避免被长对话稀释，也避开部分 OpenAI 兼容服务只认首条 system 的坑。
 * 优先使用 snippets（有选中时不再附带当前文档信息）；否则在 includeActiveDocument !== false 时附带全文或旧版 selection。
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

  // 静态信息并入系统提示词：cwd 默认值、可用 shell、平台语法差异，跨轮次不变。
  const systemParts: string[] = [systemPrompt];
  if (document.workspaceRoot) {
    systemParts.push(`工作区根目录：${document.workspaceRoot}`);
  }
  if (document.platform) {
    const shellHint =
      document.platform === "windows"
        ? "Windows（默认 shell: powershell，可用 cmd/bash 等切换）"
        : document.platform === "macos"
          ? "macOS（默认 shell: zsh）"
          : "Linux（默认 shell: bash）";
    systemParts.push(`运行平台：${shellHint}`);
  }
  const systemMessage: Message = {
    id: createMessageId(),
    role: "system",
    content: systemParts.join("\n\n"),
  };

  const snippets = (document.snippets ?? []).filter((item) =>
    item.text.trim(),
  );
  const includeActiveDocument = document.includeActiveDocument !== false;

  // 变化的信息进上下文消息，紧贴当前提问。
  const parts: string[] = [];
  let truncated = false;

  if (snippets.length > 0) {
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
      role: "user",
      content: `当前用户操作的背景信息：\n\n${parts.join("\n\n")}`,
    },
    truncated,
  };
}

export function composeRequestMessages(options: {
  document: DocumentContextInput;
  history: Message[];
  userText: string;
  systemPrompt?: string;
  images?: string[];
}): Message[] {
  const { systemMessage, contextMessage } = buildDocumentContext({
    document: options.document,
    systemPrompt: options.systemPrompt,
  });

  const messages: Message[] = [systemMessage];
  for (const message of options.history) {
    if (message.role === "system") {
      continue;
    }
    messages.push(message);
  }
  // 上下文紧贴当前提问，避免被长对话稀释；角色为 user，避开只认首条 system 的服务。
  if (contextMessage) {
    messages.push(contextMessage);
  }
  messages.push({
    id: createMessageId(),
    role: "user",
    content: options.userText,
    images: options.images,
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
