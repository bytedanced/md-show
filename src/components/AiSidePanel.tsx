import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { AiChatPanel, type AiDocumentContext } from "./AiChatPanel";
import type { AiSettings, WorkspaceBridge } from "../ai";
import { Icon } from "./Icon";

interface AiSidePanelProps {
  aiSettings: AiSettings;
  document: AiDocumentContext;
  isOpen: boolean;
  isResizing?: boolean;
  onAiSettingsChange: (settings: AiSettings) => void;
  onClose: () => void;
  onDismissActiveDocument: () => void;
  onInsert: (text: string) => void;
  onOpenAgentConfig: () => void;
  onOpenSettings: () => void;
  onRemoveSnippet: (id: string) => void;
  onReplace: (text: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  width: number;
  workspaceBridge: WorkspaceBridge;
}

export function AiSidePanel({
  aiSettings,
  document,
  isOpen,
  isResizing = false,
  onAiSettingsChange,
  onClose,
  onDismissActiveDocument,
  onInsert,
  onOpenAgentConfig,
  onOpenSettings,
  onRemoveSnippet,
  onReplace,
  onResizeStart,
  width,
  workspaceBridge,
}: AiSidePanelProps) {
  if (!isOpen) {
    return null;
  }

  const panelStyle = {
    width: `${width}px`,
    flexShrink: 0,
  } satisfies CSSProperties;

  return (
    <aside
      aria-label="AI 对话"
      className={`ai-side-panel${isResizing ? " is-resizing" : ""}`}
      style={panelStyle}
    >
      <div
        aria-label="调整 AI 面板宽度"
        aria-orientation="vertical"
        aria-valuemax={640}
        aria-valuemin={280}
        aria-valuenow={width}
        className="ai-panel-resizer"
        onPointerDown={onResizeStart}
        role="separator"
        title="拖拽调整宽度"
      />
      <div className="ai-side-panel__header">
        <div className="ai-side-panel__brand">
          <span className="ai-side-panel__icon" aria-hidden="true">
            <Icon name="sparkles" size={16} />
          </span>
          <strong>AI 助手</strong>
        </div>
        <div className="ai-side-panel__toolbar">
          <button
            aria-label={aiSettings.debug ? "关闭调试模式" : "打开调试模式"}
            aria-pressed={aiSettings.debug}
            className={`icon-button ai-side-panel__tool${
              aiSettings.debug ? " is-active" : ""
            }`}
            onClick={() =>
              onAiSettingsChange({
                ...aiSettings,
                debug: !aiSettings.debug,
              })
            }
            title={aiSettings.debug ? "关闭调试模式" : "调试模式"}
            type="button"
          >
            <Icon name="search" size={15} />
          </button>
          <button
            aria-label="AI 设置"
            className="icon-button ai-side-panel__tool"
            onClick={onOpenSettings}
            title="设置"
            type="button"
          >
            <Icon name="settings" size={15} />
          </button>
          <button
            aria-label="关闭 AI 面板"
            className="icon-button ai-side-panel__tool"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
      <div className="ai-side-panel__body">
        <AiChatPanel
          aiSettings={aiSettings}
          document={document}
          onAiSettingsChange={onAiSettingsChange}
          onDismissActiveDocument={onDismissActiveDocument}
          onInsert={onInsert}
          onOpenAgentConfig={onOpenAgentConfig}
          onOpenSettings={onOpenSettings}
          onRemoveSnippet={onRemoveSnippet}
          onReplace={onReplace}
          workspaceBridge={workspaceBridge}
        />
      </div>
    </aside>
  );
}
