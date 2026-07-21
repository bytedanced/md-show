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

const DEFAULT_CHAT_PATH = "/chat/completions";

/** 拼接 Base URL 与 Chat Path，自动处理 /v1 路径重合。 */
export function joinDeepSeekApiUrl(baseUrl: string, chatPath?: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const rawPath = chatPath?.trim() || DEFAULT_CHAT_PATH;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (normalizedBase.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${normalizedBase}${path.slice(3)}`;
  }
  return `${normalizedBase}${path}`;
}

/** 将内部 Message 转为 DeepSeek API 格式，处理 tool_calls / tool_call_id 映射。 */
function toDeepSeekMessage(message: Message): Record<string, unknown> {
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

/** 将内部 ToolDefinition 列表转为 DeepSeek function-calling tools 数组。 */
function toDeepSeekTools(
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

/** DeepSeek 开放平台请求体（与官方字段对齐，独立维护）。 */
export function buildDeepSeekChatBody(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model || profile.models[0],
    messages: request.messages.map(toDeepSeekMessage),
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

  const tools = toDeepSeekTools(request.tools);
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

/** 构建 DeepSeek API 请求头（Content-Type、Accept、Authorization）。 */
export function buildDeepSeekChatHeaders(
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

/** 解析单条 DeepSeek SSE data 行，处理 reasoning_content 与增量 tool_calls 合并。 */
function parseDeepSeekSsePayload(
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
      current.name = toolDelta.function.name;
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

/** DeepSeek 流式对话：校验参数 → POST SSE → 逐行解析 → yield StreamChunk。 */
async function* streamDeepSeekChat(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  if (!profile.baseUrl.trim()) {
    yield { type: "error", error: "请先填写 DeepSeek Base URL。" };
    return;
  }
  if (!profile.models[0]?.trim() && !request.model.trim()) {
    yield { type: "error", error: "请先填写模型名称。" };
    return;
  }
  if (!profile.apiKey.trim()) {
    yield { type: "error", error: "请先填写 DeepSeek API Key。" };
    return;
  }

  const url = joinDeepSeekApiUrl(profile.baseUrl, profile.chatPath);
  const body = buildDeepSeekChatBody(profile, { ...request, stream: true });

  let response: Response;
  try {
    response = await providerFetch(url, {
      method: "POST",
      headers: buildDeepSeekChatHeaders(profile),
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
      for (const chunk of parseDeepSeekSsePayload(payload, toolCalls)) {
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

/** 发送一次最小补全请求以验证 DeepSeek API 连通性。 */
async function testDeepSeekConnection(
  profile: AiProviderProfile,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.models[0]?.trim()) {
    return { ok: false, message: "请填写 Base URL、API Key 与模型名称。" };
  }

  const url = joinDeepSeekApiUrl(profile.baseUrl, profile.chatPath);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await providerFetch(url, {
      method: "POST",
      headers: buildDeepSeekChatHeaders(profile),
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

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  capabilities: {
    stream: true,
    tools: true,
  },
  defaults: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    chatPath: DEFAULT_CHAT_PATH,
    hint: "对话模型 deepseek-chat；推理模型可用 deepseek-reasoner",
  },
  chat: streamDeepSeekChat,
  testConnection: testDeepSeekConnection,
};
