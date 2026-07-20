import { DEFAULT_MAX_TOOL_ROUNDS, type AiProviderProfile } from "../settings";
import { getProviderAdapter } from "../providers/registry";
import {
  executeTool,
  resolveToolsForMode,
} from "../tools/registry";
import type { ToolContext } from "../tools/types";
import {
  createMessageId,
  type AiMode,
  type Message,
  type StreamChunk,
  type ToolCall,
} from "../types";
import { toolChoiceForMode } from "./modes";

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "tool-result"; call: ToolCall; content: string; ok: boolean }
  | { type: "message"; message: Message }
  | { type: "done"; message: Message }
  | { type: "error"; error: string };

export interface AgentLoopOptions {
  mode: AiMode;
  profile: AiProviderProfile;
  messages: Message[];
  toolContext?: ToolContext;
  maxToolRounds?: number;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface RoundAccumulation {
  text: string;
  toolCalls: ToolCall[];
}

function mergeToolCallDelta(
  current: ToolCall | null,
  chunk: Extract<StreamChunk, { type: "tool-call" }>,
): ToolCall {
  if (!current || current.id !== chunk.id) {
    return {
      id: chunk.id,
      name: chunk.name,
      arguments: chunk.arguments,
    };
  }
  return {
    id: current.id,
    name: chunk.name || current.name,
    arguments: `${current.arguments}${chunk.arguments}`,
  };
}

async function collectProviderRound(
  chunks: AsyncIterable<StreamChunk>,
  onEvent: (event: AgentEvent) => void | Promise<void>,
): Promise<RoundAccumulation | { error: string }> {
  const accumulation: RoundAccumulation = { text: "", toolCalls: [] };
  let pendingToolCall: ToolCall | null = null;

  for await (const chunk of chunks) {
    if (chunk.type === "error") {
      return { error: chunk.error };
    }
    if (chunk.type === "text-delta") {
      accumulation.text += chunk.text;
      await onEvent({ type: "text-delta", text: chunk.text });
      continue;
    }
    if (chunk.type === "tool-call") {
      if (pendingToolCall && pendingToolCall.id !== chunk.id) {
        accumulation.toolCalls.push(pendingToolCall);
        await onEvent({ type: "tool-call", call: pendingToolCall });
      }
      pendingToolCall = mergeToolCallDelta(pendingToolCall, chunk);
      continue;
    }
    if (chunk.type === "message-stop") {
      break;
    }
  }

  if (pendingToolCall) {
    accumulation.toolCalls.push(pendingToolCall);
    await onEvent({ type: "tool-call", call: pendingToolCall });
  }

  return accumulation;
}

/**
 * 统一 Agent 循环。
 * Chat 模式不附带 tools，等价于单轮补全直出。
 * A0：工具可执行已注册 handler；默认无注册工具，网络层返回未接入错误。
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
  onEvent: (event: AgentEvent) => void | Promise<void> = () => undefined,
): Promise<Message> {
  const adapter = getProviderAdapter(options.profile.adapter);
  if (!adapter) {
    const error = `未找到 Provider Adapter：${options.profile.adapter}`;
    await onEvent({ type: "error", error });
    throw new Error(error);
  }

  const signal = options.signal ?? new AbortController().signal;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const tools = resolveToolsForMode(options.mode);
  const toolContext: ToolContext = options.toolContext ?? {
    workspaceRoot: null,
    openTabs: [],
    activePath: null,
  };

  const messages = [...options.messages];
  let assistantMessage: Message = {
    id: createMessageId(),
    role: "assistant",
    content: "",
  };

  for (let round = 0; round <= maxToolRounds; round += 1) {
    if (signal.aborted) {
      const error = "已取消生成";
      await onEvent({ type: "error", error });
      throw new Error(error);
    }

    const stream = adapter.chat(
      options.profile,
      {
        messages,
        model: options.profile.model,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: toolChoiceForMode(options.mode),
        stream: true,
        temperature: options.temperature ?? options.profile.temperature,
        maxTokens: options.maxTokens ?? options.profile.maxTokens,
      },
      signal,
    );

    const roundResult = await collectProviderRound(stream, onEvent);
    if ("error" in roundResult) {
      await onEvent({ type: "error", error: roundResult.error });
      throw new Error(roundResult.error);
    }

    assistantMessage = {
      id: createMessageId(),
      role: "assistant",
      content: roundResult.text,
      toolCalls: roundResult.toolCalls.length
        ? roundResult.toolCalls
        : undefined,
    };
    messages.push(assistantMessage);
    await onEvent({ type: "message", message: assistantMessage });

    if (!roundResult.toolCalls.length) {
      await onEvent({ type: "done", message: assistantMessage });
      return assistantMessage;
    }

    if (round >= maxToolRounds) {
      const error = `已达到最大工具轮次（${maxToolRounds}）`;
      await onEvent({ type: "error", error });
      throw new Error(error);
    }

    for (const call of roundResult.toolCalls) {
      const result = await executeTool(call.name, call.arguments, toolContext);
      const toolMessage: Message = {
        id: createMessageId(),
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: result.ok
          ? result.content
          : JSON.stringify({ error: result.error, retryable: result.retryable }),
      };
      messages.push(toolMessage);
      await onEvent({
        type: "tool-result",
        call,
        content: toolMessage.content,
        ok: result.ok,
      });
      await onEvent({ type: "message", message: toolMessage });
    }
  }

  await onEvent({ type: "done", message: assistantMessage });
  return assistantMessage;
}
