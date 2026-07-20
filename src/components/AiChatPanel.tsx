import { useEffect, useMemo, useRef, useState } from "react";
import {
  composeRequestMessages,
  createMessageId,
  getActiveProfile,
  getProfileModels,
  isProfileConfigured,
  resolveActiveModel,
  runAgentLoop,
  snippetDisplayName,
  snippetRangeLabel,
  withResolvedModel,
  type AiMode,
  type AiSettings,
  type ContextSnippet,
  type Message,
  type WorkspaceBridge,
} from "../ai";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { AiDebugPanel } from "./AiDebugPanel";
import { AiMarkdown } from "./AiMarkdown";
import { Icon } from "./Icon";

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
  onOpenSettings: () => void;
  onRemoveSnippet: (id: string) => void;
  onReplace: (text: string) => void;
  workspaceBridge: WorkspaceBridge;
}

interface ChatBubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const QUICK_PROMPTS = [
  "总结当前文档要点",
  "润色选中内容",
  "补充一段引言",
  "检查语法和表达",
];

const ASK_SYSTEM_PROMPT =
  "你是墨览 Markdown 写作助手，当前为 Agent Ask（只读）模式。需要了解工作区内容时，先使用 list_dir / read_file 工具再回答；引用时标明文件路径。优先输出可直接粘贴的 Markdown。除非用户要求，不要解释过程。";

function resolvePanelMode(mode: AiMode): AiMode {
  return mode === "agent-edit" ? "agent-ask" : mode;
}

export function AiChatPanel({
  aiSettings,
  document,
  onAiSettingsChange,
  onDismissActiveDocument,
  onInsert,
  onOpenSettings,
  onRemoveSnippet,
  onReplace,
  workspaceBridge,
}: AiChatPanelProps) {
  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDebugMessages, setLastDebugMessages] = useState<Message[] | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const profile = getActiveProfile(aiSettings);
  const configured = profile ? isProfileConfigured(profile) : false;
  const canChat = aiSettings.enabled && configured && Boolean(profile);
  const availableModels = profile ? getProfileModels(profile) : [];
  const activeModel = profile ? resolveActiveModel(aiSettings, profile) : "";
  const mode = resolvePanelMode(aiSettings.defaultMode);
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
        debouncedDebugSource.mode === "agent-ask"
          ? ASK_SYSTEM_PROMPT
          : undefined,
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

  const handleModeChange = (nextMode: AiMode) => {
    onAiSettingsChange({
      ...aiSettings,
      defaultMode: resolvePanelMode(nextMode),
    });
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || !profile || !canChat || isGenerating) {
      return;
    }

    if (mode === "agent-ask" && !hasWorkspace) {
      setError("Agent Ask 需要先打开工作区，才能使用 list_dir / read_file。");
      return;
    }

    setInput("");
    setError(null);
    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: text,
    };
    const userBubble: ChatBubble = {
      id: userMessage.id,
      role: "user",
      content: text,
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
      systemPrompt: mode === "agent-ask" ? ASK_SYSTEM_PROMPT : undefined,
      userText: text,
    });

    if (aiSettings.debug) {
      setLastDebugMessages(messages);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);

    let assistantText = "";
    try {
      const assistantMessage = await runAgentLoop(
        {
          mode,
          profile: withResolvedModel(profile, activeModel),
          messages,
          signal: controller.signal,
          maxToolRounds: aiSettings.maxToolRounds,
          toolContext: {
            workspaceRoot: workspaceBridge.workspaceRoot,
            openTabs: workspaceBridge.openTabs,
            activePath: document.path,
            bridge: workspaceBridge,
          },
        },
        (event) => {
          if (event.type === "text-delta") {
            assistantText += event.text;
            setBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === assistantId
                  ? { ...bubble, content: assistantText, streaming: true }
                  : bubble,
              ),
            );
          }
          if (event.type === "error") {
            setError(event.error);
          }
        },
      );

      assistantText = assistantMessage.content || assistantText;
      setBubbles((prev) =>
        prev.map((bubble) =>
          bubble.id === assistantId
            ? {
              ...bubble,
              content: assistantText || "（无回复内容）",
              streaming: false,
            }
            : bubble,
        ),
      );
      setHistory((prev) => [
        ...prev,
        userMessage,
        {
          id: assistantMessage.id,
          role: "assistant",
          content: assistantText,
        },
      ]);
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

  const handleModelChange = (model: string) => {
    onAiSettingsChange({
      ...aiSettings,
      activeModel: model,
    });
  };

  const renderBubbleContent = (bubble: ChatBubble) => {
    if (bubble.streaming && !bubble.content) {
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

    return <div className="ai-chat__plain-text">{bubble.content || "…"}</div>;
  };

  return (
    <div className="ai-chat">
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
          placeholder="输入问题… Enter 发送，Shift+Enter 换行"
          rows={3}
          value={input}
        />
        <div className="ai-chat__composer-footer">
          <div className="ai-chat__composer-meta">
            <label className="ai-chat__pill ai-chat__pill--mode" title="对话模式">
              <span className="ai-chat__pill-label">{mode === "agent-ask" ? "Agent" : "Chat"}</span>
              <select
                aria-label="选择对话模式"
                className="ai-chat__pill-select"
                disabled={isGenerating}
                onChange={(event) => handleModeChange(event.target.value as AiMode)}
                value={mode}
              >
                <option value="chat">Chat</option>
                <option value="agent-ask">Agent</option>
              </select>
              <span aria-hidden="true" className="ai-chat__pill-chevron">
                <Icon name="chevron" size={12} />
              </span>
            </label>
            {availableModels.length > 1 ? (
              <label className="ai-chat__pill ai-chat__pill--model">
                <span className="ai-chat__pill-label">{activeModel}</span>
                <select
                  aria-label="选择模型"
                  className="ai-chat__pill-select"
                  disabled={isGenerating}
                  onChange={(event) => handleModelChange(event.target.value)}
                  value={activeModel}
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
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
          </div>

          <div className="ai-chat__composer-actions">
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
