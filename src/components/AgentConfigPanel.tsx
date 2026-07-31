import { useState } from "react";
import type { AiSettings, McpDiscoveredTool, McpServerStatus } from "../ai";
import { Icon } from "./Icon";
import { McpServersPage } from "./agent/McpServersPage";
import { ModesToolsPage } from "./agent/ModesToolsPage";
import { ProviderModelsPage } from "./agent/ProviderModelsPage";

interface AgentConfigPanelProps {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  onClose: () => void;
  mcpSyncVersion: number;
}

type AgentConfigSection = "modes" | "provider" | "mcp";

interface NavItem {
  id: AgentConfigSection;
  label: string;
  description: string;
  icon: "chat" | "tool";
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "modes",
    label: "模式与工具",
    description: "系统提示词 · 工具编排",
    icon: "chat",
  },
  {
    id: "provider",
    label: "供应商与模型",
    description: "模型列表",
    icon: "tool",
  },
  {
    id: "mcp",
    label: "MCP 服务器",
    description: "外部工具 · 多来源接入",
    icon: "tool",
  },
];

export function AgentConfigPanel({
  aiSettings,
  onAiSettingsChange,
  onClose,
  mcpSyncVersion,
}: AgentConfigPanelProps) {
  const [activeSection, setActiveSection] =
    useState<AgentConfigSection>("modes");

  const [serverStatuses, setServerStatuses] = useState<
    Record<string, { status: McpServerStatus; tools: McpDiscoveredTool[]; error?: string }>
  >({});
  const [testResult, setTestResult] = useState<{
    serverId: string;
    ok: boolean;
    message: string;
  } | null>(null);

  return (
    <div className="agent-config">
      <div className="agent-config__header">
        <button
          className="button button--ghost agent-config__back"
          onClick={onClose}
          type="button"
        >
          <Icon name="chevron" size={14} />
          返回编辑器
        </button>
        <h2 className="agent-config__title">智能体配置</h2>
      </div>

      <div className="agent-config__shell">
        <nav className="agent-config__nav">
          {NAV_ITEMS.map((item) => (
            <button
              className={`agent-config__nav-item${activeSection === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              type="button"
            >
              <span className="agent-config__nav-label">{item.label}</span>
              <span className="agent-config__nav-desc">{item.description}</span>
            </button>
          ))}
        </nav>

        <div className="agent-config__page">
          {activeSection === "modes" ? (
            <ModesToolsPage
              aiSettings={aiSettings}
              onAiSettingsChange={onAiSettingsChange}
              mcpSyncVersion={mcpSyncVersion}
            />
          ) : activeSection === "provider" ? (
            <ProviderModelsPage
              aiSettings={aiSettings}
              onAiSettingsChange={onAiSettingsChange}
            />
          ) : (
            <McpServersPage
              aiSettings={aiSettings}
              onAiSettingsChange={onAiSettingsChange}
              serverStatuses={serverStatuses}
              onServerStatusesChange={setServerStatuses}
              testResult={testResult}
              onTestResultChange={setTestResult}
            />
          )}
        </div>
      </div>
    </div>
  );
}
