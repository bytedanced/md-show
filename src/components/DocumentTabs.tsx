import type { DocumentTab } from "../hooks/useWorkspaceManager";
import { Icon } from "./Icon";

interface DocumentTabsProps {
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  tabs: DocumentTab[];
}

export function DocumentTabs({
  activeTabId,
  onActivate,
  onClose,
  onNew,
  tabs,
}: DocumentTabsProps) {
  return (
    <div className="document-tabs" role="tablist" aria-label="打开的文档">
      <div className="document-tabs__scroll">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDirty = tab.content !== tab.savedContent;
          return (
            <div
              className={`document-tab ${isActive ? "is-active" : ""}`}
              key={tab.id}
            >
              <button
                aria-selected={isActive}
                className="document-tab__select"
                onClick={() => onActivate(tab.id)}
                role="tab"
                title={tab.path ?? tab.name}
                type="button"
              >
                <Icon name="file" size={14} />
                <span>{tab.name}</span>
                {isDirty && <i aria-label="未保存" />}
              </button>
              <button
                aria-label={`关闭 ${tab.name}`}
                className="document-tab__close"
                onClick={() => onClose(tab.id)}
                title="关闭 (Ctrl+W)"
                type="button"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        aria-label="新建标签页"
        className="document-tabs__new"
        onClick={onNew}
        type="button"
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}
