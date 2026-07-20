import type { AiProviderProfile } from "../settings";
import type { ProviderAdapterId, StreamChunk, UnifiedChatRequest } from "../types";

export interface ProviderCapabilities {
  stream: boolean;
  tools: boolean;
}

export interface ProviderDefaults {
  baseUrl: string;
  model: string;
  chatPath?: string;
  /** 设置页提示文案 */
  hint?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

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
