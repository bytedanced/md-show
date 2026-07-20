export {
  buildDocumentContext,
  composeRequestMessages,
  isDuplicateSnippet,
  snippetDisplayName,
  snippetRangeLabel,
  DEFAULT_CONTENT_CHAR_LIMIT,
  DEFAULT_SNIPPETS_CHAR_LIMIT,
  DEFAULT_SYSTEM_PROMPT,
} from "./context";
export type { BuildContextOptions, BuiltContext } from "./context";

export {
  createDefaultAiSettings,
  createProfileFromTemplate,
  getActiveProfile,
  getProfileModels,
  isProfileConfigured,
  loadAiSettings,
  normalizeAiSettings,
  PROVIDER_TEMPLATES,
  resolveActiveModel,
  saveAiSettings,
  withResolvedModel,
  AI_SETTINGS_KEY,
  DEFAULT_MAX_TOOL_ROUNDS,
} from "./settings";
export type {
  AiProviderProfile,
  AiSettings,
  ProviderTemplate,
} from "./settings";

export {
  captureEditorRange,
  getEditorSelection,
  insertAtCursor,
  replaceSelection,
} from "./editorActions";
export type { CapturedEditorRange } from "./editorActions";

export {
  createMessageId,
  createProfileId,
  createSnippetId,
  PROVIDER_ADAPTER_IDS,
} from "./types";
export type {
  AiMode,
  ConfirmPolicy,
  ContextSnippet,
  DocumentContextInput,
  FileChange,
  JsonSchema,
  Message,
  MessageRole,
  OpenTabSnapshot,
  ProviderAdapterId,
  StreamChunk,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  ToolResult,
  UnifiedChatRequest,
} from "./types";

export { runAgentLoop } from "./agent/loop";
export type { AgentEvent, AgentLoopOptions } from "./agent/loop";
export {
  isWriteMode,
  modeLabel,
  toolChoiceForMode,
  toolsForMode,
} from "./agent/modes";

export {
  getProviderAdapter,
  isAdapterImplemented,
  listProviderAdapters,
  listSelectableProviderAdapters,
  registerProviderAdapter,
} from "./providers/registry";
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderDefaults,
  ProviderTestResult,
} from "./providers/types";
export { ProviderNotReadyError } from "./providers/errors";
export { openaiAdapter } from "./providers/openai";
export { deepseekAdapter } from "./providers/deepseek";
export { chatglmAdapter } from "./providers/chatglm";
export { doubaoAdapter } from "./providers/doubao";
export { ollamaAdapter } from "./providers/ollama";
export { customAdapter } from "./providers/custom";
export { anthropicAdapter } from "./providers/anthropic";

export {
  clearTools,
  executeTool,
  getTool,
  listTools,
  registerTool,
  resolveToolsForMode,
  unregisterTool,
} from "./tools/registry";
export type { ToolContext, ToolHandler } from "./tools/types";
export { defineTool, toToolDefinition } from "./tools/types";
export {
  BUILTIN_TOOLS,
  ensureBuiltinToolsRegistered,
  listBuiltinToolNames,
} from "./tools/builtins";

export {
  createWorkspaceBridge,
  toFsPath,
} from "./workspace/bridge";
export type {
  WorkspaceBridge,
  WorkspaceBridgeDeps,
  WorkspaceDirEntry,
  WorkspaceFsEntry,
  WorkspaceReadOptions,
  WorkspaceReadResult,
} from "./workspace/bridge";
export {
  DEFAULT_MAX_DIR_ENTRIES,
  DEFAULT_MAX_READ_CHARS,
  DEFAULT_MAX_READ_LINES,
  IGNORED_DIRECTORY_NAMES,
} from "./workspace/limits";

export {
  assertInsideWorkspace,
  assertReadableTextPath,
  getExtension,
  isAbsolutePath,
  isTextExtensionAllowed,
  normalizePath,
  PathPolicyError,
  resolveWorkspacePath,
  TEXT_EXTENSION_WHITELIST,
} from "./safety/pathPolicy";
export type { PathPolicyErrorCode } from "./safety/pathPolicy";
export {
  createConfirmPolicyState,
  decideWrite,
  revokeSessionTrust,
  trustSession,
} from "./safety/confirmPolicy";
export type { ConfirmPolicyState, WriteDecision } from "./safety/confirmPolicy";
