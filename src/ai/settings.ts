import {
  createProfileId,
  PROVIDER_ADAPTER_IDS,
  type AiMode,
  type ConfirmPolicy,
  type ProviderAdapterId,
} from "./types";

export const AI_SETTINGS_KEY = "md-show:ai-settings";

export interface AiProviderProfile {
  id: string;
  name: string;
  adapter: ProviderAdapterId;
  baseUrl: string;
  apiKey: string;
  /** @deprecated 使用 models + activeModel；保留以兼容旧配置与 Provider 读取 */
  model: string;
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  chatPath?: string;
  headers?: Record<string, string>;
}

export interface AiSettings {
  enabled: boolean;
  /** 在 AI 面板展示请求拼装结果（不含 API Key）。 */
  debug: boolean;
  activeProfileId: string;
  activeModel?: string;
  defaultMode: AiMode;
  confirmPolicy: ConfirmPolicy;
  maxToolRounds: number;
  profiles: AiProviderProfile[];
}

export interface ProviderTemplate {
  id: string;
  name: string;
  adapter: ProviderAdapterId;
  baseUrl: string;
  model: string;
}

/** 预置模板：与各厂商独立 Adapter 一一对应（仅默认 Base URL / 模型名，不填 Key）。 */
export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    adapter: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    id: "chatglm",
    name: "智谱 ChatGLM",
    adapter: "chatglm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
  },
  {
    id: "doubao",
    name: "火山豆包",
    adapter: "doubao",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
  },
  {
    id: "ollama",
    name: "Ollama",
    adapter: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
  },
  {
    id: "custom",
    name: "自定义",
    adapter: "custom",
    baseUrl: "",
    model: "",
  },
] as const;

export const DEFAULT_MAX_TOOL_ROUNDS = 8;

export function createProfileFromTemplate(
  template: ProviderTemplate,
): AiProviderProfile {
  const models = template.model.trim() ? [template.model.trim()] : [];
  return {
    id: createProfileId(),
    name: template.name,
    adapter: template.adapter,
    baseUrl: template.baseUrl,
    apiKey: "",
    model: template.model,
    models,
  };
}

export function createDefaultAiSettings(): AiSettings {
  const profile = createProfileFromTemplate(PROVIDER_TEMPLATES[0]);
  return {
    enabled: false,
    debug: false,
    activeProfileId: profile.id,
    activeModel: getProfileModels(profile)[0],
    defaultMode: "chat",
    confirmPolicy: "always",
    maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
    profiles: [profile],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAiMode(value: unknown): value is AiMode {
  return value === "chat" || value === "agent-ask" || value === "agent-edit";
}

function isConfirmPolicy(value: unknown): value is ConfirmPolicy {
  return value === "always" || value === "session" || value === "auto";
}

function isAdapterId(value: unknown): value is ProviderAdapterId {
  return (
    typeof value === "string" &&
    (PROVIDER_ADAPTER_IDS as readonly string[]).includes(value)
  );
}

/** 兼容 A0 早期的 openai-compatible 统一适配器 id。 */
function migrateAdapterId(value: unknown): ProviderAdapterId | null {
  if (value === "openai-compatible") {
    return "custom";
  }
  return isAdapterId(value) ? value : null;
}

function normalizeProfileModels(profile: AiProviderProfile): string[] {
  const fromList = (profile.models ?? [])
    .map((model) => model.trim())
    .filter(Boolean);
  if (fromList.length > 0) {
    return [...new Set(fromList)];
  }
  const legacy = profile.model?.trim();
  return legacy ? [legacy] : [];
}

function parseProfile(value: unknown): AiProviderProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const adapter = migrateAdapterId(value.adapter);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !adapter ||
    typeof value.baseUrl !== "string" ||
    typeof value.apiKey !== "string" ||
    typeof value.model !== "string"
  ) {
    return null;
  }

  const rawModels = Array.isArray(value.models)
    ? value.models.filter((model): model is string => typeof model === "string")
    : [];
  const models = normalizeProfileModels({
    id: value.id,
    name: value.name,
    adapter,
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    model: value.model,
    models: rawModels,
  });

  const profile: AiProviderProfile = {
    id: value.id,
    name: value.name,
    adapter,
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    model: models[0] ?? value.model,
    models,
  };

  if (typeof value.temperature === "number") {
    profile.temperature = value.temperature;
  }
  if (typeof value.maxTokens === "number") {
    profile.maxTokens = value.maxTokens;
  }
  if (typeof value.chatPath === "string") {
    profile.chatPath = value.chatPath;
  }
  if (isRecord(value.headers)) {
    const headers: Record<string, string> = {};
    for (const [key, headerValue] of Object.entries(value.headers)) {
      if (typeof headerValue === "string") {
        headers[key] = headerValue;
      }
    }
    profile.headers = headers;
  }

  return profile;
}

export function normalizeAiSettings(raw: unknown): AiSettings {
  const fallback = createDefaultAiSettings();
  if (!isRecord(raw)) {
    return fallback;
  }

  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles
        .map(parseProfile)
        .filter((profile): profile is AiProviderProfile => profile !== null)
    : [];

  if (profiles.length === 0) {
    return fallback;
  }

  const activeProfileId =
    typeof raw.activeProfileId === "string" &&
    profiles.some((profile) => profile.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0].id;

  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const profileModels = getProfileModels(activeProfile);
  const activeModel =
    typeof raw.activeModel === "string" &&
    profileModels.includes(raw.activeModel)
      ? raw.activeModel
      : profileModels[0];

  return {
    enabled: raw.enabled === true,
    debug: raw.debug === true,
    activeProfileId,
    activeModel,
    defaultMode: isAiMode(raw.defaultMode) ? raw.defaultMode : "chat",
    confirmPolicy: isConfirmPolicy(raw.confirmPolicy)
      ? raw.confirmPolicy
      : "always",
    maxToolRounds:
      typeof raw.maxToolRounds === "number" && raw.maxToolRounds > 0
        ? Math.floor(raw.maxToolRounds)
        : DEFAULT_MAX_TOOL_ROUNDS,
    profiles,
  };
}

export function loadAiSettings(): AiSettings {
  try {
    const saved = localStorage.getItem(AI_SETTINGS_KEY);
    if (!saved) {
      return createDefaultAiSettings();
    }
    return normalizeAiSettings(JSON.parse(saved) as unknown);
  } catch {
    return createDefaultAiSettings();
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

export function getActiveProfile(
  settings: AiSettings,
): AiProviderProfile | null {
  return (
    settings.profiles.find(
      (profile) => profile.id === settings.activeProfileId,
    ) ??
    settings.profiles[0] ??
    null
  );
}

export function getProfileModels(profile: AiProviderProfile): string[] {
  return normalizeProfileModels(profile);
}

export function resolveActiveModel(
  settings: AiSettings,
  profile: AiProviderProfile,
): string {
  const models = getProfileModels(profile);
  if (settings.activeModel && models.includes(settings.activeModel)) {
    return settings.activeModel;
  }
  return models[0] ?? profile.model ?? "";
}

export function withResolvedModel(
  profile: AiProviderProfile,
  model: string,
): AiProviderProfile {
  return {
    ...profile,
    model,
    models: getProfileModels(profile),
  };
}

export function isProfileConfigured(profile: AiProviderProfile): boolean {
  return Boolean(profile.baseUrl.trim() && resolveProfileModel(profile));
}

function resolveProfileModel(profile: AiProviderProfile): string {
  return getProfileModels(profile)[0] ?? profile.model.trim();
}
