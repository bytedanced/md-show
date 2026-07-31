export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: "http" | "stdio";
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  command: string;
  args: string[];
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpDiscoveredTool {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutates: boolean;
}

export interface McpServerHealth {
  serverId: string;
  healthy: boolean;
}

export function createMcpServerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultMcpServerConfig(): McpServerConfig {
  return {
    id: createMcpServerId(),
    name: "",
    enabled: false,
    transport: "http",
    url: "",
    headers: {},
    timeoutMs: 300000,
    command: "",
    args: [],
  };
}
