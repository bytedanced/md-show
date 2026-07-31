import { DEFAULT_MAX_TOOL_ROUNDS, type AiProviderProfile } from "../settings";
import { getProviderAdapter } from "../providers/registry";
import {
  executeTool,
  resolveToolsForMode,
} from "../tools/registry";
import type { ToolContext } from "../tools/types";
import {
  createMessageId,
  type CustomMode,
  type Message,
  type ReasoningEffort,
  type StreamChunk,
  type ThinkingMode,
  type ToolCall,
} from "../types";
import { toolChoiceForMode } from "./modes";

/** Agent 循环过程中向外推送的事件，UI 层据此增量渲染。 */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "tool-result"; call: ToolCall; content: string; ok: boolean }
  | { type: "message"; message: Message }
  | { type: "done"; message: Message }
  | { type: "error"; error: string };

/** 启动 Agent 循环所需的所有参数。 */
export interface AgentLoopOptions {
  mode: string;
  customModes?: readonly CustomMode[];
  profile: AiProviderProfile;
  messages: Message[];
  toolContext?: ToolContext;
  maxToolRounds?: number;
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingMode;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}

/** 单轮对话中积累的文本与工具调用。 */
interface RoundAccumulation {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
}

/** 合并 SSE 流式工具调用增量，同名同 id 则覆盖参数、同 id 补全名称。 */
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
  // Provider 解析层已在 Map 中累加参数，chunk.arguments 即为当前完整值，直接替换即可。
  return {
    id: current.id,
    name: chunk.name || current.name,
    arguments: chunk.arguments,
  };
}

/** 消费 Provider 返回的 SSE 流，累积文本与工具调用并通过回调外发事件。 */
async function collectProviderRound(
  chunks: AsyncIterable<StreamChunk>,
  onEvent: (event: AgentEvent) => void | Promise<void>,
): Promise<RoundAccumulation | { error: string }> {
  const accumulation: RoundAccumulation = { text: "", thinking: "", toolCalls: [] };
  let pendingToolCall: ToolCall | null = null;

  for await (const chunk of chunks) {
    if (chunk.type === "error") {
      return { error: chunk.error };
    }
    if (chunk.type === "thinking-delta") {
      accumulation.thinking += chunk.text;
      await onEvent({ type: "thinking-delta", text: chunk.text });
      continue;
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
): Promise<Message[]> {
  const adapter = getProviderAdapter(options.profile.adapter);
  if (!adapter) {
    const error = `未找到 Provider Adapter：${options.profile.adapter}`;
    await onEvent({ type: "error", error });
    throw new Error(error);
  }

  const signal = options.signal ?? new AbortController().signal;
  const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const tools = resolveToolsForMode(options.mode, options.customModes);
  const toolContext: ToolContext = options.toolContext ?? {
    workspaceRoot: null,
    openTabs: [],
    activePath: null,
  };

  const messages = [...options.messages];
  const initialCount = messages.length;
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
        model: options.profile.models[0],
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: toolChoiceForMode(options.mode, options.customModes),
        stream: true,
        temperature: options.temperature ?? options.profile.temperature,
        maxTokens: options.maxTokens ?? options.profile.maxTokens,
        thinking: options.thinking,
        reasoningEffort: options.reasoningEffort,
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
      reasoningContent: roundResult.thinking || undefined,
    };
    messages.push(assistantMessage);
    await onEvent({ type: "message", message: assistantMessage });

    if (!roundResult.toolCalls.length) {
      await onEvent({ type: "done", message: assistantMessage });
      return messages.slice(initialCount);
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
  return messages.slice(initialCount);
}
