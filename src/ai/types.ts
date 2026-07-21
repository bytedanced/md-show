/** AI 运行模式：Chat 为无工具 Agent 的特例。 */
export type AiMode = "chat" | "agent-ask" | "agent-edit";

/**
 * 每个供应商对应独立 Adapter 实现，互不复用请求拼装代码，便于后续协议分叉。
 * 新增厂商时：加 id → 新建 providers/<id>.ts → 注册到 registry → 补模板。
 */
export type ProviderAdapterId =
  | "openai"
  | "openai-sdk"
  | "deepseek"
  | "chatglm"
  | "doubao"
  | "doubao-sdk"
  | "ollama"
  | "custom"
  | "anthropic";

export const PROVIDER_ADAPTER_IDS: readonly ProviderAdapterId[] = [
  "openai",
  "openai-sdk",
  "deepseek",
  "chatglm",
  "doubao",
  "doubao-sdk",
  "ollama",
  "custom",
  "anthropic",
] as const;

export type ConfirmPolicy = "always" | "session" | "auto";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  /** assistant 发起的工具调用 */
  toolCalls?: ToolCall[];
  /** tool 消息回指的 call id */
  toolCallId?: string;
  name?: string;
  /** 用户上传的图片（base64 data URL），仅 user 消息支持 */
  images?: string[];
  /** 思考/推理内容，assistant 消息回传时必须附带（DeepSeek 等要求） */
  reasoningContent?: string;
}

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** 是否会修改工作区文件 */
  mutates: boolean;
}

export type ToolChoice = "auto" | "none" | "required";

export type ThinkingMode = "enabled" | "disabled" | "auto";
export type ReasoningEffort = "low" | "medium" | "high" | "max";

export interface UnifiedChatRequest {
  messages: Message[];
  model: string;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
}

export type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: string }
  | { type: "message-stop" }
  | { type: "error"; error: string };

export type ToolResult =
  | { ok: true; content: string; meta?: Record<string, unknown> }
  | { ok: false; error: string; retryable?: boolean };

export interface FileChange {
  path: string;
  before: string;
  after: string;
  source: "edit_file" | "create_file";
}

export interface OpenTabSnapshot {
  path: string | null;
  content: string;
  dirty: boolean;
}

export interface DocumentContextInput {
  path: string | null;
  content: string;
  selection?: string;
  outline?: string[];
  /** 用户通过 Ctrl+L 显式加入的上下文片段（优先于自动全文）。 */
  snippets?: ContextSnippet[];
  /** 无 snippets 时是否自动附带当前文档全文；默认 true。 */
  includeActiveDocument?: boolean;
}

/** 显式加入 AI 对话的文档片段。 */
export interface ContextSnippet {
  id: string;
  path: string | null;
  /** 1-based 起始行 */
  startLine: number;
  /** 1-based 结束行（含） */
  endLine: number;
  text: string;
}

export function createSnippetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `snip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createProfileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
