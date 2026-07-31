import type { ToolHandler, ToolContext } from "../tools/types";
import type { ToolResult } from "../types";
import type { McpDiscoveredTool, McpServerConfig } from "./types";
import {
  callTool,
  connectServer,
  disconnectServer,
  listAllTools,
  shutdownAll as bridgeShutdownAll,
} from "./bridge";
import {
  listTools,
  registerTool,
  unregisterTool,
} from "../tools/registry";

const MCP_TOOL_PREFIX = "mcp__";

// serverId → serverName 映射，用于生成可读的工具名（如 mcp__doubao__xxx）
const serverNames = new Map<string, string>();

function serverNameForId(serverId: string): string {
  return serverNames.get(serverId) ?? serverId;
}

function sanitizeNameSegment(s: string): string {
  // 只保留 [a-zA-Z0-9_-]，其余替换为 _
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizeNameSegment(serverName)}__${sanitizeNameSegment(toolName)}`;
}

function parseMcpToolName(fullName: string): {
  serverName: string;
  toolName: string;
} | null {
  // 新格式 mcp__server__tool
  if (fullName.startsWith(MCP_TOOL_PREFIX)) {
    const rest = fullName.slice(MCP_TOOL_PREFIX.length);
    const sepIdx = rest.indexOf("__");
    if (sepIdx === -1) return null;
    return {
      serverName: rest.slice(0, sepIdx),
      toolName: rest.slice(sepIdx + 2),
    };
  }
  // 旧格式 mcp:server:tool（兼容过渡期残留）
  if (fullName.startsWith("mcp:")) {
    const rest = fullName.slice("mcp:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return null;
    return {
      serverName: rest.slice(0, colonIdx),
      toolName: rest.slice(colonIdx + 1),
    };
  }
  return null;
}

function createMcpToolHandler(
  serverId: string,
  tool: McpDiscoveredTool,
): ToolHandler {
  const serverName = serverNameForId(serverId);
  const fullName = mcpToolName(serverName, tool.name);
  return {
    name: fullName,
    description: `[MCP:${serverName}] ${tool.description}`,
    inputSchema: tool.inputSchema as ToolHandler["inputSchema"],
    mutates: tool.mutates,
    async execute(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
      try {
        const text = await callTool(
          serverId,
          tool.name,
          (input ?? {}) as Record<string, unknown>,
        );
        return {
          ok: true,
          content: text,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: message,
          retryable: true,
        };
      }
    },
  };
}

// 存储每个已连接服务器的配置指纹，用于检测变更
const connectedConfigs = new Map<string, string>();

function configFingerprint(config: McpServerConfig): string {
  return JSON.stringify({
    transport: config.transport,
    url: config.url,
    headers: config.headers,
    command: config.command,
    args: config.args,
    timeoutMs: config.timeoutMs,
  });
}

function unregisterMcpToolsForServer(serverId: string): void {
  const serverName = serverNameForId(serverId);
  const prefix = mcpToolName(serverName, "");
  for (const handler of listTools()) {
    if (handler.name.startsWith(prefix)) {
      unregisterTool(handler.name);
    }
  }
}

async function disconnectServerSafe(id: string): Promise<void> {
  try {
    await disconnectServer(id);
  } catch {
    // 断开失败也继续清理本地状态
  }
}

async function refreshToolRegistration(): Promise<void> {
  let tools: McpDiscoveredTool[];
  try {
    tools = await listAllTools();
  } catch {
    return;
  }

  // 移除所有 MCP 工具（兼容旧 mcp: 和新 mcp__ 前缀）
  for (const handler of listTools()) {
    if (handler.name.startsWith(MCP_TOOL_PREFIX) || handler.name.startsWith("mcp:")) {
      unregisterTool(handler.name);
    }
  }
  // listAllTools 只返回已连接服务器的工具，无需再用 connectedConfigs 过滤
  for (const tool of tools) {
    // 确保 serverNames 有映射（refresh 可能在 sync 之前被调用，如测试连接后）
    if (!serverNames.has(tool.serverId)) {
      // 无法得知 serverName，用 serverId 兜底
      serverNames.set(tool.serverId, tool.serverId);
    }
    const handler = createMcpToolHandler(tool.serverId, tool);
    registerTool(handler);
  }
}

// 同步锁：串行化所有 sync 调用，防止并发竞态
let syncChain: Promise<void> = Promise.resolve();

export async function mcpSyncFromConfig(
  configs: McpServerConfig[],
): Promise<void> {
  const run = syncChain.then(async () => {
    const enabledConfigs = configs.filter((c) => c.enabled);
    const targetIds = new Set(enabledConfigs.map((c) => c.id));

    for (const [id, fingerprint] of connectedConfigs) {
      if (!targetIds.has(id)) {
        unregisterMcpToolsForServer(id);
        await disconnectServerSafe(id);
        serverNames.delete(id);
        connectedConfigs.delete(id);
        continue;
      }
      const config = enabledConfigs.find((c) => c.id === id);
      if (config && fingerprint !== configFingerprint(config)) {
        unregisterMcpToolsForServer(id);
        await disconnectServerSafe(id);
        serverNames.delete(id);
        connectedConfigs.delete(id);
      }
    }

    for (const config of enabledConfigs) {
      // 无条件更新 serverNames，确保已连接的服务器也能拿到最新名称
      serverNames.set(config.id, config.name || config.id);
      if (!connectedConfigs.has(config.id)) {
        try {
          await connectServer(config);
          connectedConfigs.set(config.id, configFingerprint(config));
        } catch {
          // 连接失败，由 UI 展示错误；下次 sync 会重试
        }
      }
    }

    if (connectedConfigs.size > 0) {
      await refreshToolRegistration();
    } else {
      for (const handler of listTools()) {
        if (handler.name.startsWith(MCP_TOOL_PREFIX)) {
          unregisterTool(handler.name);
        }
      }
    }
  });

  syncChain = run.catch(() => { });
  await run;
}

/// 一次性测试连接：连接 → 列出工具 → 若不由 sync 管理则断开。
/// 不修改 connectedConfigs，不影响 sync 生命周期。
export async function mcpTestConnection(
  config: McpServerConfig,
): Promise<McpDiscoveredTool[]> {
  serverNames.set(config.id, config.name || config.id);
  await connectServer(config);
  const allTools = await listAllTools();
  const serverTools = allTools.filter((t) => t.serverId === config.id);

  if (!connectedConfigs.has(config.id)) {
    await disconnectServerSafe(config.id);
  } else {
    connectedConfigs.set(config.id, configFingerprint(config));
  }

  return serverTools;
}

export async function mcpDisconnectSingle(serverId: string): Promise<void> {
  unregisterMcpToolsForServer(serverId);
  await disconnectServerSafe(serverId);
  serverNames.delete(serverId);
  connectedConfigs.delete(serverId);
}

export async function mcpRefreshTools(): Promise<void> {
  await refreshToolRegistration();
}

export async function mcpShutdownAll(): Promise<void> {
  for (const id of connectedConfigs.keys()) {
    unregisterMcpToolsForServer(id);
    serverNames.delete(id);
  }
  connectedConfigs.clear();
  await bridgeShutdownAll();
}

export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX) || toolName.startsWith("mcp:");
}

export function mcpToolSource(toolName: string): string | null {
  const parsed = parseMcpToolName(toolName);
  return parsed ? parsed.serverName : null;
}

export function mcpToolDisplayName(toolName: string): string | null {
  const parsed = parseMcpToolName(toolName);
  return parsed ? parsed.toolName : null;
}

export function getConnectedMcpServerIds(): string[] {
  return [...connectedConfigs.keys()];
}
