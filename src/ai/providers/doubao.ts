import type { AiProviderProfile } from "../settings";
import type {
  Message,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  UnifiedChatRequest,
} from "../types";
import {
  iterateSseDataPayloads,
  providerFetch,
  readErrorMessage,
} from "./httpTransport";
import type { ProviderAdapter, ProviderTestResult } from "./types";

/** 火山方舟 Ark Chat Completions 路径。 */
const DEFAULT_CHAT_PATH = "/chat/completions";

export function joinDoubaoApiUrl(baseUrl: string, chatPath?: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const rawPath = chatPath?.trim() || DEFAULT_CHAT_PATH;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  // 方舟 base 常见为 .../api/v3，避免重复拼接 /v3
  if (normalizedBase.endsWith("/v3") && path.startsWith("/v3/")) {
    return `${normalizedBase}${path.slice(3)}`;
  }
  return `${normalizedBase}${path}`;
}

function toDoubaoMessage(message: Message): Record<string, unknown> {
  if (message.role === "user" && message.images?.length) {
    const content: Record<string, unknown>[] = message.images.map((img) => ({
      type: "image_url",
      image_url: { url: img },
    }));
    if (message.content.trim()) {
      content.push({ type: "text", text: message.content });
    }
    return { role: "user", content };
  }

  const payload: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };

  if (message.role === "assistant" && message.toolCalls?.length) {
    payload.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments,
      },
    }));
  }

  if (message.role === "assistant" && message.reasoningContent) {
    payload.reasoning_content = message.reasoningContent;
  }

  if (message.role === "tool") {
    payload.tool_call_id = message.toolCallId;
    if (message.name) {
      payload.name = message.name;
    }
  }

  return payload;
}

function toDoubaoTools(
  tools: ToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * 火山引擎豆包（方舟）请求体。
 * model 字段通常填写接入点（endpoint）ID，例如 ep-xxxxxxxx。
 */
export function buildDoubaoChatBody(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model || profile.models[0],
    messages: request.messages.map(toDoubaoMessage),
    stream: request.stream ?? true,
  };

  const temperature = request.temperature ?? profile.temperature;
  if (typeof temperature === "number") {
    body.temperature = temperature;
  }

  const maxTokens = request.maxTokens ?? profile.maxTokens;
  if (typeof maxTokens === "number") {
    body.max_tokens = maxTokens;
  }

  const tools = toDoubaoTools(request.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = request.toolChoice ?? "auto";
  }

  if (request.thinking) {
    body.thinking = { type: request.thinking };
  }

  if (request.reasoningEffort) {
    body.reasoning_effort = request.reasoningEffort;
  }

  return body;
}

export function buildDoubaoChatHeaders(
  profile: AiProviderProfile,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(profile.headers ?? {}),
  };
  if (profile.apiKey.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
  }
  return headers;
}

function parseDoubaoSsePayload(
  payload: string,
  toolCalls: Map<number, ToolCall>,
): StreamChunk[] {
  let json: {
    choices?: Array<{
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    error?: { message?: string };
  };

  try {
    json = JSON.parse(payload) as typeof json;
  } catch {
    return [];
  }

  if (json.error?.message) {
    return [{ type: "error", error: json.error.message }];
  }

  const chunks: StreamChunk[] = [];
  const choice = json.choices?.[0];
  const delta = choice?.delta;
  if (delta?.reasoning_content) {
    chunks.push({ type: "thinking-delta", text: delta.reasoning_content });
  }
  if (delta?.content) {
    chunks.push({ type: "text-delta", text: delta.content });
  }

  for (const toolDelta of delta?.tool_calls ?? []) {
    const index = toolDelta.index ?? 0;
    const current = toolCalls.get(index) ?? {
      id: toolDelta.id ?? `call_${index}`,
      name: "",
      arguments: "",
    };
    if (toolDelta.id) {
      current.id = toolDelta.id;
    }
    if (toolDelta.function?.name) {
      current.name += toolDelta.function.name;
    }
    if (toolDelta.function?.arguments) {
      current.arguments += toolDelta.function.arguments;
    }
    toolCalls.set(index, current);
    chunks.push({
      type: "tool-call",
      id: current.id,
      name: current.name,
      arguments: current.arguments,
    });
  }

  return chunks;
}

async function* streamDoubaoChat(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  if (!profile.baseUrl.trim()) {
    yield { type: "error", error: "请先填写火山方舟 Base URL。" };
    return;
  }
  if (!profile.models[0]?.trim() && !request.model.trim()) {
    yield { type: "error", error: "模型名称应填写接入点 ID。" };
    return;
  }
  if (!profile.apiKey.trim()) {
    yield { type: "error", error: "请先填写火山方舟 API Key。" };
    return;
  }

  const url = joinDoubaoApiUrl(profile.baseUrl, profile.chatPath);
  const body = buildDoubaoChatBody(profile, { ...request, stream: true });

  let response: Response;
  try {
    response = await providerFetch(url, {
      method: "POST",
      headers: buildDoubaoChatHeaders(profile),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      yield { type: "error", error: "已取消生成" };
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    yield {
      type: "error",
      error: `网络请求失败：${message}（若为 CORS，请改用本地代理或后续 Tauri HTTP）`,
    };
    return;
  }

  if (!response.ok) {
    yield { type: "error", error: await readErrorMessage(response) };
    return;
  }

  const toolCalls = new Map<number, ToolCall>();
  try {
    for await (const payload of iterateSseDataPayloads(response, signal)) {
      for (const chunk of parseDoubaoSsePayload(payload, toolCalls)) {
        yield chunk;
        if (chunk.type === "error") {
          return;
        }
      }
    }
    yield { type: "message-stop" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      yield { type: "error", error: "已取消生成" };
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", error: message };
  }
}

async function testDoubaoConnection(
  profile: AiProviderProfile,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.models[0]?.trim()) {
    return {
      ok: false,
      message: "请填写 Base URL、API Key 与接入点 ID（模型名称）。",
    };
  }

  const url = joinDoubaoApiUrl(profile.baseUrl, profile.chatPath);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await providerFetch(url, {
      method: "POST",
      headers: buildDoubaoChatHeaders(profile),
      body: JSON.stringify({
        model: profile.models[0],
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, message: await readErrorMessage(response) };
    }
    return { ok: true, message: "连接成功。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `连接失败：${message}` };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export const doubaoAdapter: ProviderAdapter = {
  id: "doubao",
  label: "火山豆包",
  capabilities: {
    stream: true,
    tools: true,
  },
  defaults: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    chatPath: DEFAULT_CHAT_PATH,
    hint: "模型名称填写方舟接入点 ID（ep-xxxxxxxx）",
  },
  chat: streamDoubaoChat,
  testConnection: testDoubaoConnection,
};
