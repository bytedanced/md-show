import { useMemo, useState } from "react";
import {
  getTool,
  listAllModes,
  listBuiltinToolNames,
  listTools,
  mcpToolDisplayName,
  mcpToolSource,
  type AiSettings,
  type CustomMode,
} from "../../ai";
import { Icon } from "../Icon";

interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  mutates: boolean;
  source: "builtin" | "mcp";
  sourceLabel: string;
}

function getAllAvailableTools(): ToolInfo[] {
  const tools: ToolInfo[] = [];
  const seen = new Set<string>();

  for (const name of listBuiltinToolNames()) {
    const handler = getTool(name);
    tools.push({
      name,
      displayName: name,
      description: handler?.description ?? "",
      mutates: handler?.mutates ?? false,
      source: "builtin",
      sourceLabel: "内置",
    });
    seen.add(name);
  }

  for (const handler of listTools()) {
    if (seen.has(handler.name)) continue;
    const serverName = mcpToolSource(handler.name);
    const displayName = mcpToolDisplayName(handler.name) ?? handler.name;
    tools.push({
      name: handler.name,
      displayName,
      description: handler.description,
      mutates: handler.mutates,
      source: "mcp",
      sourceLabel: serverName || "MCP",
    });
    seen.add(handler.name);
  }

  return tools;
}

function createEmptyCustomMode(): CustomMode {
  return {
    id: crypto.randomUUID(),
    name: "",
    toolNames: [],
    systemPrompt: "",
    write: false,
  };
}

interface ModesToolsPageProps {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  mcpSyncVersion: number;
}

export function ModesToolsPage({
  aiSettings,
  onAiSettingsChange,
  mcpSyncVersion,
}: ModesToolsPageProps) {
  const [selectedId, setSelectedId] = useState<string>(
    () => aiSettings.defaultMode,
  );
  const allTools = useMemo(
    () => getAllAvailableTools(),
    [aiSettings.mcpServers, mcpSyncVersion],
  );
  const allModes = useMemo(
    () => listAllModes(aiSettings.customModes),
    [aiSettings.customModes],
  );

  const selectedMode = allModes.find((m) => m.id === selectedId) ?? allModes[0];
  const isBuiltIn = selectedMode && (
    selectedMode.id === "chat" ||
    selectedMode.id === "agent-ask" ||
    selectedMode.id === "agent-edit"
  );
  const isCustom = selectedMode && !isBuiltIn;

  const customMode = isCustom
    ? aiSettings.customModes.find((cm) => cm.id === selectedId) ?? null
    : null;

  const updateCustomMode = (id: string, patch: Partial<CustomMode>) => {
    onAiSettingsChange({
      ...aiSettings,
      customModes: aiSettings.customModes.map((cm) =>
        cm.id === id ? { ...cm, ...patch } : cm,
      ),
    });
  };

  const addCustomMode = () => {
    const newMode = createEmptyCustomMode();
    onAiSettingsChange({
      ...aiSettings,
      customModes: [...aiSettings.customModes, newMode],
    });
    setSelectedId(newMode.id);
  };

  const deleteCustomMode = () => {
    if (!customMode) return;
    const next = aiSettings.customModes.filter((cm) => cm.id !== customMode.id);
    onAiSettingsChange({
      ...aiSettings,
      customModes: next,
      defaultMode:
        aiSettings.defaultMode === customMode.id
          ? "chat"
          : aiSettings.defaultMode,
    });
    setSelectedId("chat");
  };

  const toggleTool = (toolName: string) => {
    if (!customMode) return;
    const has = customMode.toolNames.includes(toolName);
    const next = has
      ? customMode.toolNames.filter((t) => t !== toolName)
      : [...customMode.toolNames, toolName];
    updateCustomMode(customMode.id, { toolNames: next });
  };

  const isToolSelected = (toolName: string) => {
    return selectedMode?.toolNames.includes(toolName) ?? false;
  };

  return (
    <div className="agent-config__body">
      {/* 左侧栏：模式列表 */}
      <aside className="agent-config__sidebar">
        <div className="agent-config__mode-list">
          {allModes.map((m) => (
            <button
              className={`agent-config__mode-item${m.id === selectedId ? " is-active" : ""}`}
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              type="button"
            >
              <span className="agent-config__mode-name">{m.label}</span>
              <span className="agent-config__mode-meta">
                {m.toolNames.length === 0
                  ? "无工具"
                  : `${m.toolNames.length} 个工具`}
                {m.isWrite ? " · 可写" : ""}
              </span>
            </button>
          ))}
        </div>
        <button
          className="button button--ghost agent-config__add-mode"
          onClick={addCustomMode}
          type="button"
        >
          <Icon name="plus" size={14} /> 添加模式
        </button>
      </aside>

      {/* 中间：详情编辑区 */}
      <main className="agent-config__detail">
        {selectedMode && (
          <>
            <div className="agent-config__field">
              <label className="agent-config__label">模式名称</label>
              {isBuiltIn ? (
                <input
                  className="agent-config__input"
                  disabled
                  type="text"
                  value={selectedMode.label}
                />
              ) : (
                <input
                  className="agent-config__input"
                  onChange={(e) =>
                    customMode &&
                    updateCustomMode(customMode.id, { name: e.target.value })
                  }
                  placeholder="输入模式名称"
                  type="text"
                  value={customMode?.name ?? ""}
                />
              )}
            </div>

            <label className="agent-config__checkbox">
              <input
                checked={selectedMode.isWrite}
                disabled={isBuiltIn}
                onChange={(e) =>
                  customMode &&
                  updateCustomMode(customMode.id, { write: e.target.checked })
                }
                type="checkbox"
              />
              <span>可修改工作区文件（Write Mode）</span>
            </label>

            <div className="agent-config__field">
              <label className="agent-config__label">
                已选工具
              </label>
              {selectedMode.toolNames.length === 0 ? (
                <p className="agent-config__hint">尚未选择工具，从右侧抽屉添加。</p>
              ) : (
                <div className="agent-config__selected-tools">
                  {selectedMode.toolNames.map((name) => {
                    const tool = allTools.find(t => t.name === name);
                    return (
                      <div className="agent-config__selected-tool-item" key={name}>
                        <div className="agent-config__selected-tool-info">
                          <span className="agent-config__selected-tool-name">
                            {tool?.displayName ?? name}
                            {tool?.mutates && (
                              <span className="agent-config__tool-card-badge">写</span>
                            )}
                            {tool?.source === "mcp" && (
                              <span className="agent-config__tool-card-badge agent-config__tool-card-badge--mcp">
                                {tool.sourceLabel}
                              </span>
                            )}
                          </span>
                          {tool?.description && (
                            <p className="agent-config__selected-tool-desc">
                              {tool.description}
                            </p>
                          )}
                        </div>
                        {isCustom && (
                          <button
                            aria-label={`移除 ${name}`}
                            className="agent-config__selected-tool-remove"
                            onClick={() => toggleTool(name)}
                            type="button"
                          >
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="agent-config__field">
              <label className="agent-config__label">系统提示词</label>
              <textarea
                className="agent-config__textarea"
                disabled={isBuiltIn}
                onChange={(e) =>
                  customMode &&
                  updateCustomMode(customMode.id, {
                    systemPrompt: e.target.value,
                  })
                }
                placeholder={
                  isBuiltIn
                    ? selectedMode.systemPrompt || "（使用默认系统提示词）"
                    : "输入自定义系统提示词（留空则使用默认）"
                }
                rows={8}
                value={
                  isBuiltIn
                    ? selectedMode.systemPrompt ?? ""
                    : customMode?.systemPrompt ?? ""
                }
              />
            </div>

            {isCustom && (
              <button
                className="button button--secondary agent-config__delete"
                onClick={deleteCustomMode}
                type="button"
              >
                <Icon name="trash" size={14} /> 删除此模式
              </button>
            )}
          </>
        )}
      </main>

      {/* 右侧：工具抽屉 */}
      <aside className="agent-config__drawer">
        <h3 className="agent-config__drawer-title">可用工具</h3>
        <div className="agent-config__tool-cards">
          {allTools.map((tool) => {
            const selected = isToolSelected(tool.name);
            return (
              <div
                className={`agent-config__tool-card${selected ? " is-selected" : ""}`}
                key={tool.name}
              >
                <div className="agent-config__tool-card-header">
                  <span className="agent-config__tool-card-name">
                    {tool.displayName}
                  </span>
                  {tool.mutates && (
                    <span className="agent-config__tool-card-badge">写</span>
                  )}
                  {tool.source === "mcp" && (
                    <span className="agent-config__tool-card-badge agent-config__tool-card-badge--mcp">
                      {tool.sourceLabel}
                    </span>
                  )}
                </div>
                <p className="agent-config__tool-card-desc">
                  {tool.description}
                </p>
                {isCustom ? (
                  <button
                    className={`button button--sm${selected ? " button--secondary" : " button--primary"}`}
                    disabled={selected}
                    onClick={() => toggleTool(tool.name)}
                    type="button"
                  >
                    {selected ? "已添加" : "添加"}
                  </button>
                ) : (
                  <span className="agent-config__tool-card-status">
                    {selected ? "已启用" : "未启用"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
