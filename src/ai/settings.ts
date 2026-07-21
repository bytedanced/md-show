import {
  createProfileId,
  PROVIDER_ADAPTER_IDS,
  type AiMode,
  type ConfirmPolicy,
  type Message,
  type ProviderAdapterId,
} from "./types";

export function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** localStorage 存储键名 */
export const AI_SETTINGS_KEY = "md-show:ai-settings";

/** 单个 AI 供应商的完整配置，可包含多个模型。 */
export interface AiProviderProfile {
  id: string;
  name: string;
  adapter: ProviderAdapterId;
  baseUrl: string;
  apiKey: string;
  models: string[];
  temperature?: number;
  maxTokens?: number;
  chatPath?: string;
  headers?: Record<string, string>;
}

/** AI 全局配置（持久化到 localStorage）。 */
export interface AiSettings {
  enabled: boolean;
  /** 在 AI 面板展示请求拼装结果（不含 API Key）。 */
  debug: boolean;
  /** 在 AI 面板展示工具调用卡片（list_dir / read_file / search_workspace 等）。默认关闭，关闭时仅在 assistant 气泡内嵌简短标记。 */
  showToolCalls: boolean;
  activeProfileId: string;
  activeModel?: string;
  defaultMode: AiMode;
  confirmPolicy: ConfirmPolicy;
  maxToolRounds: number;
  profiles: AiProviderProfile[];
}

/** 预设供应商模板（不含 API Key，用户填写后生成完整 Profile）。 */
export interface ProviderTemplate {
  id: string;
  name: string;
  adapter: ProviderAdapterId;
  baseUrl: string;
  models: string[];
}

/** 预置模板：与各厂商独立 Adapter 一一对应（仅默认 Base URL / 模型名，不填 Key）。 */
export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini"],
  },
  {
    id: "openai-sdk",
    name: "OpenAI SDK 版",
    adapter: "openai-sdk",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    adapter: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat"],
  },
  {
    id: "chatglm",
    name: "智谱 ChatGLM",
    adapter: "chatglm",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash"],
  },
  {
    id: "doubao",
    name: "火山豆包",
    adapter: "doubao",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
  {
    id: "doubao-sdk",
    name: "火山豆包 SDK 版",
    adapter: "doubao-sdk",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    adapter: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["llama3.2"],
  },
  {
    id: "custom",
    name: "自定义",
    adapter: "custom",
    baseUrl: "",
    models: [],
  },
] as const;

/** 单次对话中工具调用的最大轮次数。 */
export const DEFAULT_MAX_TOOL_ROUNDS = 50;

/** 从预设模板创建新的 Provider Profile（不含 API Key）。 */
export function createProfileFromTemplate(
  template: ProviderTemplate,
): AiProviderProfile {
  return {
    id: createProfileId(),
    name: template.name,
    adapter: template.adapter,
    baseUrl: template.baseUrl,
    apiKey: "",
    models: template.models,
  };
}

/** 创建默认 AI 设置（取首个模板，AI 默认关闭）。 */
export function createDefaultAiSettings(): AiSettings {
  const profile = createProfileFromTemplate(PROVIDER_TEMPLATES[0]);
  return {
    enabled: false,
    debug: false,
    showToolCalls: false,
    activeProfileId: profile.id,
    activeModel: getProfileModels(profile)[0],
    defaultMode: "chat",
    confirmPolicy: "always",
    maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
    profiles: [profile],
  };
}

/** 类型收窄：判断值是否为普通对象（非 null、非数组）。 */
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

/** 将旧版 "openai-compatible" adapter id 迁移为 "custom"，保证向前兼容。 */
function migrateAdapterId(value: unknown): ProviderAdapterId | null {
  if (value === "openai-compatible") {
    return "custom";
  }
  return isAdapterId(value) ? value : null;
}

/** 从 Profile 中提取模型列表：优先 models 数组，fallback 到旧版单 model 字段。 */
function normalizeProfileModels(profile: AiProviderProfile): string[] {
  const trimmed = profile.models.map((m) => m.trim()).filter(Boolean);
  return [...new Set(trimmed)];
}

/** 从原始 JSON 值解析 AiProviderProfile，校验必填字段并对旧格式做兼容处理。 */
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
    typeof value.apiKey !== "string"
  ) {
    return null;
  }

  const rawModels = Array.isArray(value.models)
    ? value.models.filter((m): m is string => typeof m === "string")
    : [];

  const profile: AiProviderProfile = {
    id: value.id,
    name: value.name,
    adapter,
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    models: [...new Set(rawModels.map((m) => m.trim()).filter(Boolean))],
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

/** 对原始 localStorage 数据进行校验与标准化，缺失或非法字段回退到默认值。 */
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
    showToolCalls: raw.showToolCalls === true,
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

/** 从 localStorage 加载 AI 设置，首次使用返回默认值。 */
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

/** 将 AI 设置持久化到 localStorage。 */
export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// 聊天会话持久化（多会话支持）
// ---------------------------------------------------------------------------

const SESSIONS_KEY = "md-show:ai-sessions";
const ACTIVE_SESSION_KEY = "md-show:ai-active-session";

export interface ChatSession {
  id: string;
  name: string;
  nameManual: boolean;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

function stripImages(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!m.images?.length) return m;
    const { images, ...rest } = m;
    return { ...rest, images: undefined };
  });
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) return JSON.parse(raw) as ChatSession[];
  } catch { /* ignore */ }
  return [];
}

export function saveSessions(sessions: ChatSession[]): void {
  const slim = sessions.map((s) => ({
    ...s,
    messages: stripImages(s.messages),
  }));
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(slim));
}

export function loadActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

export function saveActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

export function getActiveSession(sessions: ChatSession[]): ChatSession | null {
  const id = loadActiveSessionId();
  return sessions.find((s) => s.id === id) ?? sessions[0] ?? null;
}

/** 获取当前激活的 Provider Profile。 */
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

/** 解析当前实际使用的模型名：优先 activeModel 设置，fallback 到 Profile 首个模型。 */
export function resolveActiveModel(
  settings: AiSettings,
  profile: AiProviderProfile,
): string {
  const models = getProfileModels(profile);
  if (settings.activeModel && models.includes(settings.activeModel)) {
    return settings.activeModel;
  }
  return models[0] ?? "";
}

/** 返回一个 model 已解析到位的 Profile 副本，供 Agent 循环使用。 */
export function withResolvedModel(
  profile: AiProviderProfile,
  model: string,
): AiProviderProfile {
  const models = getProfileModels(profile);
  return {
    ...profile,
    models: [model, ...models.filter((m) => m !== model)],
  };
}

/** 判断 Profile 是否已填写必要信息（Base URL + 模型名）。 */
export function isProfileConfigured(profile: AiProviderProfile): boolean {
  return Boolean(profile.baseUrl.trim() && resolveProfileModel(profile));
}

function resolveProfileModel(profile: AiProviderProfile): string {
  return getProfileModels(profile)[0] ?? "";
}

/** 跨供应商模型选项，用于聊天面板下拉。 */
export interface ModelOption {
  profileId: string;
  profileName: string;
  model: string;
}

/** 从所有 Profile 聚合可用模型列表。 */
export function getAllModelOptions(settings: AiSettings): ModelOption[] {
  const options: ModelOption[] = [];
  for (const profile of settings.profiles) {
    for (const model of getProfileModels(profile)) {
      options.push({
        profileId: profile.id,
        profileName: profile.name,
        model,
      });
    }
  }
  return options;
}
