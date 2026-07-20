# AI / Agent 模块开发计划

> 本文档是 [PLAN.md](./PLAN.md) 中「AI模块」的详细设计与分期计划。  
> 每完成一项任务，将复选框从 `[ ]` 修改为 `[x]`，并在更新记录中注明日期。

## 状态说明

- `[ ]` 未开始
- `[-]` 进行中
- `[x]` 已完成
- `[!]` 阻塞
- `[~]` 暂缓或取消

## 目标

在墨览中提供类似 Cursor Chat 的文档助手，并预留 Agent 能力（尤其是读文件、改文件），同时保持供应商可插拔：用户可在设置中配置不同 API 的 Base URL、API Key 与模型名称。

首版原则：

- Chat 是 Agent 关掉工具后的特例，底层统一走 `AgentLoop`
- 供应商差异关在 Provider Adapter 内
- 读/改文件关在 ToolHost 内，不绕过现有工作区与标签页状态
- 写文件默认需 Diff 确认，禁止模型静默拥有文件系统权限

## 产品形态

### 模式

| 模式 | 说明 | 工具 |
|------|------|------|
| Chat | 多轮对话，带当前文档/选区上下文 | 无工具，或仅上下文注入 |
| Agent Ask | 可调研工作区后回答 | 只读：`list_dir` / `read_file` / `search_workspace` |
| Agent Edit | 可提议并应用文件变更 | 只读工具 + `edit_file` / `create_file` |

### 交互入口

- 右侧 AI 面板（类 Cursor Chat，顶栏开关）
- 命令面板：打开/关闭 AI、打开 AI 设置、后续可加改写选区等
- 选区右键（可选）：润色、翻译、总结、续写
- 输出动作：复制、插入光标处、替换选区；Agent 另提供 Diff Accept / Reject

### 非目标（本期不做）

- 完整复刻 Cursor Composer / 多文件自治 Agent
- 浏览器插件式任意工具生态
- 云端账号体系与官方模型代理（用户自备 Key）

## 架构设计

```
UI (ChatPanel / DiffPanel / Settings)
        ↓
AgentLoop（会话、模式、步数上限、取消）
        ↓
ContextBuilder（当前文档、选区、大纲、工作区提示）
        ↓
ProviderRegistry → ProviderAdapter（OpenAI 兼容 / 后续 Anthropic…）
        ↓
HttpClient（建议 Tauri 命令代理，避免 CORS 与密钥暴露）
        ↑
ToolHost ← tool_calls
  · PathPolicy（工作区沙箱）
  · ConfirmPolicy（写操作确认）
  · WorkspaceBridge（对接标签页 / fs / 文件树刷新）
```

### 建议目录

```
src/ai/
  types.ts
  settings.ts
  context.ts
  agent/
    loop.ts
    modes.ts
  providers/
    types.ts
    registry.ts
    errors.ts
    openai.ts          # 各厂商独立实现，互不复用请求拼装
    deepseek.ts
    chatglm.ts
    doubao.ts
    ollama.ts
    custom.ts
    anthropic.ts       # 占位，协议不同
  tools/
    types.ts
    registry.ts
    listDir.ts
    readFile.ts
    editFile.ts
    createFile.ts
    searchWorkspace.ts
  safety/
    pathPolicy.ts
    confirmPolicy.ts
```

Tauri 侧（推荐随网络层一并落地）：

```
src-tauri/src/ai/
  mod.rs          # ai_chat / ai_chat_stream 等命令
  http.rs         # 代理上游 API
```

### 核心原则

1. **统一消息协议**：内部使用 `system | user | assistant | tool` 消息，以及可选 `tools` / `tool_calls`
2. **Chat = 无工具 Agent**：UI 可先做 Chat，但请求入口仍是 `AgentLoop`
3. **ToolHost 是唯一写入口**：工具不得直接散落调用 `writeTextFile`，必须经 `applyFileChange`，以同步 tab dirty、文件树与未保存保护
4. **Provider 一家一文件**：OpenAI / DeepSeek / ChatGLM / 豆包 / Ollama / 自定义等各自独立 Adapter（含 URL、Header、Body 拼装），禁止抽成共用「OpenAI 兼容」工厂，避免一家变更牵连全家；新增厂商按同模式加文件并注册

## 配置模型

设置对话框新增 `ai` Tab。配置以 Provider Profile 为单位，支持后续多供应商切换。

```ts
type AiSettings = {
  enabled: boolean;
  activeProfileId: string;
  defaultMode: "chat" | "agent-ask" | "agent-edit";
  confirmPolicy: "always" | "session" | "auto";
  maxToolRounds: number;
  profiles: AiProviderProfile[];
};

type AiProviderProfile = {
  id: string;
  name: string;
  adapter:
    | "openai"
    | "deepseek"
    | "chatglm"
    | "doubao"
    | "ollama"
    | "custom"
    | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  chatPath?: string;
  headers?: Record<string, string>;
};
```

### 设置页字段（MVP）

- [x] 启用 AI
- [x] 当前配置（下拉）
- [x] 配置名称
- [x] 供应商 / 适配器（一家一个，非「OpenAI 兼容」统称）
- [x] Base URL
- [x] API Key
- [x] 模型名称
- [x] 测试连接
- [x] （预留，可先隐藏）确认策略、最大工具轮次、默认模式

### 预置模板（仅默认 Base URL，不填 Key）

| 名称 | Base URL |
|------|----------|
| OpenAI (ChatGPT) | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 智谱 ChatGLM | `https://open.bigmodel.cn/api/paas/v4` |
| 火山豆包 | `https://ark.cn-beijing.volces.com/api/v3` |
| Ollama | `http://127.0.0.1:11434/v1` |
| 自定义 | 空 |

## Provider Adapter

```ts
interface ProviderAdapter {
  id: ProviderAdapterId;
  label: string;
  capabilities: { stream: boolean; tools: boolean };
  defaults: { baseUrl: string; model: string; chatPath?: string; hint?: string };
  chat(
    profile: AiProviderProfile,
    request: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk>;
  listModels?(profile: AiProviderProfile): Promise<string[]>;
}
```

- [x] 各厂商独立 Adapter 骨架（openai / deepseek / chatglm / doubao / ollama / custom）
- [x] 请求类型预留 `tools` / `tool_calls`，即使 Chat MVP 不启用
- [x] 各厂商网络层与流式解析（A1；共用仅 httpTransport，协议拼装仍各文件独立）
- [ ] 能力探测或「测试 function calling」（Agent 启用前校验）
- [ ] （二期）Anthropic Messages Adapter
- [ ] Tauri HTTP 代理（消除 CORS 技术债）

## 工具设计（Agent 预留）

### 工具清单

| Tool | 风险 | Chat | Agent Ask | Agent Edit |
|------|------|------|-----------|------------|
| `list_dir` | 低 | — | ✅ | ✅ |
| `read_file` | 低 | — | ✅ | ✅ |
| `search_workspace` | 低 | — | ✅ | ✅ |
| `edit_file` | 高 | — | — | ✅ |
| `create_file` | 中 | — | — | ✅ 可选 |
| `delete_file` | 很高 | — | — | 默认禁用 |

### `edit_file` 契约（推荐）

优先局部替换，整文件写入仅作兜底：

```ts
// 主路径
edit_file({ path, old_string, new_string })

// 兜底（短文档或新建后填充）
edit_file({ path, content })
```

执行结果统一：

```ts
type ToolResult =
  | { ok: true; content: string; meta?: Record<string, unknown> }
  | { ok: false; error: string; retryable?: boolean };
```

### WorkspaceBridge 规则

- `read_file`：若文件已在标签页打开，**优先返回 tab 内容**（含未保存修改）；否则读磁盘
- `edit_file`：生成 `FileChange`，进入待应用队列，不直接写盘
- 用户 Accept 后：
  - 已打开 → 更新 tab content，标记 dirty（或按设置自动保存）
  - 未打开 → 写盘并刷新文件树
- 禁止绕过 `useWorkspaceManager` / 文档层另写一套文件系统状态

### 工具实现计划（逐项推进）

> 现状：`AgentLoop` / `ToolRegistry` / `pathPolicy` / 模式白名单已齐；**具体 handler 未注册**，面板仍写死 `mode: "chat"`。  
> 顺序：基础设施 → 只读（A2）→ 写入（A3）；`delete_file` 延后到 A4。

#### 0. 基础设施（所有工具共用，先做）

- [ ] **0.1 WorkspaceBridge**：从 `useWorkspaceManager` 抽出 `listDir` / `readFile` / `search` / `applyFileChange`；工具禁止直接调 Tauri FS  
  - 验收：打开 tab 未保存时，Bridge 读到的是 tab 内容
- [ ] **0.2 路径沙箱收紧**：`pathPolicy` 结合 Tauri `path` resolve；相对路径相对 `workspaceRoot`；禁止 `..` / 盘符逃逸  
  - 验收：越界路径一律拒绝
- [ ] **0.3 读取上限**：单文件字节/行数上限；超限返回 `ok: false` + 可重试提示  
  - 验收：大文件不拖垮上下文
- [ ] **0.4 工具注册入口**：`src/ai/tools/*.ts` + `registerBuiltinTools()`  
  - 验收：`resolveToolsForMode("agent-ask")` 非空
- [ ] **0.5 注入 ToolContext**：面板传入 `workspaceRoot` / `openTabs` / `activePath` + Bridge 回调  
  - 验收：工具能拿到真实工作区

#### 1. 只读工具（A2 · Agent Ask）

- [ ] **1.1 `list_dir`**：入参 `path`（默认工作区根）；返回名称、类型、相对路径  
  - 验收：Ask「工作区有哪些 md」能列目录并回答
- [ ] **1.2 `read_file`**：入参 `path`，可选行 `offset`/`limit`；tab 优先；走扩展名白名单 + 读取上限  
  - 验收：改 tab 未保存 → Agent 读到未保存内容
- [ ] **1.3 `search_workspace`**：复用现有全文搜索；结果截断回灌  
  - 验收：「某主题在哪些文档」能引用路径与片段
- [ ] **1.4 ToolCallCard**：消息流展示 `tool-call` / `tool-result`  
  - 验收：Ask 模式下可见正在读哪些文件
- [ ] **1.5 模式切换 + 能力门禁**：UI 支持 Chat / Agent Ask；不支持 tools 的 Provider 禁用 Ask；无工作区时只读工具失败文案明确  
  - 验收：Chat 不受影响；Ask 在无工作区时有清晰提示

#### 2. 写工具（A3 · Agent Edit）

- [ ] **2.1 `edit_file`**：优先 `{ path, old_string, new_string }`，兜底 `{ path, content }`；生成 `FileChange` → `queueFileChange`，不直接写盘；替换失败 `retryable: true`  
  - 验收：失败后模型可重读再试
- [ ] **2.2 DiffPanel + Accept/Reject**：队列 UI；Accept → `applyFileChange`（已打开更新 tab+dirty；未打开写盘并刷新树）；默认 `confirmPolicy: always`  
  - 验收：自然语言改 md → Diff 确认后状态正确
- [ ] **2.3 `create_file`（可选）**：同样进 Diff 队列  
  - 验收：可新建文本文件并经确认落地
- [ ] **2.4 `delete_file`**：默认禁用，不进模式白名单暴露；延后 A4

#### 建议批次

| 批次 | 项 | 目标 |
|------|----|------|
| 批次 1 | 0.1–0.5 → 1.1 → 1.2 → 1.4 → 1.5 | Ask 能列目录、读文件、看到工具卡片 |
| 批次 2 | 1.3 + 能力检测完善 | Ask 完整（搜 → 读 → 答） |
| 批次 3 | 2.1 → 2.2 →（可选）2.3 | Edit 经 Diff 落地；`delete_file` 不做 |

#### 落点对照

| 能力 | 已有 | 缺口 |
|------|------|------|
| 循环执行工具 | `agent/loop.ts` | 面板仍 `mode: "chat"`，无 `toolContext` |
| 模式白名单 | `agent/modes.ts` | handler 未注册 → `resolveToolsForMode` 为空 |
| 注册表 | `tools/registry.ts` | 无 `list_dir.ts` 等实现文件 |
| 沙箱/确认 | `safety/*` | 需真实 resolve + Diff 接线 |
| 读盘/搜 | `useWorkspaceManager` | 需 Bridge 适配，勿让 tool 直连 hook |
| `FileChange` | `types.ts` | DiffPanel + `applyFileChange` 未做 |

## 安全策略

- [ ] 路径沙箱：所有路径 resolve 后必须位于 `workspaceRoot` 内，禁止 `..` 逃逸
- [ ] 无工作区时：禁用 Agent 写工具；Chat 仅使用当前打开文档上下文
- [ ] 扩展名白名单（首版）：`.md` / `.markdown` / `.txt` 等文本；不改二进制媒体
- [ ] 写操作确认：`always`（默认）/ `session` / `auto`
- [ ] 上限：`maxToolRounds`（建议默认 8）、单文件读取字节/行数上限
- [ ] 本地审计日志：读过/改过/拒绝过的路径（便于排错与撤销）
- [ ] API Key：MVP 可先随设置存储；二期迁入 Tauri 侧加密存储

### Agent Edit 范围（v1）

- 可读：工作区内文本文件
- 默认可改：当前文档 + 用户明确点名的文件
- 批量改多文件：二次确认（Accept All）

## 分期计划

### A0：骨架与类型（为后续不返工）

- [x] 建立 `src/ai/` 目录与核心类型
- [x] 实现空的 `AgentLoop`（支持无工具直出）
- [x] 实现 `ProviderRegistry` + 各厂商独立 Adapter 骨架
- [x] 实现 `ToolRegistry` 接口（可不注册具体工具）
- [x] `AiSettings` 类型与读写（含预留的 agent 字段）

**验收：** Chat/Agent 模式枚举、tools 可选字段、设置结构一次定型，后续只加实现不改协议。  
**状态：** 2026-07-17 已完成。网络层刻意未接入（`ProviderNotReadyError`），留待 A1。各厂商一家一文件，互不复用请求拼装。

### A1：Chat MVP

- [x] 设置页 AI Tab：按供应商选择 Adapter + Profile（baseUrl / apiKey / model）+ 测试连接
- [x] 预置 OpenAI / DeepSeek / ChatGLM / 豆包 / Ollama / 自定义
- [x] 侧边栏 AI 面板：多轮对话、流式输出、停止生成
- [x] 上下文：当前文档 + 选区（无选区时带全文并截断提示）
- [x] 动作：复制、插入光标、替换选区
- [x] 命令面板接入
- [x] 网络层：各厂商在各自 Adapter 内实现流式 chat（当前为前端 fetch；Tauri HTTP 代理列为技术债）

**验收：** 配置任一已实现厂商后，可对当前 Markdown 完成润色/问答，并写回编辑器。  
**状态：** 2026-07-17 已完成。技术债：CORS 环境下需后续接入 Tauri `plugin-http` 或 Rust 代理。

### A2：Agent Ask（只读工具）

对应「工具实现计划」**0.x + 1.x**。

- [ ] 基础设施：WorkspaceBridge、沙箱收紧、读取上限、注册入口、注入 ToolContext（0.1–0.5）
- [ ] 启用 `list_dir` / `read_file`（1.1–1.2）
- [ ] `search_workspace` 复用现有全文搜索（1.3）
- [ ] 消息流展示 ToolCallCard（1.4）
- [ ] 模式切换 Chat / Agent Ask + Provider tools 能力门禁（1.5）

**验收：** 在工作区内询问「某主题在哪些文档」类问题，Agent 能读文件后给出有依据的回答。

### A3：Agent Edit（读 + 改）

对应「工具实现计划」**2.x**。

- [ ] 启用 `edit_file`（old/new 替换为主，整文件兜底）（2.1）
- [ ] DiffPanel：Accept / Reject / Accept All（2.2）
- [ ] `applyFileChange` 对接标签页与保存状态（2.2）
- [ ] 默认 `confirmPolicy: always`（2.2）
- [ ] 步数上限与失败回灌（替换失败时让模型重读再试）（2.1）
- [ ] （可选）`create_file`（2.3）

**验收：** 用户用自然语言要求修改当前或指定 Markdown，变更以 Diff 呈现，确认后正确写入且 dirty/文件树状态正确。

### A4：增强与硬化

- [ ] 多 Profile 切换与管理
- [ ] 会话历史本地持久化
- [ ] 预设指令：润色、翻译、总结、续写、修语法
- [ ] API Key 迁入 Rust 加密存储
- [ ] Anthropic Adapter
- [ ] Agent 变更 Undo 栈
- [ ] 拉取模型列表
- [ ] 删除类高危工具策略（默认禁用）

## 与主计划的关系

- 主计划 [PLAN.md](./PLAN.md)「后续候选功能 → AI模块」作为总入口
- 本文件跟踪 AI/Agent 的设计决策与分期任务
- 不阻塞 M1–M4 发布节奏；AI 作为独立增强能力推进

## 产品决策记录

- [x] 2026-07-17：AI 采用 Chat + 可插拔 Provider；设置中配置 baseUrl / apiKey / model
- [x] 2026-07-17：内部统一消息协议；对外一家一 Adapter，禁止共用 openai-compatible 工厂
- [x] 2026-07-17：Chat 作为无工具 Agent 实现，预留 tool_calls
- [x] 2026-07-17：Agent 重点预留读文件、改文件；写操作经 Diff 确认，经 WorkspaceBridge 落地
- [x] 2026-07-17：`edit_file` 优先 old_string/new_string，整文件写入仅兜底
- [x] 2026-07-17：首批厂商骨架：OpenAI、DeepSeek、ChatGLM、火山豆包、Ollama、自定义；Anthropic 占位
- [x] 2026-07-17：A1 网络层暂用前端 fetch；遇 CORS 时优先 Ollama/本地，后续再上 Tauri HTTP
- [ ] 确认 Agent Edit v1 是否允许直接改未打开文件（建议允许但需确认）
- [x] 2026-07-17：API Key 首版随 AiSettings 存 localStorage（二期再迁 Tauri 加密）

## 更新记录

- 2026-07-17：写入「工具实现计划（逐项推进）」——基础设施 0.x → Ask 1.x → Edit 2.x；A2/A3 与之对齐；`delete_file` 延后 A4。
- 2026-07-17：创建 AI/Agent 模块计划，明确 Chat MVP、Agent Ask、Agent Edit 分期与安全边界。
- 2026-07-17：完成 A0 骨架——`src/ai/` 核心类型、`AiSettings` 读写、`AgentLoop`、Provider/Tool Registry、路径与确认策略占位；网络层待 A1。
- 2026-07-17：Provider 改为一家一文件（openai / deepseek / chatglm / doubao / ollama / custom），删除共用 openaiCompatible 工厂。
- 2026-07-17：完成 A1 Chat MVP——设置 AI Tab、侧边栏对话、流式生成、插入/替换选区、命令面板；各厂商独立实现 SSE chat（前端 fetch）。
