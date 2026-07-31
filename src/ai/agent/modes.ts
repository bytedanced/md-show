import type { BuiltInMode, CustomMode, ToolChoice } from "../types";

/** 统一模式描述：内置与自定义均用此结构。 */
export interface ModeDefinition {
  id: string;
  label: string;
  toolNames: readonly string[];
  systemPrompt: string | undefined;
  isWrite: boolean;
}

/** Agent Ask 模式的系统提示词（原在 AiChatPanel 硬编码）。 */
const AGENT_ASK_SYSTEM_PROMPT =
  "你是墨览 Markdown 写作助手，当前为 Agent Ask（只读）模式。需要了解工作区内容时，先使用工具再回答，可用工具：\n" +
  "- search_workspace(query)：在工作区内全文搜索某关键字，返回命中文件路径、行号与行预览。用户问「某主题在哪些文档」时优先用它。\n" +
  "- list_dir(path)：列出某目录下的子目录与文本文件。\n" +
  "- read_file(path, offset?, limit?)：读取文件内容，已打开标签会优先返回未保存内容。\n" +
  "引用时标明文件路径与行号。优先输出可直接粘贴的 Markdown。除非用户要求，不要解释过程。";

const BUILTIN_DEFS: Record<BuiltInMode, ModeDefinition> = {
  chat: {
    id: "chat",
    label: "Chat",
    toolNames: [],
    systemPrompt: undefined,
    isWrite: false,
  },
  "agent-ask": {
    id: "agent-ask",
    label: "Agent",
    toolNames: ["list_dir", "read_file", "search_workspace"],
    systemPrompt: AGENT_ASK_SYSTEM_PROMPT,
    isWrite: false,
  },
  "agent-edit": {
    id: "agent-edit",
    label: "Agent Edit",
    toolNames: [
      "list_dir",
      "read_file",
      "search_workspace",
      "edit_file",
      "create_file",
    ],
    systemPrompt: undefined,
    isWrite: true,
  },
};

function isBuiltInMode(mode: string): mode is BuiltInMode {
  return mode === "chat" || mode === "agent-ask" || mode === "agent-edit";
}

/** 按 mode id 解析模式定义：先查内置，再查自定义列表。找不到返回 null。 */
export function getModeDefinition(
  mode: string,
  customModes?: readonly CustomMode[],
): ModeDefinition | null {
  if (isBuiltInMode(mode)) return BUILTIN_DEFS[mode];
  const custom = customModes?.find((cm) => cm.id === mode);
  if (custom) {
    return {
      id: custom.id,
      label: custom.name,
      toolNames: custom.toolNames,
      systemPrompt: custom.systemPrompt || undefined,
      isWrite: custom.write,
    };
  }
  return null;
}

/** 返回该模式下允许暴露给模型的工具名称列表。 */
export function toolsForMode(
  mode: string,
  customModes?: readonly CustomMode[],
): readonly string[] {
  return getModeDefinition(mode, customModes)?.toolNames ?? [];
}

/** 工具数 > 0 返回 "auto"，否则返回 "none"。 */
export function toolChoiceForMode(
  mode: string,
  customModes?: readonly CustomMode[],
): ToolChoice {
  return toolsForMode(mode, customModes).length === 0 ? "none" : "auto";
}

/** 返回模式的 UI 展示标签，未知 mode 回退到 id 本身。 */
export function modeLabel(
  mode: string,
  customModes?: readonly CustomMode[],
): string {
  return getModeDefinition(mode, customModes)?.label ?? mode;
}

/** 当前模式是否为写模式。 */
export function isWriteMode(
  mode: string,
  customModes?: readonly CustomMode[],
): boolean {
  return getModeDefinition(mode, customModes)?.isWrite ?? false;
}

/** 列举所有可用模式（内置 + 自定义），供 UI 下拉菜单使用。 */
export function listAllModes(
  customModes?: readonly CustomMode[],
): ModeDefinition[] {
  const builtins: ModeDefinition[] = Object.values(BUILTIN_DEFS);
  const customs: ModeDefinition[] = (customModes ?? []).map((cm) => ({
    id: cm.id,
    label: cm.name,
    toolNames: cm.toolNames,
    systemPrompt: cm.systemPrompt || undefined,
    isWrite: cm.write,
  }));
  return [...builtins, ...customs];
}
