import { useEffect, useMemo, useRef, useState } from "react";
import {
  composeRequestMessages,
  createMessageId,
  createSessionId,
  getActiveProfile,
  getAllModelOptions,
  getActiveSession,
  getModeDefinition,
  isProfileConfigured,
  listAllModes,
  loadSessions,
  modeLabel,
  resolveActiveModel,
  runAgentLoop,
  saveActiveSessionId,
  saveSessions,
  snippetDisplayName,
  snippetRangeLabel,
  toolsForMode,
  withResolvedModel,
  type AiSettings,
  type ChatSession,
  type ContextSnippet,
  type FileChange,
  type Message,
  type ModelOption,
  type ReasoningEffort,
  type WorkspaceBridge,
} from "../ai";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { AiDebugPanel } from "./AiDebugPanel";
import { AiMarkdown } from "./AiMarkdown";
import { Icon } from "./Icon";

/** 当前编辑器文档的上下文信息，包括路径、内容、选区、大纲和显式片段。 */
export interface AiDocumentContext {
  path: string | null;
  content: string;
  /** 编辑器当前选区，仅用于「替换选区」按钮可用性 */
  selection: string;
  outline: string[];
  snippets: ContextSnippet[];
  includeActiveDocument: boolean;
}

interface AiChatPanelProps {
  aiSettings: AiSettings;
  document: AiDocumentContext;
  onAiSettingsChange: (settings: AiSettings) => void;
  onDismissActiveDocument: () => void;
  onInsert: (text: string) => void;
  onOpenAgentConfig: () => void;
  onOpenSettings: () => void;
  onRemoveSnippet: (id: string) => void;
  onReplace: (text: string) => void;
  workspaceBridge: WorkspaceBridge;
}

/** 助手气泡内的渲染块：思考过程、正文文本、工具调用卡片。 */
type BubbleBlock =
  | { type: "thinking"; text: string; expanded: boolean }
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: string; status: "running" | "ok" | "error"; result?: string; expanded?: boolean };

/** 对话列表中的单条气泡（用户 or 助手）。 */
interface ChatBubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  blocks?: BubbleBlock[];
  images?: string[];
}

const QUICK_PROMPTS = [
  "总结当前文档要点",
  "润色选中内容",
  "补充一段引言",
  "检查语法和表达",
];

/** AI 对话面板主组件：管理气泡列表、流式渲染、工具调用展示与用户操作。 */
export function AiChatPanel({
  aiSettings,
  document,
  onAiSettingsChange,
  onDismissActiveDocument,
  onInsert,
  onOpenAgentConfig,
  onOpenSettings,
  onRemoveSnippet,
  onReplace,
  workspaceBridge,
}: AiChatPanelProps) {
  /** 从 Message[] 重建 ChatBubble，还原思考内容和工具调用信息。 */
  const messageToBubble = (m: Message, allMsgs: Message[]): ChatBubble => {
    if (m.role === "user") {
      return { id: m.id, role: "user", content: m.content, images: m.images };
    }
    const blocks: BubbleBlock[] = [];
    if (m.reasoningContent) {
      blocks.push({ type: "thinking", text: m.reasoningContent, expanded: false });
    }
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        const toolMsg = allMsgs.find((tm) => tm.role === "tool" && tm.toolCallId === tc.id);
        const isError = toolMsg?.content?.startsWith('{"error"');
        blocks.push({
          type: "tool-call",
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          status: toolMsg ? (isError ? "error" : "ok") : "running",
          result: toolMsg?.content,
          expanded: false,
        });
      }
    }
    if (m.content) {
      blocks.push({ type: "text", text: m.content });
    }
    return { id: m.id, role: "assistant", content: m.content, blocks: blocks.length > 0 ? blocks : undefined };
  };

  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const active = getActiveSession(loadSessions());
    const id = active?.id ?? createSessionId();
    if (!active) saveActiveSessionId(id);
    return id;
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const [bubbles, setBubbles] = useState<ChatBubble[]>(() => {
    const msgs = activeSession?.messages ?? [];
    return msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => messageToBubble(m, msgs));
  });
  const [history, setHistory] = useState<Message[]>(() => activeSession?.messages ?? []);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDebugMessages, setLastDebugMessages] = useState<Message[] | null>(
    null,
  );
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState<ReasoningEffort | "disabled">("high");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const profile = getActiveProfile(aiSettings);
  const configured = profile ? isProfileConfigured(profile) : false;
  const canChat = aiSettings.enabled && configured && Boolean(profile);
  const allModelOptions = getAllModelOptions(aiSettings);
  const activeModel = profile ? resolveActiveModel(aiSettings, profile) : "";

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const opt of allModelOptions) {
      const list = groups.get(opt.profileName);
      if (list) {
        list.push(opt);
      } else {
        groups.set(opt.profileName, [opt]);
      }
    }
    return Array.from(groups.entries());
  }, [allModelOptions]);
  const mode = aiSettings.defaultMode;
  const modeHasTools = useMemo(
    () => toolsForMode(mode, aiSettings.customModes).length > 0,
    [mode, aiSettings.customModes],
  );
  const allModes = useMemo(
    () => listAllModes(aiSettings.customModes),
    [aiSettings.customModes],
  );
  const hasWorkspace = Boolean(workspaceBridge.workspaceRoot);
  const hasSnippets = document.snippets.length > 0;
  const showActiveDocChip = document.includeActiveDocument && !hasSnippets;
  const hasContext = hasSnippets || showActiveDocChip;
  const debugEnabled = aiSettings.debug;

  const debugPreviewSource = useMemo(
    () => ({
      content: document.content,
      history,
      includeActiveDocument: document.includeActiveDocument,
      input,
      mode,
      outline: document.outline,
      path: document.path,
      snippets: document.snippets,
    }),
    [
      document.content,
      document.includeActiveDocument,
      document.outline,
      document.path,
      document.snippets,
      history,
      input,
      mode,
    ],
  );
  const debouncedDebugSource = useDebouncedValue(debugPreviewSource, 280);

  const previewDebugMessages = useMemo(() => {
    if (!debugEnabled) {
      return [];
    }
    return composeRequestMessages({
      document: {
        path: debouncedDebugSource.path,
        content: debouncedDebugSource.content,
        outline: debouncedDebugSource.outline,
        snippets: debouncedDebugSource.snippets,
        includeActiveDocument: debouncedDebugSource.includeActiveDocument,
      },
      history: debouncedDebugSource.history,
      systemPrompt:
        getModeDefinition(debouncedDebugSource.mode, aiSettings.customModes)?.systemPrompt,
      userText:
        debouncedDebugSource.input.trim() || "（输入框为空时的占位预览）",
    });
  }, [debouncedDebugSource, debugEnabled]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [bubbles, isGenerating]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const autoName = activeSession.nameManual
      ? activeSession.name
      : getSessionName(history) || "新会话";
    const updated: ChatSession = {
      ...activeSession,
      name: autoName,
      messages: history,
      updatedAt: Date.now(),
    };
    const next = sessions.map((s) => (s.id === activeSessionId ? updated : s));
    setSessions(next);
    saveSessions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const getSessionName = (msgs: Message[]) => {
    const firstUser = msgs.find((m) => m.role === "user");
    return firstUser?.content.slice(0, 20) || "";
  };

  const switchSession = (id: string) => {
    saveActiveSessionId(id);
    const session = sessions.find((s) => s.id === id);
    const msgs = session?.messages ?? [];
    setActiveSessionId(id);
    setHistory(msgs);
    setBubbles(msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => messageToBubble(m, msgs)));
  };

  const newSession = () => {
    const id = createSessionId();
    const session: ChatSession = {
      id,
      name: "",
      nameManual: false,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [session, ...sessions];
    setSessions(next);
    saveSessions(next);
    saveActiveSessionId(id);
    setActiveSessionId(id);
    setHistory([]);
    setBubbles([]);
    setError(null);
  };

  const renameSession = (id: string, name: string) => {
    const trimmed = name.trim();
    const next = sessions.map((s) =>
      s.id === id
        ? { ...s, name: trimmed || "新会话", nameManual: trimmed.length > 0 }
        : s,
    );
    setSessions(next);
    saveSessions(next);
    setEditingSessionId(null);
  };

  const startRename = (id: string) => {
    setEditingSessionId(id);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    saveSessions(next);
    if (id === activeSessionId) {
      const target = next[0];
      if (target) {
        switchSession(target.id);
      } else {
        newSession();
      }
    }
  };

  const stopGenerating = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  };

  const clearChat = () => {
    if (isGenerating) {
      stopGenerating();
    }
    setBubbles([]);
    setHistory([]);
    setError(null);
    setLastDebugMessages(null);
  };

  const disableDebug = () => {
    onAiSettingsChange({
      ...aiSettings,
      debug: false,
    });
  };

  const handleModeChange = (nextMode: string) => {
    onAiSettingsChange({
      ...aiSettings,
      defaultMode: nextMode,
    });
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const files = event.clipboardData?.files;
    if (!files?.length) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) imageFiles.push(files[i]);
    }
    if (imageFiles.length === 0) return;
    const readers: Promise<string>[] = [];
    for (const file of imageFiles) {
      readers.push(
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        }),
      );
    }
    Promise.all(readers).then((images) => {
      setUploadedImages((prev) => [...prev, ...images]);
    });
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    const readers: Promise<string>[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      readers.push(
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        }),
      );
    }
    Promise.all(readers).then((images) => {
      setUploadedImages((prev) => [...prev, ...images]);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  /** 发送消息 → 构建上下文 → 启动 Agent 循环 → 流式更新气泡。 */
  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    const hasContent = text.length > 0 || uploadedImages.length > 0;
    if (!hasContent || !profile || !canChat || isGenerating) {
      return;
    }

    if (modeHasTools && !hasWorkspace) {
      setError("当前模式需要先打开工作区，才能使用文件工具。");
      return;
    }

    const images = [...uploadedImages];
    setInput("");
    setUploadedImages([]);
    setError(null);
    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: text,
      images: images.length > 0 ? images : undefined,
    };
    const userBubble: ChatBubble = {
      id: userMessage.id,
      role: "user",
      content: text,
      images: images.length > 0 ? images : undefined,
    };
    const assistantId = createMessageId();
    setBubbles((prev) => [
      ...prev,
      userBubble,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    const messages = composeRequestMessages({
      document: {
        path: document.path,
        content: document.content,
        outline: document.outline,
        snippets: document.snippets,
        includeActiveDocument: document.includeActiveDocument,
      },
      history,
      images: images.length > 0 ? images : undefined,
      systemPrompt: getModeDefinition(mode, aiSettings.customModes)?.systemPrompt,
      userText: text,
    });

    if (aiSettings.debug) {
      setLastDebugMessages(messages);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);

    let assistantText = "";
    let inThinkingPhase = false;
    try {
      const newMessages = await runAgentLoop(
        {
          mode,
          customModes: aiSettings.customModes,
          profile: withResolvedModel(profile, activeModel),
          messages,
          signal: controller.signal,
          maxToolRounds: aiSettings.maxToolRounds,
          thinking: thinkingLevel === "disabled" ? "disabled" : "enabled",
          reasoningEffort: thinkingLevel === "disabled" ? undefined : thinkingLevel,
          toolContext: {
            workspaceRoot: workspaceBridge.workspaceRoot,
            openTabs: workspaceBridge.openTabs,
            activePath: document.path,
            bridge: workspaceBridge,
            applyFileChange: async (change: FileChange) => {
              await workspaceBridge.writeFile(change.path, change.after);
            },
          },
        },
        (event) => {
          if (event.type === "thinking-delta") {
            if (!inThinkingPhase) {
              inThinkingPhase = true;
              setBubbles((prev) =>
                prev.map((bubble) =>
                  bubble.id === assistantId
                    ? {
                        ...bubble,
                        blocks: [
                          ...(bubble.blocks ?? []),
                          { type: "thinking", text: event.text, expanded: true },
                        ],
                        streaming: true,
                      }
                    : bubble,
                ),
              );
            } else {
              setBubbles((prev) =>
                prev.map((bubble) => {
                  if (bubble.id !== assistantId) return bubble;
                  const blocks = bubble.blocks ?? [];
                  const last = blocks[blocks.length - 1];
                  if (last?.type !== "thinking") return bubble;
                  const updated = [...blocks];
                  updated[updated.length - 1] = {
                    ...last,
                    text: last.text + event.text,
                  };
                  return { ...bubble, blocks: updated, streaming: true };
                }),
              );
            }
          }
          if (event.type === "text-delta") {
            inThinkingPhase = false;
            assistantText += event.text;
            setBubbles((prev) =>
              prev.map((bubble) => {
                if (bubble.id !== assistantId) return bubble;
                const blocks = bubble.blocks ?? [];
                const last = blocks[blocks.length - 1];
                if (last?.type === "text") {
                  const updated = [...blocks];
                  updated[updated.length - 1] = { type: "text", text: assistantText };
                  return { ...bubble, content: assistantText, blocks: updated, streaming: true };
                }
                return {
                  ...bubble,
                  content: assistantText,
                  blocks: [...blocks, { type: "text", text: assistantText }],
                  streaming: true,
                };
              }),
            );
          }
          if (event.type === "tool-call") {
            inThinkingPhase = false;
            setBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === assistantId
                  ? {
                      ...bubble,
                      blocks: [
                        ...(bubble.blocks ?? []),
                        {
                          type: "tool-call",
                          id: event.call.id,
                          name: event.call.name,
                          arguments: event.call.arguments,
                          status: "running",
                        },
                      ],
                    }
                  : bubble,
              ),
            );
          }
          if (event.type === "tool-result") {
            inThinkingPhase = false;
            setBubbles((prev) =>
              prev.map((bubble) => {
                if (bubble.id !== assistantId) return bubble;
                const blocks = (bubble.blocks ?? []).map((block) =>
                  block.type === "tool-call" && block.id === event.call.id
                    ? {
                        ...block,
                        status: event.ok ? "ok" as const : "error" as const,
                        result: event.content,
                      }
                    : block,
                );
                return { ...bubble, blocks };
              }),
            );
          }
          if (event.type === "error") {
            inThinkingPhase = false;
            setError(event.error);
          }
        },
      );

      const lastAssistant = [...newMessages].reverse().find((m) => m.role === "assistant");
      assistantText = lastAssistant?.content || assistantText;
      setBubbles((prev) =>
        prev.map((bubble) => {
          if (bubble.id !== assistantId) return bubble;
          const blocks = bubble.blocks ?? [];
          const hasTextBlock = blocks.some((b) => b.type === "text");
          if (!hasTextBlock && assistantText) {
            blocks.push({ type: "text", text: assistantText });
          }
          return {
            ...bubble,
            content: assistantText || "（无回复内容）",
            blocks: blocks.length > 0 ? blocks : undefined,
            streaming: false,
          };
        }),
      );
      setHistory((prev) => [...prev, userMessage, ...newMessages]);
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : String(sendError);
      if (message !== "已取消生成") {
        setError(message);
        setBubbles((prev) =>
          prev.map((bubble) =>
            bubble.id === assistantId
              ? {
                ...bubble,
                content: assistantText || message,
                streaming: false,
                error: !assistantText,
              }
              : bubble,
          ),
        );
      } else {
        setBubbles((prev) =>
          prev.map((bubble) =>
            bubble.id === assistantId
              ? {
                ...bubble,
                content: assistantText || "（已停止）",
                streaming: false,
              }
              : bubble,
          ),
        );
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  if (!aiSettings.enabled) {
    return (
      <div className="ai-chat ai-chat--empty">
        <div className="ai-chat__empty-icon" aria-hidden="true">
          <Icon name="sparkles" size={22} />
        </div>
        <strong>AI 未启用</strong>
        <p>在设置中启用 AI 并填写供应商配置后即可开始对话。</p>
        <button className="button button--secondary" onClick={onOpenSettings} type="button">
          打开 AI 设置
        </button>
      </div>
    );
  }

  if (!profile || !configured) {
    return (
      <div className="ai-chat ai-chat--empty">
        <div className="ai-chat__empty-icon" aria-hidden="true">
          <Icon name="settings" size={22} />
        </div>
        <strong>尚未完成 AI 配置</strong>
        <p>请填写 Base URL、模型名称，以及供应商要求的 API Key。</p>
        <button className="button button--secondary" onClick={onOpenSettings} type="button">
          去配置
        </button>
      </div>
    );
  }

  const docName = document.path?.split(/[/\\]/).pop() || "未命名文档";

  const handleModelChange = (composite: string) => {
    const sep = composite.lastIndexOf("::");
    if (sep < 0) return;
    onAiSettingsChange({
      ...aiSettings,
      activeProfileId: composite.slice(0, sep),
      activeModel: composite.slice(sep + 2),
    });
  };

  /** 渲染气泡正文：生成中显示打字动画，助手消息用 Markdown 渲染。 */
  const renderBubbleContent = (bubble: ChatBubble) => {
    const hasBlocks = bubble.blocks && bubble.blocks.length > 0;
    if (bubble.streaming && !bubble.content && !hasBlocks) {
      return (
        <span className="ai-chat__typing" aria-label="正在生成">
          <span />
          <span />
          <span />
        </span>
      );
    }

    if (bubble.role === "assistant") {
      return <AiMarkdown content={bubble.content || "…"} />;
    }

    return (
      <div>
        {bubble.images?.map((img, i) => (
          <img
            key={i}
            alt="上传的图片"
            className="ai-chat__uploaded-image"
            src={img}
            style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, marginBottom: 4, display: "block" }}
          />
        ))}
        <div className="ai-chat__plain-text">{bubble.content || "…"}</div>
      </div>
    );
  };

  const toggleThinkingExpanded = (bubbleId: string, blockIndex: number) => {
    setBubbles((prev) =>
      prev.map((bubble) => {
        if (bubble.id !== bubbleId || !bubble.blocks) return bubble;
        const updated = [...bubble.blocks];
        const block = updated[blockIndex];
        if (block?.type === "thinking") {
          updated[blockIndex] = { ...block, expanded: !block.expanded };
        }
        return { ...bubble, blocks: updated };
      }),
    );
  };

  const toggleToolCallExpanded = (bubbleId: string, callId: string) => {
    setBubbles((prev) =>
      prev.map((bubble) => {
        if (bubble.id !== bubbleId || !bubble.blocks) return bubble;
        const updated = bubble.blocks.map((block) =>
          block.type === "tool-call" && block.id === callId
            ? { ...block, expanded: !block.expanded }
            : block,
        );
        return { ...bubble, blocks: updated };
      }),
    );
  };

  /** 渲染单个 BubbleBlock：思考折叠面板 / 工具调用卡片 / 工具简标。 */
  const renderBlock = (bubble: ChatBubble, block: BubbleBlock, blockIndex: number) => {
    if (block.type === "thinking") {
      return (
        <div
          className={`ai-chat__thinking${block.expanded ? " is-expanded" : ""}`}
          key={blockIndex}
        >
          <button
            className="ai-chat__thinking-header"
            onClick={() => toggleThinkingExpanded(bubble.id, blockIndex)}
            type="button"
          >
            <span className="ai-chat__thinking-icon" aria-hidden="true">💡</span>
            <span className="ai-chat__thinking-label">思考过程</span>
            <span aria-hidden="true" className="ai-chat__thinking-chevron">
              {block.expanded ? "▾" : "▸"}
            </span>
          </button>
          {block.expanded && (
            <div className="ai-chat__thinking-body">{block.text}</div>
          )}
        </div>
      );
    }
    if (block.type === "tool-call") {
      if (!aiSettings.showToolCalls) {
        return (
          <span
            className={`ai-chat__tool-mark ai-chat__tool-mark--${block.status}`}
            key={blockIndex}
            title={`${block.name}（${block.arguments.slice(0, 120) || "无参数"}）`}
          >
            <span aria-hidden="true">
              {block.status === "running" ? "⏳" : block.status === "ok" ? "✓" : "✕"}
            </span>
            {block.name}
          </span>
        );
      }
      return (
        <div
          className={`ai-chat__tool-call ai-chat__tool-call--${block.status}`}
          key={block.id}
        >
          <button
            className="ai-chat__tool-call-header"
            onClick={() => toggleToolCallExpanded(bubble.id, block.id)}
            type="button"
          >
            <span className="ai-chat__tool-call-icon" aria-hidden="true">
              {block.status === "running" ? "⏳" : block.status === "ok" ? "✓" : "✕"}
            </span>
            <span className="ai-chat__tool-call-name">{block.name}</span>
            <span className="ai-chat__tool-call-status">
              {block.status === "running" ? "调用中…" : block.status === "ok" ? "成功" : "失败"}
            </span>
            <span aria-hidden="true" className="ai-chat__tool-call-chevron">
              {block.expanded ? "▾" : "▸"}
            </span>
          </button>
          {block.expanded && (
            <div className="ai-chat__tool-call-body">
              <div className="ai-chat__tool-call-section">
                <div className="ai-chat__tool-call-section-label">参数</div>
                <pre className="ai-chat__tool-call-pre">
                  {block.arguments || "（无参数）"}
                </pre>
              </div>
              {block.result !== undefined && (
                <div className="ai-chat__tool-call-section">
                  <div className="ai-chat__tool-call-section-label">结果</div>
                  <pre className="ai-chat__tool-call-pre">{block.result}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat__sessions">
        <button
          className="ai-chat__session-new"
          onClick={newSession}
          title="新建会话"
          type="button"
        >
          +
        </button>
        {sessions.map((s) => (
          <div
            className={`ai-chat__session-tab${s.id === activeSessionId ? " is-active" : ""}`}
            key={s.id}
            onClick={() => switchSession(s.id)}
          >
            {editingSessionId === s.id ? (
              <input
                ref={renameInputRef}
                className="ai-chat__session-tab-input"
                defaultValue={s.name || "新会话"}
                onBlur={(e) => renameSession(s.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameSession(s.id, (e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setEditingSessionId(null);
                }}
              />
            ) : (
              <span
                className="ai-chat__session-tab-name"
                onDoubleClick={() => startRename(s.id)}
                title="双击重命名"
              >
                {s.name || "新会话"}
              </span>
            )}
            {sessions.length > 1 && (
              <button
                className="ai-chat__session-tab-close"
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                title="删除会话"
                type="button"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="ai-chat__messages" ref={listRef}>
        {bubbles.length === 0 && (
          <div className="ai-chat__welcome">
            <div className="ai-chat__welcome-icon" aria-hidden="true">
              <Icon name="ai" size={24} />
            </div>
            <strong>有什么可以帮你的？</strong>
            <p>
              我可以帮你润色、总结、扩写当前文档。选中文字后按{" "}
              <kbd>Ctrl+L</kbd> 可加入多段上下文。
            </p>
            <div className="ai-chat__prompts">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  className="ai-chat__prompt"
                  disabled={isGenerating}
                  key={prompt}
                  onClick={() => void sendMessage(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {bubbles.map((bubble) => (
          <div
            className={`ai-chat__row ai-chat__row--${bubble.role}${bubble.error ? " is-error" : ""
              }`}
            key={bubble.id}
          >
            {bubble.role === "assistant" ? (
              <div
                className={`ai-chat__message ai-chat__message--assistant${bubble.error ? " is-error" : ""
                  }`}
              >
                <span className="ai-chat__avatar ai-chat__avatar--assistant" aria-hidden="true">
                  <Icon name="sparkles" size={14} />
                </span>
                <div className="ai-chat__message-main">
                  {bubble.blocks?.map((block, index) =>
                    renderBlock(bubble, block, index),
                  )}
                  <div className="ai-chat__bubble-body">{renderBubbleContent(bubble)}</div>
                  {bubble.content && !bubble.streaming && !bubble.error && (
                    <div className="ai-chat__bubble-actions">
                      <button
                        aria-label="复制"
                        className="ai-chat__action"
                        onClick={() => void navigator.clipboard.writeText(bubble.content)}
                        title="复制"
                        type="button"
                      >
                        <Icon name="copy" size={13} />
                      </button>
                      <button
                        aria-label="插入到光标处"
                        className="ai-chat__action"
                        onClick={() => onInsert(bubble.content)}
                        title="插入到光标处"
                        type="button"
                      >
                        插入
                      </button>
                      <button
                        aria-label={document.selection ? "替换选区" : "请先在编辑器中选中内容"}
                        className="ai-chat__action"
                        disabled={!document.selection}
                        onClick={() => onReplace(bubble.content)}
                        title={document.selection ? "替换选区" : "请先在编辑器中选中内容"}
                        type="button"
                      >
                        替换选区
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`ai-chat__bubble ai-chat__bubble--user${bubble.error ? " is-error" : ""
                    }`}
                >
                  <div className="ai-chat__bubble-body">{renderBubbleContent(bubble)}</div>
                </div>
                <span className="ai-chat__avatar ai-chat__avatar--user" aria-hidden="true">
                  你
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="ai-chat__error" role="alert">
          {error}
        </div>
      )}

      {debugEnabled && (
        <AiDebugPanel
          lastMessages={lastDebugMessages}
          onClose={disableDebug}
          previewMessages={previewDebugMessages}
        />
      )}

      <div className="ai-chat__composer">
        <div className="ai-chat__composer-header">
          <div className="ai-chat__context-chips" aria-label="AI 上下文">
            {showActiveDocChip && (
              <div
                className="ai-chat__pill ai-chat__pill--context"
                title={
                  document.path
                    ? `${document.path}\n附带当前文档全文（可删除）`
                    : "附带当前未保存文档全文（可删除）"
                }
              >
                <Icon name="file" size={12} />
                <span className="ai-chat__pill-label">{docName}</span>
                <span className="ai-chat__pill-tag ai-chat__pill-tag--muted">全文</span>
                <button
                  aria-label="移除文档全文上下文"
                  className="ai-chat__pill-remove"
                  disabled={isGenerating}
                  onClick={onDismissActiveDocument}
                  title="移除"
                  type="button"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            )}
            {document.snippets.map((snippet) => (
              <div
                className="ai-chat__pill ai-chat__pill--context"
                key={snippet.id}
                title={
                  snippet.path
                    ? `${snippet.path}\n${snippetRangeLabel(snippet)}\n${snippet.text.slice(0, 200)}`
                    : `${snippetRangeLabel(snippet)}\n${snippet.text.slice(0, 200)}`
                }
              >
                <Icon name="file" size={12} />
                <span className="ai-chat__pill-label">
                  {snippetDisplayName(snippet)}
                </span>
                <span className="ai-chat__pill-tag">{snippetRangeLabel(snippet)}</span>
                <button
                  aria-label={`移除片段 ${snippetDisplayName(snippet)} ${snippetRangeLabel(snippet)}`}
                  className="ai-chat__pill-remove"
                  disabled={isGenerating}
                  onClick={() => onRemoveSnippet(snippet.id)}
                  title="移除"
                  type="button"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
            {!hasContext && (
              <div className="ai-chat__context-hint">
                未附带文档 · 选中后按 <kbd>Ctrl+L</kbd> 加入
              </div>
            )}
          </div>
        </div>
        {uploadedImages.length > 0 && (
          <div className="ai-chat__image-previews">
            {uploadedImages.map((img, i) => (
              <div key={i} className="ai-chat__image-preview-item">
                <img alt={`图片 ${i + 1}`} src={img} />
                <button
                  aria-label="移除图片"
                  className="ai-chat__image-preview-remove"
                  onClick={() => removeImage(i)}
                  type="button"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          aria-label="向 AI 发送消息"
          disabled={isGenerating}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          onPaste={handlePaste}
          placeholder="输入问题… Enter 发送，Shift+Enter 换行"
          rows={3}
          value={input}
        />
        <div className="ai-chat__composer-footer">
          <div className="ai-chat__composer-meta">
            <label className="ai-chat__pill ai-chat__pill--mode" title="对话模式">
              <span className="ai-chat__pill-label">
                {modeLabel(mode, aiSettings.customModes)}
              </span>
              <select
                aria-label="选择对话模式"
                className="ai-chat__pill-select"
                disabled={isGenerating}
                onChange={(event) => handleModeChange(event.target.value)}
                value={mode}
              >
                {allModes.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <span aria-hidden="true" className="ai-chat__pill-chevron">
                <Icon name="chevron" size={12} />
              </span>
            </label>
            <button
              aria-label="配置智能体模式"
              className="icon-button ai-chat__composer-tool"
              disabled={isGenerating}
              onClick={onOpenAgentConfig}
              title="配置智能体模式"
              type="button"
            >
              <Icon name="settings" size={14} />
            </button>
            <label className="ai-chat__pill ai-chat__pill--mode" title="思考强度">
              <span className="ai-chat__pill-label">思考: {thinkingLevel === "disabled" ? "关闭" : thinkingLevel}</span>
              <select
                aria-label="选择思考强度"
                className="ai-chat__pill-select"
                disabled={isGenerating}
                onChange={(event) => setThinkingLevel(event.target.value as ReasoningEffort | "disabled")}
                value={thinkingLevel}
              >
                <option value="disabled">关闭</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="max">max</option>
              </select>
              <span aria-hidden="true" className="ai-chat__pill-chevron">
                <Icon name="chevron" size={12} />
              </span>
            </label>
            {allModelOptions.length > 1 ? (
              <label className="ai-chat__pill ai-chat__pill--model">
                <span className="ai-chat__pill-label">{activeModel}</span>
                <select
                  aria-label="选择模型"
                  className="ai-chat__pill-select"
                  disabled={isGenerating}
                  onChange={(event) => handleModelChange(event.target.value)}
                  value={`${aiSettings.activeProfileId}::${activeModel}`}
                >
                  {groupedModels.map(([profileName, options]) => (
                    <optgroup key={profileName} label={profileName}>
                      {options.map((opt) => (
                        <option key={opt.profileId + opt.model} value={`${opt.profileId}::${opt.model}`}>
                          {opt.model}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span aria-hidden="true" className="ai-chat__pill-chevron">
                  <Icon name="chevron" size={12} />
                </span>
              </label>
            ) : (
              <div className="ai-chat__pill ai-chat__pill--model is-static" title="当前模型">
                <span className="ai-chat__pill-label">{activeModel || "未配置"}</span>
              </div>
            )}

            <button
              aria-label={aiSettings.showToolCalls ? "折叠工具详情" : "展开工具详情"}
              aria-pressed={aiSettings.showToolCalls}
              className={`ai-chat__pill ai-chat__pill--tool-toggle${aiSettings.showToolCalls ? " is-active" : ""}${!modeHasTools ? " is-muted" : ""}`}
              disabled={!modeHasTools}
              onClick={() =>
                onAiSettingsChange({
                  ...aiSettings,
                  showToolCalls: !aiSettings.showToolCalls,
                })
              }
              title={!modeHasTools ? "当前模式未启用任何工具" : undefined}
              type="button"
            >
              <span className="ai-chat__pill-label">工具</span>
              <span className="ai-chat__pill-tag">{aiSettings.showToolCalls ? "展开" : "折叠"}</span>
            </button>
          </div>

          <div className="ai-chat__composer-actions">
            <input
              accept="image/*"
              aria-label="上传图片"
              className="ai-chat__file-input"
              multiple
              onChange={handleImageSelect}
              ref={fileInputRef}
              style={{ display: "none" }}
              type="file"
            />
            <button
              aria-label="上传图片"
              className="icon-button ai-chat__composer-tool"
              disabled={isGenerating}
              onClick={() => fileInputRef.current?.click()}
              title="上传图片（支持视觉理解）"
              type="button"
            >
              <Icon name="image" size={14} />
            </button>
            <button
              aria-label="清空对话"
              className="icon-button ai-chat__composer-tool"
              disabled={bubbles.length === 0 && !isGenerating}
              onClick={clearChat}
              title="清空对话"
              type="button"
            >
              <Icon name="trash" size={14} />
            </button>
            {isGenerating ? (
              <button
                aria-label="停止生成"
                className="icon-button ai-chat__composer-send ai-chat__composer-send--stop"
                onClick={stopGenerating}
                title="停止"
                type="button"
              >
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button
                aria-label="发送"
                className="icon-button ai-chat__composer-send"
                disabled={!input.trim()}
                onClick={() => void sendMessage()}
                title="发送"
                type="button"
              >
                <Icon name="send" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
