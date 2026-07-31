import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiSettings, McpServerConfig } from "../../ai";
import {
  createDefaultMcpServerConfig,
  createMcpServerId,
  listTools,
  mcpDisconnectSingle,
  mcpListAllTools,
  mcpRefreshTools,
  mcpTestConnection,
  mcpToolDisplayName,
  type McpDiscoveredTool,
  type McpServerStatus,
} from "../../ai";
import { Icon } from "../Icon";

interface McpServersPageProps {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  serverStatuses: Record<string, { status: McpServerStatus; tools: McpDiscoveredTool[]; error?: string }>;
  onServerStatusesChange: (updater: Record<string, { status: McpServerStatus; tools: McpDiscoveredTool[]; error?: string }> | ((prev: Record<string, { status: McpServerStatus; tools: McpDiscoveredTool[]; error?: string }>) => Record<string, { status: McpServerStatus; tools: McpDiscoveredTool[]; error?: string }>)) => void;
  testResult: { serverId: string; ok: boolean; message: string } | null;
  onTestResultChange: (result: { serverId: string; ok: boolean; message: string } | null) => void;
}

export function McpServersPage({
  aiSettings,
  onAiSettingsChange,
  serverStatuses,
  onServerStatusesChange,
  testResult,
  onTestResultChange,
}: McpServersPageProps) {
  const mcpServers: McpServerConfig[] = aiSettings.mcpServers ?? [];

  const [selectedId, setSelectedId] = useState<string>(
    () => mcpServers[0]?.id ?? "",
  );
  const [newHeaderKey, setNewHeaderKey] = useState("");
  const [newHeaderValue, setNewHeaderValue] = useState("");

  // selectedId 跟随 mcpServers 变化（加载、删除、外部修改）
  useEffect(() => {
    if (mcpServers.length === 0) {
      if (selectedId !== "") setSelectedId("");
      return;
    }
    if (!mcpServers.some((s) => s.id === selectedId)) {
      setSelectedId(mcpServers[0].id);
    }
  }, [mcpServers, selectedId]);

  // mount 时从已连接的服务器恢复状态（确保切回此 tab 后工具列表仍可见）
  useEffect(() => {
    mcpListAllTools().then((tools) => {
      onServerStatusesChange((prev) => {
        const next = { ...prev };
        for (const server of mcpServers) {
          if (!server.enabled) continue;
          const serverTools = tools.filter((t) => t.serverId === server.id);
          if (serverTools.length > 0) {
            next[server.id] = { status: "connected", tools: serverTools };
          }
        }
        return next;
      });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedServer = useMemo(
    () => mcpServers.find((s) => s.id === selectedId) ?? null,
    [mcpServers, selectedId],
  );

  const selectedStatus = selectedId ? serverStatuses[selectedId] : undefined;

  // 已发现工具：优先展示本次会话中测试连接/刷新拿到的工具，否则从全局注册表 fallback
  const resolvedTools = useMemo((): McpDiscoveredTool[] => {
    if (!selectedServer) return [];
    if (selectedStatus?.tools?.length) return selectedStatus.tools;
    const serverName = selectedServer.name || selectedServer.id;
    const prefixNew = `mcp__${serverName}__`;
    const prefixOld = `mcp:${serverName}:`;
    return listTools()
      .filter((t) => t.name.startsWith(prefixNew) || t.name.startsWith(prefixOld))
      .map((t) => {
        const toolName = mcpToolDisplayName(t.name) ?? t.name;
        return {
          serverId: selectedServer.id,
          name: toolName,
          description: t.description,
          inputSchema: t.inputSchema as McpDiscoveredTool["inputSchema"],
          mutates: t.mutates,
        };
      });
  }, [selectedServer, selectedStatus, serverStatuses]);

  const updateServer = useCallback(
    (id: string, patch: Partial<McpServerConfig>) => {
      onAiSettingsChange({
        ...aiSettings,
        mcpServers: mcpServers.map((s) =>
          s.id === id ? { ...s, ...patch } : s,
        ),
      });
    },
    [aiSettings, mcpServers, onAiSettingsChange],
  );

  const addServer = useCallback(() => {
    const config = createDefaultMcpServerConfig();
    config.id = createMcpServerId();
    config.name = "新服务器";
    onAiSettingsChange({
      ...aiSettings,
      mcpServers: [...mcpServers, config],
    });
    setSelectedId(config.id);
  }, [aiSettings, mcpServers, onAiSettingsChange]);

  const deleteServer = useCallback(() => {
    if (!selectedServer) return;
    const next = mcpServers.filter((s) => s.id !== selectedServer.id);
    onAiSettingsChange({
      ...aiSettings,
      mcpServers: next,
    });
    mcpDisconnectSingle(selectedServer.id).catch(() => { });
    onServerStatusesChange((prev) => {
      const copy = { ...prev };
      delete copy[selectedServer.id];
      return copy;
    });
  }, [aiSettings, mcpServers, onAiSettingsChange, selectedServer]);

  const toggleEnabled = useCallback(
    (id: string) => {
      const server = mcpServers.find((s) => s.id === id);
      if (!server) return;
      updateServer(id, { enabled: !server.enabled });
    },
    [mcpServers, updateServer],
  );

  const testConnection = useCallback(async () => {
    if (!selectedServer) return;
    onServerStatusesChange((prev) => ({
      ...prev,
      [selectedServer.id]: {
        ...prev[selectedServer.id],
        status: "connecting",
      },
    }));
    try {
      const serverTools = await mcpTestConnection(selectedServer);
      onServerStatusesChange((prev) => ({
        ...prev,
        [selectedServer.id]: {
          status: "connected",
          tools: serverTools,
        },
      }));
      onTestResultChange({
        serverId: selectedServer.id,
        ok: true,
        message: `连接成功，发现 ${serverTools.length} 个工具`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onServerStatusesChange((prev) => ({
        ...prev,
        [selectedServer.id]: {
          ...prev[selectedServer.id],
          status: "error",
          error: message,
        },
      }));
      onTestResultChange({ serverId: selectedServer.id, ok: false, message });
    }
  }, [selectedServer]);

  const refreshTools = useCallback(async () => {
    await mcpRefreshTools();
    try {
      const tools = await mcpListAllTools();
      onServerStatusesChange((prev) => {
        const next = { ...prev };
        for (const [id, info] of Object.entries(next)) {
          const serverTools = tools.filter(
            (t) => t.serverId === id,
          );
          next[id] = { ...info, tools: serverTools };
        }
        return next;
      });
    } catch {
      // ignore refresh errors
    }
  }, []);

  const clearTestResult = useCallback(() => onTestResultChange(null), [onTestResultChange]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(clearTestResult, 6000);
    return () => clearTimeout(timer);
  }, [testResult, clearTestResult, selectedId]);

  const statusColor = (status: McpServerStatus | undefined): string => {
    switch (status) {
      case "connected":
        return "var(--color-success, #4caf50)";
      case "connecting":
        return "var(--color-warning, #ff9800)";
      case "error":
        return "var(--color-danger, #f44336)";
      default:
        return "var(--color-muted, #9e9e9e)";
    }
  };

  const statusLabel = (status: McpServerStatus | undefined): string => {
    switch (status) {
      case "connected":
        return "已连接";
      case "connecting":
        return "连接中";
      case "error":
        return "错误";
      default:
        return "未连接";
    }
  };

  return (
    <div className="agent-config__body">
      <aside className="agent-config__sidebar">
        <div className="agent-config__mode-list">
          {mcpServers.map((server) => {
            const info = serverStatuses[server.id];
            const st = info?.status;
            return (
              <button
                className={`agent-config__mode-item${server.id === selectedId ? " is-active" : ""}`}
                key={server.id}
                onClick={() => setSelectedId(server.id)}
                type="button"
              >
                <span className="agent-config__mode-name">
                  <span
                    className="mcp-status-dot"
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: statusColor(st),
                      marginRight: 6,
                      flexShrink: 0,
                    }}
                  />
                  {server.name || "未命名"}
                </span>
                <span className="agent-config__mode-meta">
                  {server.enabled ? "已启用" : "已停用"}
                  {info?.tools?.length ? ` · ${info.tools.length} 工具` : ""}
                  {st === "error" ? " · 错误" : ""}
                </span>
              </button>
            );
          })}
        </div>
        <button
          className="button button--ghost agent-config__add-mode"
          onClick={addServer}
          type="button"
        >
          <Icon name="plus" size={14} /> 添加服务器
        </button>
      </aside>

      <main className="agent-config__detail">
        {selectedServer ? (
          <>
            <div className="agent-config__field">
              <label className="agent-config__label">服务器名称</label>
              <input
                className="agent-config__input"
                onChange={(e) => updateServer(selectedServer.id, { name: e.target.value })}
                placeholder="输入服务器名称"
                type="text"
                value={selectedServer.name}
              />
            </div>

            <label className="agent-config__checkbox">
              <input
                checked={selectedServer.enabled}
                onChange={() => toggleEnabled(selectedServer.id)}
                type="checkbox"
              />
              <span>启用此服务器</span>
            </label>

            <div className="agent-config__field">
              <label className="agent-config__label">传输类型</label>
              <select
                className="agent-config__select"
                onChange={(e) =>
                  updateServer(selectedServer.id, {
                    transport: e.target.value as "http" | "stdio",
                  })
                }
                value={selectedServer.transport}
              >
                <option value="http">HTTP (Streamable)</option>
                <option value="stdio">stdio (命令行)</option>
              </select>
            </div>

            {selectedServer.transport === "http" ? (
              <>
                <div className="agent-config__field">
                  <label className="agent-config__label">URL</label>
                  <input
                    className="agent-config__input"
                    onChange={(e) => updateServer(selectedServer.id, { url: e.target.value })}
                    placeholder="http://localhost:8080/mcp"
                    type="text"
                    value={selectedServer.url}
                  />
                </div>
                <div className="agent-config__field">
                  <label className="agent-config__label">自定义 Headers</label>
                  <div className="mcp-headers-list">
                    {Object.entries(selectedServer.headers).map(([key, value]) => (
                      <div className="mcp-headers-row" key={key}>
                        <input
                          className="agent-config__input mcp-headers-key"
                          onChange={(e) => {
                            const next = { ...selectedServer.headers };
                            delete next[key];
                            const newKey = e.target.value;
                            if (newKey.trim()) {
                              next[newKey.trim()] = value;
                            }
                            updateServer(selectedServer.id, { headers: next });
                          }}
                          placeholder="Key"
                          type="text"
                          value={key}
                        />
                        <input
                          className="agent-config__input mcp-headers-value"
                          onChange={(e) => {
                            updateServer(selectedServer.id, {
                              headers: {
                                ...selectedServer.headers,
                                [key]: e.target.value,
                              },
                            });
                          }}
                          placeholder="Value"
                          type="text"
                          value={value}
                        />
                        <button
                          aria-label={`移除 ${key}`}
                          className="mcp-headers-remove"
                          onClick={() => {
                            const next = { ...selectedServer.headers };
                            delete next[key];
                            updateServer(selectedServer.id, { headers: next });
                          }}
                          type="button"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="mcp-headers-row mcp-headers-row--add">
                      <input
                        className="agent-config__input mcp-headers-key"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const target = e.target as HTMLInputElement;
                            const sibling =
                              target.parentElement?.querySelector<HTMLInputElement>(
                                ".mcp-headers-value",
                              );
                            if (sibling) sibling.focus();
                          }
                        }}
                        placeholder="新 Key"
                        type="text"
                        value={newHeaderKey}
                        onChange={(e) => setNewHeaderKey(e.target.value)}
                      />
                      <input
                        className="agent-config__input mcp-headers-value"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newHeaderKey.trim()) {
                            updateServer(selectedServer.id, {
                              headers: {
                                ...selectedServer.headers,
                                [newHeaderKey.trim()]: newHeaderValue,
                              },
                            });
                            setNewHeaderKey("");
                            setNewHeaderValue("");
                          }
                        }}
                        placeholder="新 Value"
                        type="text"
                        value={newHeaderValue}
                        onChange={(e) => setNewHeaderValue(e.target.value)}
                      />
                      <button
                        aria-label="添加 Header"
                        className="mcp-headers-add"
                        disabled={!newHeaderKey.trim()}
                        onClick={() => {
                          if (!newHeaderKey.trim()) return;
                          updateServer(selectedServer.id, {
                            headers: {
                              ...selectedServer.headers,
                              [newHeaderKey.trim()]: newHeaderValue,
                            },
                          });
                          setNewHeaderKey("");
                          setNewHeaderValue("");
                        }}
                        type="button"
                      >
                        <Icon name="plus" size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="agent-config__field">
                  <label className="agent-config__label">命令</label>
                  <input
                    className="agent-config__input"
                    onChange={(e) => updateServer(selectedServer.id, { command: e.target.value })}
                    placeholder="npx 或可执行文件路径"
                    type="text"
                    value={selectedServer.command}
                  />
                </div>
                <div className="agent-config__field">
                  <label className="agent-config__label">
                    参数（每行一个）
                  </label>
                  <textarea
                    className="agent-config__textarea"
                    onChange={(e) =>
                      updateServer(selectedServer.id, {
                        args: e.target.value
                          .split("\n")
                          .map((a) => a.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="-y"
                    rows={3}
                    value={selectedServer.args.join("\n")}
                  />
                </div>
              </>
            )}

            <div className="agent-config__field">
              <label className="agent-config__label">
                超时（毫秒）
              </label>
              <input
                className="agent-config__input"
                min={1000}
                onChange={(e) =>
                  updateServer(selectedServer.id, {
                    timeoutMs: Math.max(1000, Number(e.target.value) || 30000),
                  })
                }
                step={1000}
                type="number"
                value={selectedServer.timeoutMs}
              />
            </div>

            <div className="agent-config__mcp-actions">
              <button
                className="button button--primary"
                onClick={() => void testConnection()}
                type="button"
              >
                <Icon name="sparkles" size={14} /> 测试连接
              </button>
              <button
                className="button button--ghost"
                onClick={() => void refreshTools()}
                type="button"
              >
                <Icon name="sparkles" size={14} /> 刷新工具
              </button>
              <button
                className="button button--secondary agent-config__delete"
                onClick={deleteServer}
                type="button"
              >
                <Icon name="close" size={14} /> 删除服务器
              </button>
            </div>

            {testResult && testResult.serverId === selectedServer.id && (
              <div
                className={`mcp-test-result${testResult.ok ? " mcp-test-result--ok" : " mcp-test-result--error"}`}
              >
                {testResult.ok ? "✓" : "✗"} {testResult.message}
              </div>
            )}

            <div className="agent-config__field">
              <label className="agent-config__label">
                连接状态
              </label>
              <div className="mcp-status-bar">
                <span
                  className="mcp-status-indicator"
                  style={{ background: statusColor(selectedStatus?.status) }}
                />
                <span>{statusLabel(selectedStatus?.status)}</span>
                {selectedStatus?.error && (
                  <span className="mcp-status-error">{selectedStatus.error}</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="agent-config__hint">
            尚未添加 MCP 服务器。点击左侧「添加服务器」开始。
          </p>
        )}
      </main>

      <aside className="agent-config__drawer">
        <h3 className="agent-config__drawer-title">已发现工具</h3>
        <div className="agent-config__tool-cards">
          {resolvedTools.length > 0 ? (
            resolvedTools.map((tool) => (
              <div className="agent-config__tool-card" key={tool.name}>
                <div className="agent-config__tool-card-header">
                  <span className="agent-config__tool-card-name">
                    {tool.name}
                  </span>
                  {tool.mutates && (
                    <span className="agent-config__tool-card-badge">写</span>
                  )}
                  <span className="agent-config__tool-card-badge agent-config__tool-card-badge--mcp">
                    MCP
                  </span>
                </div>
                <p className="agent-config__tool-card-desc">
                  {tool.description}
                </p>
                <p className="agent-config__tool-card-meta">
                  来源：{selectedServer?.name || tool.serverId}
                </p>
              </div>
            ))
          ) : (
            <p className="agent-config__hint">
              {!selectedServer?.enabled
                ? "服务器未启用"
                : selectedStatus?.status === "connected"
                  ? "未发现工具"
                  : "请先连接服务器"}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
