import type { StreamChunk } from "../types";
import { ProviderNotReadyError } from "./errors";
import type { ProviderAdapter } from "./types";

/**
 * Anthropic Claude（Messages API，与 Chat Completions 不同）。
 * A0 仅占位注册；A4 再实现协议映射与网络层。
 */
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  capabilities: {
    stream: true,
    tools: true,
  },
  defaults: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    hint: "使用 Anthropic API；协议与 OpenAI 不同，后续单独实现",
  },
  async *chat(_profile, _request, _signal): AsyncIterable<StreamChunk> {
    void _profile;
    void _request;
    void _signal;
    yield {
      type: "error",
      error: new ProviderNotReadyError(anthropicAdapter.label).message,
    };
  },
};
