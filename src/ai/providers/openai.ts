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

export function joinOpenAiApiUrl(baseUrl: string, chatPath?: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const rawPath = chatPath?.trim() || DEFAULT_CHAT_PATH;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (normalizedBase.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${normalizedBase}${path.slice(3)}`;
  }
  return `${normalizedBase}${path}`;
}

function toOpenAiMessage(message: Message): Record<string, unknown> {
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

  if (message.role === "tool") {
    payload.tool_call_id = message.toolCallId;
    if (message.name) {
      payload.name = message.name;
    }
  }

  return payload;
}

function toOpenAiTools(
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

export function buildOpenAiChatBody(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model || profile.model,
    messages: request.messages.map(toOpenAiMessage),
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

  const tools = toOpenAiTools(request.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = request.toolChoice ?? "auto";
  }

  return body;
}

export function buildOpenAiChatHeaders(
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

function parseOpenAiSsePayload(
  payload: string,
  toolCalls: Map<number, ToolCall>,
): StreamChunk[] {
  let json: {
    choices?: Array<{
      delta?: {
        content?: string | null;
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

async function* streamOpenAiChat(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  if (!profile.baseUrl.trim()) {
    yield { type: "error", error: "请先填写 OpenAI Base URL。" };
    return;
  }
  if (!profile.model.trim() && !request.model.trim()) {
    yield { type: "error", error: "请先填写模型名称。" };
    return;
  }
  if (!profile.apiKey.trim()) {
    yield { type: "error", error: "请先填写 OpenAI API Key。" };
    return;
  }

  const url = joinOpenAiApiUrl(profile.baseUrl, profile.chatPath);
  const body = buildOpenAiChatBody(profile, { ...request, stream: true });

  let response: Response;
  try {
    response = await providerFetch(url, {
      method: "POST",
      headers: buildOpenAiChatHeaders(profile),
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
      for (const chunk of parseOpenAiSsePayload(payload, toolCalls)) {
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

async function testOpenAiConnection(
  profile: AiProviderProfile,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.model.trim()) {
    return { ok: false, message: "请填写 Base URL、API Key 与模型名称。" };
  }

  const url = joinOpenAiApiUrl(profile.baseUrl, profile.chatPath);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await providerFetch(url, {
      method: "POST",
      headers: buildOpenAiChatHeaders(profile),
      body: JSON.stringify({
        model: profile.model,
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

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI (ChatGPT)",
  capabilities: {
    stream: true,
    tools: true,
  },
  defaults: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    chatPath: DEFAULT_CHAT_PATH,
    hint: "使用 OpenAI API Key；模型如 gpt-4o、gpt-4o-mini",
  },
  chat: streamOpenAiChat,
  testConnection: testOpenAiConnection,
};
