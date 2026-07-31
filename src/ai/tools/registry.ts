import type { CustomMode } from "../types";
import { toolsForMode } from "../agent/modes";
import type { ToolContext, ToolHandler } from "./types";
import { toToolDefinition } from "./types";
import type { ToolDefinition, ToolResult } from "../types";

const handlers = new Map<string, ToolHandler>();

export function registerTool(handler: ToolHandler): void {
  handlers.set(handler.name, handler);
}

export function unregisterTool(name: string): void {
  handlers.delete(name);
}

export function getTool(name: string): ToolHandler | null {
  return handlers.get(name) ?? null;
}

export function listTools(): ToolHandler[] {
  return Array.from(handlers.values());
}

export function clearTools(): void {
  handlers.clear();
}

/** 按模式过滤已注册工具，支持自定义模式。 */
export function resolveToolsForMode(
  mode: string,
  customModes?: readonly CustomMode[],
): ToolDefinition[] {
  const allowed = new Set(toolsForMode(mode, customModes));
  return listTools()
    .filter((handler) => allowed.has(handler.name))
    .map(toToolDefinition);
}

export async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handler = getTool(name);
  if (!handler) {
    return {
      ok: false,
      error: `未注册的工具：${name}`,
      retryable: false,
    };
  }

  let input: unknown = {};
  if (rawArguments.trim()) {
    try {
      input = JSON.parse(rawArguments) as unknown;
    } catch {
      return {
        ok: false,
        error: `工具参数不是合法 JSON：${name}`,
        retryable: true,
      };
    }
  }

  try {
    return await handler.execute(input, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      retryable: true,
    };
  }
}
