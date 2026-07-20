import type { AiMode, ToolChoice } from "../types";

/** 各模式下允许暴露给模型的工具名（即使尚未注册具体 handler）。 */
const MODE_TOOL_NAMES: Record<AiMode, readonly string[]> = {
  chat: [],
  "agent-ask": ["list_dir", "read_file", "search_workspace"],
  "agent-edit": [
    "list_dir",
    "read_file",
    "search_workspace",
    "edit_file",
    "create_file",
  ],
};

export function toolsForMode(mode: AiMode): readonly string[] {
  return MODE_TOOL_NAMES[mode];
}

export function toolChoiceForMode(mode: AiMode): ToolChoice {
  return mode === "chat" ? "none" : "auto";
}

export function modeLabel(mode: AiMode): string {
  switch (mode) {
    case "chat":
      return "Chat";
    case "agent-ask":
      return "Agent Ask";
    case "agent-edit":
      return "Agent Edit";
  }
}

export function isWriteMode(mode: AiMode): boolean {
  return mode === "agent-edit";
}
