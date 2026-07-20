import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROVIDER_TEMPLATES,
  getActiveProfile,
  getProfileModels,
  getProviderAdapter,
  isProfileConfigured,
  resolveActiveModel,
  withResolvedModel,
  type AiProviderProfile,
  type AiSettings,
  type ProviderAdapterId,
} from "../ai";
import type { PreviewTheme } from "./MarkdownPreview";

export type SettingsTab = "help" | "preview" | "ai";

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 22;
export const DEFAULT_EDITOR_FONT_SIZE = 12;
export const DEFAULT_PREVIEW_FONT_SIZE = 13;
export const DEFAULT_PREVIEW_THEME: PreviewTheme = "paper";
export const DEFAULT_CUSTOM_CSS = "";

const AI_SETTINGS_PERSIST_DEBOUNCE_MS = 300;

function listProfileModels(profile: AiProviderProfile): string[] {
  return profile.models && profile.models.length > 0
    ? profile.models
    : getProfileModels(profile);
}

function createModelSlotKey(): string {
  return `model-${crypto.randomUUID()}`;
}

function createModelSlotKeys(count: number): string[] {
  return Array.from({ length: count }, () => createModelSlotKey());
}

interface SettingsDialogProps {
  aiSettings: AiSettings;
  customCss: string;
  editorFontSize: number;
  isOpen: boolean;
  onAiSettingsChange: (settings: AiSettings) => void;
  onClose: () => void;
  onCustomCssChange: (value: string) => void;
  onEditorFontSizeChange: (size: number) => void;
  onPreviewFontSizeChange: (size: number) => void;
  onPreviewThemeChange: (theme: PreviewTheme) => void;
  onResetAppearance: () => void;
  onTabChange: (tab: SettingsTab) => void;
  previewFontSize: number;
  previewTheme: PreviewTheme;
  tab: SettingsTab;
}

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl+K / Ctrl+Shift+P", action: "打开命令面板" },
  { keys: "Ctrl+N", action: "新建文档" },
  { keys: "Ctrl+O", action: "打开文档" },
  { keys: "Ctrl+S", action: "保存文档" },
  { keys: "Ctrl+Shift+S", action: "另存为" },
  { keys: "Ctrl+W", action: "关闭当前标签" },
  { keys: "Ctrl+1", action: "仅编辑模式" },
  { keys: "Ctrl+2", action: "分栏模式" },
  { keys: "Ctrl+3", action: "仅预览模式" },
  { keys: "Ctrl+=", action: "增大编辑区与预览区字号" },
  { keys: "Ctrl+-", action: "减小编辑区与预览区字号" },
  { keys: "Ctrl+0", action: "恢复默认字号" },
  { keys: "Ctrl+F", action: "当前文档查找（编辑器内）" },
  { keys: "Ctrl+H", action: "当前文档替换（编辑器内）" },
  { keys: "Ctrl+L", action: "将选区（或当前行）加入 AI 上下文" },
];

function FontSizeField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (size: number) => void;
  value: number;
}) {
  return (
    <label className="settings-field settings-field--range">
      <span>{label}</span>
      <div className="settings-field__range">
        <input
          aria-label={label}
          max={FONT_SIZE_MAX}
          min={FONT_SIZE_MIN}
          onChange={(event) => onChange(Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
        <output>{value}px</output>
      </div>
    </label>
  );
}

function updateActiveProfile(
  settings: AiSettings,
  patch: Partial<AiProviderProfile>,
): AiSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) =>
      profile.id === settings.activeProfileId
        ? { ...profile, ...patch }
        : profile,
    ),
  };
}

function AiSettingsForm({
  aiSettings,
  onAiSettingsChange,
}: {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
}) {
  const [draft, setDraft] = useState(aiSettings);
  const draftRef = useRef(aiSettings);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modelKeys, setModelKeys] = useState(() => {
    const profile = getActiveProfile(aiSettings);
    return createModelSlotKeys(
      profile ? listProfileModels(profile).length : 0,
    );
  });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const clearPersistTimer = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  const persistNow = useCallback(
    (next: AiSettings) => {
      clearPersistTimer();
      draftRef.current = next;
      setDraft(next);
      onAiSettingsChange(next);
    },
    [clearPersistTimer, onAiSettingsChange],
  );

  const schedulePersist = useCallback(
    (next: AiSettings) => {
      draftRef.current = next;
      setDraft(next);
      clearPersistTimer();
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        onAiSettingsChange(draftRef.current);
      }, AI_SETTINGS_PERSIST_DEBOUNCE_MS);
    },
    [clearPersistTimer, onAiSettingsChange],
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        onAiSettingsChange(draftRef.current);
      }
    };
  }, [onAiSettingsChange]);

  const profile = getActiveProfile(draft);
  if (!profile) {
    return <p className="settings-field small">没有可用的 AI 配置。</p>;
  }

  const profileModels = listProfileModels(profile);
  const adapter = getProviderAdapter(profile.adapter);
  const hint = adapter?.defaults.hint;

  const applyTemplate = (templateId: string) => {
    const template = PROVIDER_TEMPLATES.find(
      (item) => item.id === templateId || item.adapter === templateId,
    );
    if (!template) {
      return;
    }
    const models = template.model.trim() ? [template.model.trim()] : [""];
    setModelKeys(createModelSlotKeys(models.length));
    persistNow({
      ...updateActiveProfile(draft, {
        name: template.name,
        adapter: template.adapter,
        baseUrl: template.baseUrl,
        model: template.model,
        models,
        chatPath: undefined,
      }),
      activeModel: template.model.trim() || undefined,
    });
    setTestMessage(null);
  };

  const testConnection = async () => {
    const currentAdapter = getProviderAdapter(profile.adapter);
    if (!currentAdapter?.testConnection) {
      setTestMessage("当前供应商不支持测试连接。");
      return;
    }
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await currentAdapter.testConnection(
        withResolvedModel(profile, resolveActiveModel(draft, profile)),
      );
      setTestMessage(result.message);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const syncProfileModels = (
    models: string[],
    nextKeys: string[],
    persist: (next: AiSettings) => void,
  ) => {
    const configured = models.map((model) => model.trim()).filter(Boolean);
    setModelKeys(nextKeys);
    persist({
      ...updateActiveProfile(draft, {
        models,
        model: configured[0] ?? "",
      }),
      activeModel:
        draft.activeModel && configured.includes(draft.activeModel)
          ? draft.activeModel
          : configured[0],
    });
  };

  const addModelField = () => {
    syncProfileModels(
      [...profileModels, ""],
      [...modelKeys, createModelSlotKey()],
      schedulePersist,
    );
  };

  const updateModelAt = (index: number, value: string) => {
    const next = [...profileModels];
    next[index] = value;
    syncProfileModels(next, modelKeys, schedulePersist);
  };

  const removeModelAt = (index: number) => {
    syncProfileModels(
      profileModels.filter((_, itemIndex) => itemIndex !== index),
      modelKeys.filter((_, itemIndex) => itemIndex !== index),
      persistNow,
    );
  };

  return (
    <div className="settings-ai-form">
      <label className="settings-field settings-field--checkbox">
        <input
          checked={draft.enabled}
          onChange={(event) =>
            persistNow({
              ...draft,
              enabled: event.target.checked,
            })
          }
          type="checkbox"
        />
        <span>启用 AI</span>
      </label>

      <label className="settings-field settings-field--checkbox">
        <input
          checked={draft.debug}
          onChange={(event) =>
            persistNow({
              ...draft,
              debug: event.target.checked,
            })
          }
          type="checkbox"
        />
        <span>调试模式</span>
      </label>
      <small className="settings-ai-form__debug-hint">
        开启后在 AI 面板查看请求消息拼装结果（不含 API Key）。
      </small>

      <label className="settings-field">
        <span>默认模式</span>
        <select
          onChange={(event) =>
            persistNow({
              ...draft,
              defaultMode: event.target.value as AiSettings["defaultMode"],
            })
          }
          value={draft.defaultMode === "agent-edit" ? "agent-ask" : draft.defaultMode}
        >
          <option value="chat">Chat</option>
          <option value="agent-ask">Agent Ask</option>
        </select>
      </label>

      <label className="settings-field">
        <span>供应商模板</span>
        <select
          onChange={(event) => applyTemplate(event.target.value)}
          value={profile.adapter}
        >
          {PROVIDER_TEMPLATES.map((template) => (
            <option key={template.id} value={template.adapter}>
              {template.name}
            </option>
          ))}
        </select>
        {hint && <small>{hint}</small>}
      </label>

      <label className="settings-field">
        <span>配置名称</span>
        <input
          onChange={(event) =>
            schedulePersist(
              updateActiveProfile(draft, { name: event.target.value }),
            )
          }
          type="text"
          value={profile.name}
        />
      </label>

      <label className="settings-field">
        <span>Base URL</span>
        <input
          onChange={(event) =>
            schedulePersist(
              updateActiveProfile(draft, { baseUrl: event.target.value }),
            )
          }
          placeholder="https://api.example.com/v1"
          type="url"
          value={profile.baseUrl}
        />
      </label>

      <label className="settings-field">
        <span>API Key</span>
        <div className="settings-field__inline">
          <input
            autoComplete="off"
            onChange={(event) =>
              schedulePersist(
                updateActiveProfile(draft, { apiKey: event.target.value }),
              )
            }
            placeholder={profile.adapter === "ollama" ? "可选" : "sk-…"}
            type={showKey ? "text" : "password"}
            value={profile.apiKey}
          />
          <button
            className="button button--ghost"
            onClick={() => setShowKey((value) => !value)}
            type="button"
          >
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
      </label>

      <div className="settings-field">
        <span>模型列表</span>
        <div className="settings-model-list">
          {profileModels.map((model, index) => (
            <div
              className="settings-model-list__item"
              key={modelKeys[index] ?? `model-fallback-${index}`}
            >
              <input
                onChange={(event) => updateModelAt(index, event.target.value)}
                placeholder={
                  profile.adapter === "doubao" ? "ep-xxxxxxxx" : "模型 ID"
                }
                type="text"
                value={model}
              />
              <button
                className="button button--ghost"
                disabled={profileModels.length <= 1}
                onClick={() => removeModelAt(index)}
                type="button"
              >
                删除
              </button>
            </div>
          ))}
          <button
            className="button button--ghost settings-model-list__add"
            onClick={addModelField}
            type="button"
          >
            添加模型
          </button>
        </div>
        <small>同一供应商可配置多个模型，在 AI 助手面板中切换使用。</small>
      </div>

      <label className="settings-field">
        <span>Chat 路径（可选）</span>
        <input
          onChange={(event) =>
            schedulePersist(
              updateActiveProfile(draft, {
                chatPath: event.target.value || undefined,
              }),
            )
          }
          placeholder="/chat/completions"
          type="text"
          value={profile.chatPath ?? ""}
        />
      </label>

      <div className="settings-ai-form__actions">
        <button
          className="button button--secondary"
          disabled={testing || !isProfileConfigured(profile)}
          onClick={() => void testConnection()}
          type="button"
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        {testMessage && <small>{testMessage}</small>}
      </div>

      <small className="settings-ai-form__note">
        适配器类型：{(profile.adapter as ProviderAdapterId) || "custom"}
        。A1 使用前端 fetch；若遇 CORS，可改用本地 Ollama，或后续接入 Tauri HTTP
        代理。
      </small>
    </div>
  );
}

export function SettingsDialog({
  aiSettings,
  customCss,
  editorFontSize,
  isOpen,
  onAiSettingsChange,
  onClose,
  onCustomCssChange,
  onEditorFontSizeChange,
  onPreviewFontSizeChange,
  onPreviewThemeChange,
  onResetAppearance,
  onTabChange,
  previewFontSize,
  previewTheme,
  tab,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isAppearanceDefault =
    editorFontSize === DEFAULT_EDITOR_FONT_SIZE &&
    previewFontSize === DEFAULT_PREVIEW_FONT_SIZE &&
    previewTheme === DEFAULT_PREVIEW_THEME &&
    customCss === DEFAULT_CUSTOM_CSS;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && !dialog?.open) {
      dialog?.showModal();
    } else if (!isOpen && dialog?.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      aria-labelledby="settings-dialog-title"
      className="dialog settings-dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="settings-dialog__header">
        <div>
          <span>应用</span>
          <h2 id="settings-dialog-title">设置</h2>
        </div>
        <button
          aria-label="关闭设置"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="settings-dialog__tabs" role="tablist">
        <button
          aria-selected={tab === "help"}
          className={tab === "help" ? "is-active" : ""}
          onClick={() => onTabChange("help")}
          role="tab"
          type="button"
        >
          使用说明
        </button>
        <button
          aria-selected={tab === "preview"}
          className={tab === "preview" ? "is-active" : ""}
          onClick={() => onTabChange("preview")}
          role="tab"
          type="button"
        >
          外观
        </button>
        <button
          aria-selected={tab === "ai"}
          className={tab === "ai" ? "is-active" : ""}
          onClick={() => onTabChange("ai")}
          role="tab"
          type="button"
        >
          AI
        </button>
      </div>

      <div className="settings-dialog__body">
        {tab === "help" ? (
          <div className="help-guide">
            <section>
              <h3>快速上手</h3>
              <ul>
                <li>通过顶栏或侧边栏打开文件夹，即可管理整个 Markdown 工作区。</li>
                <li>支持多标签编辑；未保存内容关闭前会提示，并支持自动保存与崩溃恢复。</li>
                <li>
                  右上角可切换「编辑 / 分栏 / 预览」；分栏下可开启「同步滚动」，两侧按源码行对齐。
                </li>
                <li>将图片、视频或音频拖入编辑区，会复制到文档目录的 assets 并插入语法。</li>
                <li>顶栏「导出」可输出 HTML、PDF、完整文档包，或复制为富文本。</li>
              </ul>
            </section>

            <section>
              <h3>侧边栏</h3>
              <ul>
                <li>
                  <strong>文件</strong>：目录树，支持新建、重命名、删除、拖拽移动与右键菜单。
                </li>
                <li>
                  <strong>工作区</strong>：收藏与最近打开的工作区快捷切换。
                </li>
                <li>
                  <strong>搜索</strong>：在工作区内全文搜索并跳转到匹配行。
                </li>
                <li>
                  <strong>大纲</strong>：按标题跳转当前文档位置。
                </li>
                <li>
                  <strong>AI</strong>：右侧对话面板（顶栏 AI 按钮开关）；在「设置 → AI」中配置供应商。
                </li>
              </ul>
            </section>

            <section>
              <h3>命令面板</h3>
              <p>
                按 <kbd>Ctrl+K</kbd> 打开命令面板，可搜索并执行新建、保存、切换视图、导出等操作，无需在菜单中逐层查找。
              </p>
            </section>

            <section>
              <h3>常用快捷键</h3>
              <div className="help-guide__shortcuts">
                {SHORTCUTS.map((item) => (
                  <div className="help-guide__shortcut" key={item.keys}>
                    <kbd>{item.keys}</kbd>
                    <span>{item.action}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>扩展语法</h3>
              <ul>
                <li>标准 Markdown、表格、任务列表、脚注、数学公式、Mermaid 图表。</li>
                <li>
                  媒体扩展：<code>@[video](路径)</code>、<code>@[audio](路径)</code>，也支持 HTML
                  video / audio。
                </li>
                <li>
                  文档开头可使用 YAML Front Matter；字号、预览主题与自定义 CSS 可在「外观」中配置。
                </li>
              </ul>
            </section>
          </div>
        ) : tab === "preview" ? (
          <div className="settings-preview-form">
            <div className="settings-font-row">
              <FontSizeField
                label="编辑区字号"
                onChange={onEditorFontSizeChange}
                value={editorFontSize}
              />
              <FontSizeField
                label="预览区字号"
                onChange={onPreviewFontSizeChange}
                value={previewFontSize}
              />
            </div>
            <label className="settings-field">
              <span>预览主题</span>
              <select
                onChange={(event) =>
                  onPreviewThemeChange(event.target.value as PreviewTheme)
                }
                value={previewTheme}
              >
                <option value="paper">纸张</option>
                <option value="midnight">午夜</option>
                <option value="sepia">复古</option>
                <option value="ocean">海洋</option>
              </select>
            </label>
            <label className="settings-field">
              <span>自定义 CSS</span>
              <textarea
                onChange={(event) => onCustomCssChange(event.target.value)}
                placeholder=".markdown-preview h1 { color: #2563eb; }"
                value={customCss}
              />
              <small>样式将自动保存，并应用于预览和 HTML 导出。</small>
            </label>
          </div>
        ) : isOpen ? (
          <AiSettingsForm
            aiSettings={aiSettings}
            onAiSettingsChange={onAiSettingsChange}
          />
        ) : null}
      </div>

      <div className="dialog__actions settings-dialog__actions">
        {tab === "preview" && (
          <button
            className="button button--ghost"
            disabled={isAppearanceDefault}
            onClick={onResetAppearance}
            type="button"
          >
            恢复默认
          </button>
        )}
        <button className="button button--ghost" onClick={onClose} type="button">
          关闭
        </button>
      </div>
    </dialog>
  );
}
