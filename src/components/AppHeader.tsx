import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "../hooks/useTheme";
import { Icon } from "./Icon";

interface AppHeaderProps {
  isAiPanelOpen: boolean;
  onExport: (action: "html" | "package" | "pdf" | "rich-text") => void;
  onOpenCommandPalette: () => void;
  onOpenDocument: () => void;
  onOpenWorkspace: () => void;
  onSaveAsDocument: () => void;
  onSaveDocument: () => void;
  onToggleAiPanel: () => void;
  onToggleTheme: () => void;
  theme: Theme;
}

export function AppHeader({
  isAiPanelOpen,
  onExport,
  onOpenCommandPalette,
  onOpenDocument,
  onOpenWorkspace,
  onSaveAsDocument,
  onSaveDocument,
  onToggleAiPanel,
  onToggleTheme,
  theme,
}: AppHeaderProps) {
  const appWindow = getCurrentWindow();

  return (
    <header className="app-header" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand__mark" data-tauri-drag-region>
          M
        </span>
        <div data-tauri-drag-region>
          <strong data-tauri-drag-region>墨览</strong>
          <span data-tauri-drag-region>Markdown Studio</span>
        </div>
      </div>

      <div className="header-actions">
        <button
          aria-label="命令面板"
          className="icon-button"
          onClick={onOpenCommandPalette}
          title="命令面板 (Ctrl+K)"
          type="button"
        >
          <Icon name="search" />
        </button>
        <button
          aria-label="打开工作区"
          className="icon-button"
          onClick={onOpenWorkspace}
          title="打开工作区"
          type="button"
        >
          <Icon name="folder" />
        </button>
        <button
          aria-label="打开文档"
          className="icon-button"
          onClick={onOpenDocument}
          title="打开文档 (Ctrl+O)"
          type="button"
        >
          <Icon name="open" />
        </button>
        <button
          aria-label="保存文档"
          className="icon-button"
          onClick={onSaveDocument}
          title="保存文档 (Ctrl+S)"
          type="button"
        >
          <Icon name="save" />
        </button>
        <button
          className="button button--ghost button--compact"
          onClick={onSaveAsDocument}
          title="另存为 (Ctrl+Shift+S)"
          type="button"
        >
          另存为
        </button>
        <details className="header-export">
          <summary>导出</summary>
          <div className="header-export__menu">
            <button onClick={() => onExport("html")} type="button">
              导出 HTML
            </button>
            <button onClick={() => onExport("pdf")} type="button">
              导出 PDF…
            </button>
            <button onClick={() => onExport("package")} type="button">
              导出完整文档包
            </button>
            <button onClick={() => onExport("rich-text")} type="button">
              复制为富文本
            </button>
          </div>
        </details>
        <button
          aria-label={isAiPanelOpen ? "关闭 AI 面板" : "打开 AI 面板"}
          aria-pressed={isAiPanelOpen}
          className={`button button--ghost button--compact header-ai-button${
            isAiPanelOpen ? " is-active" : ""
          }`}
          onClick={onToggleAiPanel}
          title={isAiPanelOpen ? "关闭 AI 面板" : "打开 AI 面板"}
          type="button"
        >
          <Icon name="ai" size={16} />
          AI
        </button>
        <button
          aria-label={theme === "light" ? "切换到暗色主题" : "切换到明亮主题"}
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === "light" ? "暗色主题" : "明亮主题"}
          type="button"
        >
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
      </div>

      <div className="window-controls">
        <button
          aria-label="最小化窗口"
          onClick={() => void appWindow.minimize()}
          title="最小化"
          type="button"
        >
          <span className="window-control-symbol window-control-symbol--minimize" />
        </button>
        <button
          aria-label="最大化或还原窗口"
          onClick={() => void appWindow.toggleMaximize()}
          title="最大化/还原"
          type="button"
        >
          <span className="window-control-symbol window-control-symbol--maximize" />
        </button>
        <button
          aria-label="关闭窗口"
          className="window-control--close"
          onClick={() => void appWindow.close()}
          title="关闭"
          type="button"
        >
          <span className="window-control-symbol window-control-symbol--close" />
        </button>
      </div>
    </header>
  );
}
