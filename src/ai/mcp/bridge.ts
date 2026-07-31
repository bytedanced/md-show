import { invoke } from "@tauri-apps/api/core";
import type {
  McpDiscoveredTool,
  McpServerConfig,
  McpServerHealth,
} from "./types";

export async function connectServer(config: McpServerConfig): Promise<void> {
  await invoke("mcp_connect", {
    serverId: config.id,
    transport: config.transport,
    url: config.transport === "http" ? config.url || null : null,
    headers: config.transport === "http" ? config.headers || null : null,
    command: config.transport === "stdio" ? config.command || null : null,
    args: config.transport === "stdio" ? config.args || null : null,
    timeoutMs: config.timeoutMs ?? 30000,
  });
}

export async function disconnectServer(serverId: string): Promise<void> {
  await invoke("mcp_disconnect", { serverId });
}

export async function listAllTools(): Promise<McpDiscoveredTool[]> {
  const raw = await invoke<Array<Record<string, unknown>>>("mcp_list_all_tools");
  return raw.map((t) => ({
    serverId: (t.server_id ?? t.serverId ?? "") as string,
    name: t.name as string,
    description: t.description as string,
    inputSchema: (t.input_schema ?? t.inputSchema ?? {}) as Record<string, unknown>,
    mutates: false,
  }));
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await invoke<{ is_error: boolean; text: string }>("mcp_call_tool", {
    serverId,
    toolName,
    arguments: args,
  });
  if (result.is_error) {
    throw new Error(result.text || "工具调用失败");
  }
  return result.text;
}

export async function healthCheck(): Promise<McpServerHealth[]> {
  const raw = await invoke<Array<Record<string, unknown>>>("mcp_health_check");
  return raw.map((s) => ({
    serverId: (s.server_id ?? s.serverId ?? "") as string,
    healthy: (s.healthy ?? false) as boolean,
  }));
}

export async function shutdownAll(): Promise<void> {
  await invoke("mcp_shutdown_all");
}
