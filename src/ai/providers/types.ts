import type { AiProviderProfile } from "../settings";
import type { ProviderAdapterId, StreamChunk, UnifiedChatRequest } from "../types";

/** Provider 能力声明：是否支持流式、是否支持 function calling。 */
export interface ProviderCapabilities {
  stream: boolean;
  tools: boolean;
}

/** Provider 默认配置值（Base URL、默认模型、提示文案等）。 */
export interface ProviderDefaults {
  baseUrl: string;
  model: string;
  chatPath?: string;
  /** 设置页提示文案 */
  hint?: string;
}

/** Provider 连通性测试结果。 */
export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

/** Provider Adapter 接口：每个厂商实现 chat / testConnection / listModels。 */
export interface ProviderAdapter {
  id: ProviderAdapterId;
  label: string;
  capabilities: ProviderCapabilities;
  defaults: ProviderDefaults;
  chat(
    profile: AiProviderProfile,
    request: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk>;
  testConnection?(
    profile: AiProviderProfile,
    signal?: AbortSignal,
  ): Promise<ProviderTestResult>;
  listModels?(profile: AiProviderProfile): Promise<string[]>;
}
