import { useState } from "react";
import type { Message } from "../ai";
import { Icon } from "./Icon";

interface AiDebugPanelProps {
  lastMessages: Message[] | null;
  onClose: () => void;
  previewMessages: Message[];
}

function messageStats(messages: Message[]) {
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return { count: messages.length, chars };
}

function DebugMessageList({ messages }: { messages: Message[] }) {
  /** undefined = 默认；system 默认展开，其它默认折叠 */
  const [expanded, setExpanded] = useState<Record<string, boolean | undefined>>(
    {},
  );

  if (messages.length === 0) {
    return <p className="ai-debug__empty">暂无消息</p>;
  }

  return (
    <ul className="ai-debug__list">
      {messages.map((message, index) => {
        const key = `${message.id}-${index}`;
        const isSystem = message.role === "system";
        const collapseAt = isSystem ? 2400 : 400;
        const stored = expanded[key];
        const effectivelyOpen =
          message.content.length <= collapseAt
            ? true
            : stored !== undefined
              ? stored
              : isSystem;
        const preview = effectivelyOpen
          ? message.content
          : `${message.content.slice(0, collapseAt)}…`;
        return (
          <li
            className={`ai-debug__item${isSystem ? " ai-debug__item--system" : ""}`}
            key={key}
          >
            <div className="ai-debug__item-head">
              <span className="ai-debug__role">{message.role}</span>
              <span className="ai-debug__chars">{message.content.length} 字</span>
              {message.content.length > collapseAt && (
                <button
                  className="ai-debug__expand"
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [key]: !effectivelyOpen,
                    }))
                  }
                  type="button"
                >
                  {effectivelyOpen ? "收起" : "展开"}
                </button>
              )}
            </div>
            <pre
              className={`ai-debug__content${
                isSystem ? " ai-debug__content--system" : ""
              }`}
            >
              {preview || "（空）"}
            </pre>
          </li>
        );
      })}
    </ul>
  );
}

export function AiDebugPanel({
  lastMessages,
  onClose,
  previewMessages,
}: AiDebugPanelProps) {
  const [tab, setTab] = useState<"preview" | "last">("preview");
  const [copied, setCopied] = useState(false);

  const activeMessages =
    tab === "last" ? (lastMessages ?? []) : previewMessages;
  const stats = messageStats(activeMessages);

  const copyJson = async () => {
    const payload = activeMessages.map(({ role, content, toolCalls, toolCallId, name }) => ({
      role,
      content,
      ...(toolCalls ? { toolCalls } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(name ? { name } : {}),
    }));
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="ai-debug" aria-label="AI 调试">
      <div className="ai-debug__header">
        <strong>请求拼装</strong>
        <div className="ai-debug__header-actions">
          <button
            className="ai-debug__action"
            onClick={() => void copyJson()}
            title="复制 JSON（不含 API Key）"
            type="button"
          >
            {copied ? "已复制" : "复制 JSON"}
          </button>
          <button
            aria-label="关闭调试面板显示（仍保持设置中的调试模式）"
            className="icon-button ai-debug__close"
            onClick={onClose}
            title="关闭调试"
            type="button"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="ai-debug__tabs" role="tablist">
        <button
          aria-selected={tab === "preview"}
          className={tab === "preview" ? "is-active" : ""}
          onClick={() => setTab("preview")}
          role="tab"
          type="button"
        >
          当前预览
        </button>
        <button
          aria-selected={tab === "last"}
          className={tab === "last" ? "is-active" : ""}
          onClick={() => setTab("last")}
          role="tab"
          type="button"
        >
          上次发送
        </button>
      </div>

      <div className="ai-debug__meta">
        {tab === "preview"
          ? "按当前上下文与输入框内容拼装（输入框为空时用占位文案）"
          : lastMessages
            ? "最近一次实际发给模型的 messages"
            : "尚未发送过消息"}
        <span>
          {stats.count} 条 · {stats.chars} 字
        </span>
      </div>

      <div className="ai-debug__body">
        {tab === "last" && !lastMessages ? (
          <p className="ai-debug__empty">发送一条消息后可在此查看。</p>
        ) : (
          <DebugMessageList messages={activeMessages} />
        )}
      </div>
    </div>
  );
}
