/**
 * OpenAI SDK 版 Provider —— 与 openai.ts 并行，用于对比手写 HTTP vs 官方 SDK。
 *
 * 对比如下：
 *
 * ── 手写 openai.ts ────────────────────────────
 *  buildOpenAiChatBody()      手动拼接 JSON 请求体
 *  buildOpenAiChatHeaders()   手动拼 Authorization / Content-Type
 *  providerFetch()            裸 fetch()
 *  iterateSseDataPayloads()   手动按行解析 SSE data: 前缀
 *  parseOpenAiSsePayload()    手动 JSON.parse + tool_calls 增量合流
 *  readErrorMessage()         手动解 response body 错误
 *
 * ── SDK openai-sdk.ts ─────────────────────────
 *  client.chat.completions.create({...})  一体搞定：请求体 + 鉴权 + 流式解析
 *  for await (const chunk of stream) {}   直接遍历类型化 chunk，无需手动 SSE
 *  APIError.message                        结构化错误信息
 *
 * SDK 缺点：
 *  - 不支持自定义 chatPath（SDK 固定追加 /chat/completions 到 baseURL）
 *  - 浏览器/WebView 环境需设 dangerouslyAllowBrowser: true
 *  - 包体积 ~80KB gzipped
 */

import OpenAI from "openai";
import type { AiProviderProfile } from "../settings";
import type { StreamChunk, ToolCall, UnifiedChatRequest } from "../types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

// ---------------------------------------------------------------------------
// SDK 客户端
// ---------------------------------------------------------------------------

function createClient(profile: AiProviderProfile): OpenAI {
  return new OpenAI({
    baseURL: profile.baseUrl.replace(/\/+$/, ""),
    apiKey: profile.apiKey.trim() || "no-key",
    defaultHeaders: profile.headers,
    dangerouslyAllowBrowser: true, // WebView / Tauri 环境必需
  });
}

// ---------------------------------------------------------------------------
// 消息转换（SDK 的类型比手写 Record<string, unknown> 更精确）
// ---------------------------------------------------------------------------

function toSdkMessages(
  messages: UnifiedChatRequest["messages"],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    switch (m.role) {
      case "system":
        return { role: "system", content: m.content };
      case "user": {
        if (m.images?.length) {
          const parts: Array<Record<string, unknown>> = m.images.map((img) => ({
            type: "image_url",
            image_url: { url: img },
          }));
          if (m.content.trim()) {
            parts.push({ type: "text", text: m.content });
          }
          return { role: "user", content: parts as unknown as string };
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
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ---------------------------------------------------------------------------
// 流式 chat（SDK 版）
// ---------------------------------------------------------------------------

async function* streamOpenAiSdkChat(
  profile: AiProviderProfile,
  request: UnifiedChatRequest,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  // ── 参数校验（同手写版） ──
  if (!profile.baseUrl.trim()) {
    yield { type: "error", error: "请先填写 OpenAI Base URL。" };
    return;
  }
  if (!profile.models[0]?.trim() && !request.model.trim()) {
    yield { type: "error", error: "请先填写模型名称。" };
    return;
  }
  if (!profile.apiKey.trim()) {
    yield { type: "error", error: "请先填写 OpenAI API Key。" };
    return;
  }

  const client = createClient(profile);

  // ── 发起请求 —— 对比手写版：不需要 buildXxxBody / buildXxxHeaders ──
  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await client.chat.completions.create(
      {
        model: request.model || profile.models[0],
        messages: toSdkMessages(request.messages),
        stream: true,
        temperature: request.temperature ?? profile.temperature,
        max_tokens: request.maxTokens ?? profile.maxTokens,
        tools: toSdkTools(request.tools),
        tool_choice: (request.toolChoice as "auto" | "none" | "required") ?? "auto",
        ...(request.thinking ? { thinking: { type: request.thinking } } : {}),
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      },
      { signal },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      yield { type: "error", error: "已取消生成" };
      return;
    }
    // APIError 自带可读 message，无需 readErrorMessage
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", error: `请求失败：${message}` };
    return;
  }

  // ── 消费流 —— 对比手写版：不需要 iterateSseDataPayloads / parsePayload ──
  const toolCalls = new Map<number, ToolCall>();
  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: "text-delta", text: delta.content };
      }

      if ((delta as Record<string, unknown>)?.reasoning_content) {
        yield { type: "thinking-delta", text: (delta as Record<string, unknown>).reasoning_content as string };
      }

      for (const toolDelta of delta?.tool_calls ?? []) {
        const index = toolDelta.index;
        const current = toolCalls.get(index) ?? {
          id: toolDelta.id ?? `call_${index}`,
          name: "",
          arguments: "",
        };
        if (toolDelta.id) current.id = toolDelta.id;
        if (toolDelta.function?.name) current.name = toolDelta.function.name;
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
// 连通性测试（SDK 版）
// ---------------------------------------------------------------------------

async function testOpenAiSdkConnection(
  profile: AiProviderProfile,
  signal?: AbortSignal,
): Promise<ProviderTestResult> {
  if (!profile.baseUrl.trim() || !profile.apiKey.trim() || !profile.models[0]?.trim()) {
    return { ok: false, message: "请填写 Base URL、API Key 与模型名称。" };
  }

  const client = createClient(profile);
  try {
    await client.chat.completions.create(
      {
        model: profile.models[0],
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      },
      { signal },
    );
    return { ok: true, message: "连接成功（SDK）。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `连接失败：${message}` };
  }
}

// ---------------------------------------------------------------------------
// Adapter（仅参考，未注册到 registry）
// ---------------------------------------------------------------------------

export const openaiSdkAdapter: ProviderAdapter = {
  id: "openai-sdk",
  label: "OpenAI SDK 版",
  capabilities: { stream: true, tools: true },
  defaults: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    chatPath: "/chat/completions",
    hint: "使用 OpenAI 官方 npm SDK —— 对比参考",
  },
  chat: streamOpenAiSdkChat,
  testConnection: testOpenAiSdkConnection,
};
