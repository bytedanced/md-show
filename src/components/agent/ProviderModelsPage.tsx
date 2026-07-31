import { useMemo, useState } from "react";
import {
  PROVIDER_TEMPLATES,
  createProfileFromTemplate,
  getProfileModels,
  resolveActiveModel,
  type AiProviderProfile,
  type AiSettings,
  type ProviderTemplate,
} from "../../ai";
import { Icon } from "../Icon";
import { AiSettingsForm } from "../SettingsDialog";

interface ProviderModelsPageProps {
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
}

function listProfileModels(profile: AiProviderProfile): string[] {
  return profile.models && profile.models.length > 0
    ? profile.models
    : getProfileModels(profile);
}

export function ProviderModelsPage({
  aiSettings,
  onAiSettingsChange,
}: ProviderModelsPageProps) {
  const [adding, setAdding] = useState(false);

  const activeProfile = useMemo(
    () =>
      aiSettings.profiles.find((p) => p.id === aiSettings.activeProfileId) ??
      aiSettings.profiles[0],
    [aiSettings.profiles, aiSettings.activeProfileId],
  );

  const switchProfile = (profileId: string) => {
    const profile = aiSettings.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    onAiSettingsChange({
      ...aiSettings,
      activeProfileId: profile.id,
      activeModel: resolveActiveModel(
        { ...aiSettings, activeProfileId: profile.id },
        profile,
      ),
    });
  };

  const addProfileFromTemplate = (template: ProviderTemplate) => {
    const existing = aiSettings.profiles.find((p) => p.adapter === template.adapter);
    if (existing) {
      switchProfile(existing.id);
      setAdding(false);
      return;
    }
    const newProfile = createProfileFromTemplate(template);
    const models = listProfileModels(newProfile);
    onAiSettingsChange({
      ...aiSettings,
      activeProfileId: newProfile.id,
      activeModel: models[0],
      profiles: [...aiSettings.profiles, newProfile],
    });
    setAdding(false);
  };

  const deleteProfile = (profileId: string) => {
    if (aiSettings.profiles.length <= 1) return;
    const target = aiSettings.profiles.find((p) => p.id === profileId);
    if (!target) return;
    if (!window.confirm(`确定删除供应商「${target.name || target.adapter}」吗？`)) {
      return;
    }
    const next = aiSettings.profiles.filter((p) => p.id !== profileId);
    const needSwitch = profileId === aiSettings.activeProfileId;
    const nextActive = needSwitch ? next[0] : (
      aiSettings.profiles.find((p) => p.id === aiSettings.activeProfileId)!
    );
    onAiSettingsChange({
      ...aiSettings,
      profiles: next,
      activeProfileId: nextActive.id,
      activeModel: resolveActiveModel(
        { ...aiSettings, activeProfileId: nextActive.id },
        nextActive,
      ),
    });
  };

  const availableTemplates = useMemo(
    () =>
      PROVIDER_TEMPLATES.filter(
        (t) => !aiSettings.profiles.some((p) => p.adapter === t.adapter),
      ),
    [aiSettings.profiles],
  );

  if (!activeProfile) {
    return (
      <div className="agent-config__provider">
        <p className="agent-config__hint">没有可用的供应商配置。</p>
      </div>
    );
  }

  return (
    <div className="agent-config__provider-body">
      {/* 左侧栏：供应商列表 */}
      <aside className="agent-config__provider-sidebar">
        <div className="agent-config__provider-list">
          {aiSettings.profiles.map((p) => (
            <button
              className={`agent-config__provider-item${p.id === activeProfile.id ? " is-active" : ""}`}
              key={p.id}
              onClick={() => switchProfile(p.id)}
              type="button"
            >
              <span className="agent-config__provider-item-name">
                {p.name || p.adapter}
              </span>
              <span className="agent-config__provider-item-meta">
                {listProfileModels(p).length === 0
                  ? "无模型"
                  : `${listProfileModels(p).length} 个模型`}
                {p.id === aiSettings.activeProfileId ? " · 当前" : ""}
              </span>
            </button>
          ))}
        </div>

        {adding ? (
          <div className="agent-config__provider-add-menu">
            {availableTemplates.length === 0 ? (
              <span className="agent-config__provider-add-empty">
                所有模板已添加
              </span>
            ) : (
              availableTemplates.map((t) => (
                <button
                  className="agent-config__provider-add-item"
                  key={t.id}
                  onClick={() => addProfileFromTemplate(t)}
                  type="button"
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        ) : (
          <button
            className="button button--ghost agent-config__provider-add-btn"
            onClick={() => setAdding(true)}
            type="button"
          >
            <Icon name="plus" size={14} /> 添加供应商
          </button>
        )}
      </aside>

      {/* 右侧：表单详情 */}
      <main className="agent-config__provider-detail">
        <div className="agent-config__provider-detail-header">
          <h3 className="agent-config__provider-detail-title">
            {activeProfile.name || activeProfile.adapter}
          </h3>
          {aiSettings.profiles.length > 1 && (
            <button
              className="button button--ghost button--sm"
              onClick={() => deleteProfile(activeProfile.id)}
              type="button"
            >
              <Icon name="trash" size={13} /> 删除
            </button>
          )}
        </div>
        <AiSettingsForm
          aiSettings={aiSettings}
          onAiSettingsChange={onAiSettingsChange}
        />
      </main>
    </div>
  );
}
