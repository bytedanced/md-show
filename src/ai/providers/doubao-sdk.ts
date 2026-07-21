/**
 * 火山方舟 SDK 版 Provider —— 使用官方 @volcengine/ark-runtime 替换手写 HTTP。
 *
 * 与 doubao.ts 逐段对比：
 *
 * ── 手写 doubao.ts ──────────────────────────
 *  buildDoubaoChatBody()       手动拼 JSON
 *  buildDoubaoChatHeaders()    手动拼 Bearer
 *  providerFetch()             裸 fetch
 *  iterateSseDataPayloads()    手动切 SSE data: 行
 *  parseDoubaoSsePayload()     手动 JSON.parse + tool_calls 合流
 *
 * ── SDK doubao-sdk.ts ───────────────────────
 *  client.createChatCompletionStream()  一体搞定：序列化 + 鉴权 + SSE 解析
 *  for await (const chunk of stream)    直接遍历 ChatCompletionStreamResponse
 *
 * SDK 特点：
 *  - 内部用 axios，不依赖浏览器 fetch，无 CORS 问题
 *  - 不需要 dangerouslyAllowBrowser
 *  - 内置重试、超时、连接池
 *  - model 字段填方舟接入点 ID（ep-xxxxxxxx）
 */

import { ArkRuntimeClient } from "@volcengine/ark-runtime";
import type {
  ChatCompletionMessage,
  ChatCompletionStreamResponse,
  Tool as ArkTool,
} from "@volcengine/ark-runtime";
import type { AiProviderProfile } from "../settings";
import type { StreamChunk, ToolCall, UnifiedChatRequest } from "../types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

// ---------------------------------------------------------------------------
// SDK 客户端
// ---------------------------------------------------------------------------

function createClient(profile: AiProviderProfile): ArkRuntimeClient {
  return new ArkRuntimeClient({
    apiKey: profile.apiKey.trim(),
    baseURL: profile.baseUrl.replace(/\/+$/, ""),
    // 可选的超时 / 重试（SDK 自带默认值）
  });
}

// ---------------------------------------------------------------------------
// 消息 / 工具转换
// ---------------------------------------------------------------------------

function toSdkMessages(messages: UnifiedChatRequest["messages"]): ChatCompletionMessage[] {
  return messages.map((m): ChatCompletionMessage => {
    switch (m.role) {
      case "system":
        return { role: "system", content: m.content };
      case "user": {
        if (m.images?.length) {
          const parts: ChatCompletionMessage["content"] = m.images.map((img) => ({
            type: "image_url" as const,
            image_url: { url: img },
          }));
          if (m.content.trim()) {
            (parts as Array<Record<string, unknown>>).push({ type: "text", text: m.content });
          }
          return { role: "user", content: parts as ChatCompletionMessage["content"] };
        }
        return { role: "user", content: m.content };
      }
      case "assistant": {
        if (m.toolCalls?.length) {
          return {
            role: "assistant",
            content: m.content,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
            ...(m.reasoningContent ? { reasoning_content: m.reasoningContent } : {}),
          };
        }
        return {
          role: "assistant",
          content: m.content,
          ...(m.reasoningContent ? { reasoning_content: m.reasoningContent } : {}),
        };
      }
      case "tool":
        return {
          role: "tool",
          content: m.content,
          tool_call_id: m.toolCallId ?? "",
          ...(m.name ? { name: m.name } : {}),
        };
      default:
        return { role: "user", content: m.content };
    }
  });
}

function toSdkTools(
  tools: UnifiedChatRequest["tools"],
): ArkTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

// ---------------------------------------------------------------------------
// 流式 chat
// ---------------------------------------------------------------------------

async function* streamDoubaoSdkChat(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  if (!profile.baseUrl.trim()) {
    yield { type: "error", error: "请先填写火山方舟 Base URL。" };
    return;
  }
  if (!profile.models[0]?.trim() && !request.model.trim()) {
    yield { type: "error", error: "模型名称应填写接入点 ID（ep-xxxxxxxx）。" };
    return;
  }
  if (!profile.apiKey.trim()) {
    yield { type: "error", error: "请先填写火山方舟 API Key。" };
    return;
  }

  const client = createClient(profile);

  let stream: AsyncIterable<ChatCompletionStreamResponse>;
  try {
    stream = await client.createChatCompletionStream(
      {
        model: request.model || profile.models[0],
        messages: toSdkMessages(request.messages),
        temperature: request.temperature ?? profile.temperature,
        max_tokens: request.maxTokens ?? profile.maxTokens,
        tools: toSdkTools(request.tools),
        tool_choice: (request.toolChoice as "auto" | "none" | "required") ?? "auto",
        ...(request.thinking ? { thinking: { type: request.thinking } } : {}),
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort as "low" | "medium" | "high" } : {}),
      },
      { signal },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      yield { type: "error", error: "已取消生成" };
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", error: `请求失败：${message}` };
    return;
  }

  const toolCalls = new Map<number, ToolCall>();
  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: "text-delta", text: delta.content };
      }

      if (delta?.reasoning_content) {
        yield { type: "thinking-delta", text: delta.reasoning_content };
      }

      for (const toolDelta of delta?.tool_calls ?? []) {
        const index = toolDelta.index ?? 0;
        const current = toolCalls.get(index) ?? {
          id: toolDelta.id ?? `call_${index}`,
          name: "",
          arguments: "",
        };
        if (toolDelta.id) current.id = toolDelta.id;
        if (toolDelta.function?.name) current.name += toolDelta.function.name;
        if (toolDelta.function?.arguments) current.arguments += toolDelta.function.arguments;
        toolCalls.set(index, current);
        yield {
          type: "tool-call",
          id: current.id,
          name: current.name,
          arguments: current.arguments,
        };
      }

      if (choice?.finish_reason) {
        yield { type: "message-stop" };
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      yield { type: "error", error: "已取消生成" };
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", error: message };
  }
}

// ---------------------------------------------------------------------------
// 连通性测试
// ---------------------------------------------------------------------------

async function testDoubaoSdkConnection(
  profile: AiProviderProfile,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.models[0]?.trim()) {
    return {
      ok: false,
      message: "请填写 Base URL、API Key 与接入点 ID（模型名称）。",
    };
  }

  const client = createClient(profile);
  try {
    await client.createChatCompletion(
      {
        model: profile.models[0],
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      },
      { signal },
    );
    return { ok: true, message: "连接成功（火山 SDK）。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `连接失败：${message}` };
  }
}

// ---------------------------------------------------------------------------
// Adapter（仅参考，未注册到 registry）
// ---------------------------------------------------------------------------

export const doubaoSdkAdapter: ProviderAdapter = {
  id: "doubao-sdk",
  label: "火山豆包 SDK 版",
  capabilities: { stream: true, tools: true },
  defaults: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    chatPath: "/chat/completions",
    hint: "使用火山官方 @volcengine/ark-runtime SDK —— 模型填接入点 ID（ep-xxxxxxxx）",
  },
  chat: streamDoubaoSdkChat,
  testConnection: testDoubaoSdkConnection,
};
