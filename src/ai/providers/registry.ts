import type { ProviderAdapterId } from "../types";
import { anthropicAdapter } from "./anthropic";
import { chatglmAdapter } from "./chatglm";
import { customAdapter } from "./custom";
import { deepseekAdapter } from "./deepseek";
import { doubaoAdapter } from "./doubao";
import { ollamaAdapter } from "./ollama";
import { openaiAdapter } from "./openai";
import type { ProviderAdapter } from "./types";

const adapters = new Map<ProviderAdapterId, ProviderAdapter>();

const BUILTIN_ADAPTERS: readonly ProviderAdapter[] = [
  openaiAdapter,
  deepseekAdapter,
  chatglmAdapter,
  doubaoAdapter,
  ollamaAdapter,
  customAdapter,
  anthropicAdapter,
];

function registerBuiltinAdapters(): void {
  if (adapters.size > 0) {
    return;
  }
  for (const adapter of BUILTIN_ADAPTERS) {
    adapters.set(adapter.id, adapter);
  }
}

export function registerProviderAdapter(adapter: ProviderAdapter): void {
  registerBuiltinAdapters();
  adapters.set(adapter.id, adapter);
}

export function getProviderAdapter(
  adapterId: ProviderAdapterId | string,
): ProviderAdapter | null {
  registerBuiltinAdapters();
  return adapters.get(adapterId as ProviderAdapterId) ?? null;
}

export function listProviderAdapters(): ProviderAdapter[] {
  registerBuiltinAdapters();
  return Array.from(adapters.values());
}

/** 设置页可选厂商（暂不展示未准备接入的 Anthropic）。 */
export function listSelectableProviderAdapters(): ProviderAdapter[] {
  return listProviderAdapters().filter(
    (adapter) => adapter.id !== "anthropic",
  );
}

/**
 * A0：各厂商均已注册独立骨架，网络层统一尚未接入。
 * A1 起按厂商逐步将 chat 实现为 true。
 */
export function isAdapterImplemented(adapterId: ProviderAdapterId): boolean {
  return getProviderAdapter(adapterId) !== null && adapterId !== "anthropic";
}
