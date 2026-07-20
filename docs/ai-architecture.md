# 墨览 AI 架构文档

> 描述当前代码中的 AI 模块实现（截至文档编写时）。  
> 产品分期与待办见仓库根目录 [AGENT_PLAN.md](../AGENT_PLAN.md)。

## 1. 目标与原则

墨览在应用内提供文档写作助手：右侧对话面板、可插拔供应商、当前文档/选区上下文注入。

设计原则：

- **Chat 是 Agent 关掉工具后的特例**，统一走 `runAgentLoop`
- **供应商差异关在 Provider Adapter 内**，上层只认统一消息与流式 chunk
- **读/写文件关在 Tool 层**（规划中），配合路径沙箱与写操作确认
- **用户自备 API Key**，设置保存在本地 `localStorage`

## 2. 模块总览

```
┌─────────────────────────────────────────────────────────┐
│  UI                                                     │
│  AppHeader / AiSidePanel / AiChatPanel / SettingsDialog │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Context（context.ts）                                   │
│  system 角色提示 + 文档上下文 system + history + user    │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  AgentLoop（agent/loop.ts）                              │
│  模式 / 轮次上限 / AbortSignal / 流式事件回调             │
└───────────────┬─────────────────────────┬───────────────┘
                │                         │
┌───────────────▼──────────┐   ┌──────────▼───────────────┐
│  Provider Registry        │   │  Tool Registry（骨架）    │
│  openai / deepseek / …    │   │  resolveToolsForMode      │
│  → fetch SSE 流式         │   │  默认无已注册 handler     │
└───────────────────────────┘   └──────────────────────────┘
```

### 目录结构

```
src/ai/
  index.ts              # 对外导出
  types.ts              # Message、Mode、Tool、StreamChunk 等
  settings.ts           # 配置模型、读写 localStorage、模板
  context.ts            # 文档上下文拼装
  editorActions.ts      # 选区读取、插入、替换
  agent/
    loop.ts             # 统一 Agent 循环
    modes.ts            # 模式 ↔ 工具名 / tool_choice
  providers/
    registry.ts         # Adapter 注册与查询
    types.ts            # ProviderAdapter 接口
    httpTransport.ts    # fetch / SSE 解析
    openai.ts | deepseek.ts | chatglm.ts | doubao.ts
    ollama.ts | custom.ts | anthropic.ts（未对设置页开放）
  tools/
    registry.ts         # 工具注册与执行
    types.ts            # ToolHandler / ToolContext
  safety/
    pathPolicy.ts       # 工作区路径沙箱
    confirmPolicy.ts    # 写操作确认策略
```

## 3. 运行时数据流

### 3.1 发消息（当前 Chat）

```
用户输入
  → AiChatPanel.sendMessage
  → composeRequestMessages({ document, history, userText })
  → runAgentLoop({ mode: "chat", profile, messages, signal })
  → adapter.chat(...) 异步迭代 StreamChunk
  → onEvent(text-delta | error | …)
  → 更新气泡 UI；成功后写入 history
```

### 3.2 文档上下文注入来源

| 字段 | 来源（App.tsx） | 说明 |
|------|-----------------|------|
| `path` | `activeTab.path` | 未保存文档为 `null` |
| `content` | `activeTab.content` | 当前标签全文（无片段且未关闭「全文」时使用） |
| `selection` | `editorSelection` | 仅用于「替换选区」按钮，不再自动注入请求 |
| `outline` | `outline.map(t => t.text)` | 标题文本列表 |
| `snippets` | `aiContextSnippets` | Ctrl+L 显式加入的多段上下文 |
| `includeActiveDocument` | state | 无 snippets 时是否附带全文 |

面板顶部的上下文芯片可删除；`Ctrl+L` 可追加多段片段。真正进入 API 的是 `composeRequestMessages` 的结果。

## 4. 上下文架构

核心文件：`src/ai/context.ts`。

### 4.1 每轮请求消息顺序

```
[0] system — 角色提示（DEFAULT_SYSTEM_PROMPT）
[1] system — 文档上下文（可选）
[…] history 中的 user / assistant（跳过 system）
[N] user   — 本轮用户输入
```

### 4.2 角色 system

```
你是墨览 Markdown 写作助手。优先输出可直接粘贴的 Markdown。除非用户要求，不要解释过程。
```

### 4.3 文档上下文（显式片段优先）

拼装优先级：

1. **有 `snippets`（Ctrl+L 加入）**  
   - 附带当前打开路径与大纲（便于定位）  
   - 再附带各片段：`文件路径 + L起-L止 + 代码块`  
   - 合计上限：`DEFAULT_SNIPPETS_CHAR_LIMIT = 50_000`
2. **无 snippets 且 `includeActiveDocument !== false`**  
   - 路径 + 大纲 + **文档全文**（上限 50_000；不再用「实时选区」自动注入）
3. **无 snippets 且用户关掉「全文」芯片**  
   - 不附带文档正文（纯聊天）

UI：

- 默认显示可删除的「当前文件 · 全文」芯片  
- `Ctrl+L`（无选区则取当前行）追加片段芯片，可单独 × 删除  
- 命令面板：「将选区加入 AI 上下文」

面板芯片为真实上下文控制，删除即影响下一轮请求。

### 4.4 会话 history

- 存在 `AiChatPanel` 内存 state，**不持久化**
- 清空对话 / 刷新页面即丢失
- 无轮次或 token 上限裁剪（当前实现）

### 4.5 示例（两个显式片段）

```json
[
  { "role": "system", "content": "你是墨览 Markdown 写作助手。…" },
  {
    "role": "system",
    "content": "当前打开文档：C:\\…\\foo.md\n\n用户附带的上下文片段（共 2 个）：\n\n文件：…（L10-L20）\n```\n…\n```\n\n文件：…（L40）\n```\n…\n```"
  },
  { "role": "user", "content": "本轮问题" }
]
```

## 5. Agent 循环与模式

### 5.1 `runAgentLoop`

- 按 `profile.adapter` 取 Adapter，调用 `chat` 流式接口
- 收集 `text-delta` / `tool-call`，可达 `maxToolRounds`（默认 8）
- 支持 `AbortSignal`（面板「停止」）
- 对外事件：`text-delta` | `tool-call` | `tool-result` | `message` | `done` | `error`

### 5.2 模式（`agent/modes.ts`）

| 模式 | 工具 | tool_choice | UI 现状 |
|------|------|-------------|---------|
| `chat` | 无 | `none` | **已接入** |
| `agent-ask` | `list_dir` / `read_file` / `search_workspace` | `auto` | 未切换 |
| `agent-edit` | 只读工具 + `edit_file` / `create_file` | `auto` | 未切换 |

工具名已在 modes 中声明，但 `tools/registry` **默认无 `registerTool`**，因此即便切到 Agent 模式，暴露给模型的 tools 列表也为空，直到注册具体 handler。

## 6. Provider 层

### 6.1 接口（`providers/types.ts`）

每个 Adapter 实现：

- `id` / `label` / `capabilities` / `defaults`
- `chat(profile, request, signal): AsyncIterable<StreamChunk>`
- 可选：`testConnection`、`listModels`

统一请求体：`UnifiedChatRequest`（messages、model、tools、stream 等）。  
统一流式块：`text-delta` | `tool-call` | `message-stop` | `error`。

### 6.2 已注册厂商

| Adapter ID | 设置页可选 | 说明 |
|------------|------------|------|
| `openai` | 是 | Chat Completions 兼容 |
| `deepseek` | 是 | 同上 |
| `chatglm` | 是 | 同上 |
| `doubao` | 是 | 模型名填方舟接入点 ID |
| `ollama` | 是 | 本地；API Key 可选 |
| `custom` | 是 | 自填 Base URL / 路径 |
| `anthropic` | 否 | 骨架存在，`listSelectableProviderAdapters` 过滤 |

传输：前端 `fetch` + SSE（`httpTransport.ts`）。浏览器环境下部分云 API 可能遇 **CORS**；设置页已提示可改用 Ollama 或后续 Tauri 代理。

### 6.3 配置（`settings.ts`）

- 存储键：`md-show:ai-settings`
- 结构：`enabled`、`activeProfileId`、`activeModel`、`profiles[]`、`defaultMode`、`confirmPolicy`、`maxToolRounds`
- Profile：`adapter`、`baseUrl`、`apiKey`、`model` / `models[]`、可选 `chatPath` 等
- 设置 UI：本地 draft + debounce 持久化（见 `SettingsDialog`）；模型列表使用稳定 slot key

`isProfileConfigured`：当前要求 Base URL + 至少一个模型名；**不强制 API Key**（发请求时由各 Adapter 校验）。

## 7. 工具与安全（骨架）

### 7.1 Tool Registry

- `registerTool` / `executeTool` / `resolveToolsForMode`
- `ToolContext`：预留 `workspaceRoot`、`openTabs`、`activePath` 等
- Chat 模式不附带 tools

### 7.2 PathPolicy

限制路径落在工作区内、扩展名白名单等（供未来读/写工具使用）。

### 7.3 ConfirmPolicy

写操作决策：`always`（每次确认）/ `session`（本会话信任后自动）/ `auto`。  
与 Diff 面板联动属于后续 Agent Edit 范围，Chat 未使用。

## 8. UI 职责

| 组件 | 职责 |
|------|------|
| `AiSidePanel` | 右侧面板壳、宽度拖拽 |
| `AiChatPanel` | 对话、流式展示、模型切换、插入/替换、清空、调试拼装 |
| `AiDebugPanel` | 调试模式下展示当前预览 / 上次发送的 messages |
| `AiMarkdown` | 助手回复 Markdown 渲染（sanitize + highlight） |
| `SettingsDialog`（AI 页） | 启用、模板、密钥、模型列表、测试连接 |
| `App.tsx` | 汇聚文档上下文、AI 设置状态、面板开关 |

输出动作（Chat）：

- 复制
- 插入光标处（`insertAtCursor`）
- 替换选区（无选区时按钮禁用）

## 9. 类型速查

```ts
type AiMode = "chat" | "agent-ask" | "agent-edit";
type MessageRole = "system" | "user" | "assistant" | "tool";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

interface DocumentContextInput {
  path: string | null;
  content: string;
  selection?: string;
  outline?: string[];
  snippets?: ContextSnippet[];
  includeActiveDocument?: boolean;
}

interface ContextSnippet {
  id: string;
  path: string | null;
  startLine: number;
  endLine: number;
  text: string;
}
```

## 10. 当前能力边界

**已具备**

- 多供应商 Chat Completions 流式对话
- 文档路径 / 大纲 / 全文上下文；**Ctrl+L 多片段**与芯片删除
- 多模型列表与面板切换
- 调试模式：查看请求 messages 拼装（预览 / 上次发送，可复制 JSON）
- 停止生成、测试连接、插入/替换选区
- AgentLoop / 工具 / 安全策略的代码骨架

**尚未具备 / 限制**

- Agent Ask / Edit UI 与真实工具 handler
- 对话持久化、history 裁剪
- 流式过程中 Markdown 全量重解析（长回复可能卡顿）
- Tauri HTTP 代理（CORS 规避）
- Anthropic 正式接入设置页
- Diff Accept/Reject 写文件流程
- 浏览器环境下 Ctrl+L 可能被地址栏抢走（可用命令面板兜底）

## 11. 相关文档与入口

| 资源 | 路径 |
|------|------|
| Agent 分期计划 | [AGENT_PLAN.md](../AGENT_PLAN.md) |
| 总产品计划 | [PLAN.md](../PLAN.md) |
| 模块导出 | `src/ai/index.ts` |
| 上下文拼装 | `src/ai/context.ts` |
| Agent 循环 | `src/ai/agent/loop.ts` |
