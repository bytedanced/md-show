import type {
  FileChange,
  JsonSchema,
  OpenTabSnapshot,
  ToolDefinition,
  ToolResult,
} from "../types";
import type { WorkspaceBridge } from "../workspace/bridge";

export interface RunCommandOptions {
  command: string;
  cwd?: string;
  timeout?: number;
  /** 指定 shell：cmd/powershell/gitbash/sh/bash/zsh。省略按平台默认。 */
  shell?: string;
}

export interface RunCommandResult {
  command: string;
  cwd: string;
  shell: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ToolContext {
  workspaceRoot: string | null;
  openTabs: OpenTabSnapshot[];
  activePath: string | null;
  /** 工作区读写出口；只读/写工具均经此访问，禁止直连 FS。 */
  bridge?: WorkspaceBridge;
  /** 写操作真正落地的唯一出口（由应用层注入，A3 对接）。 */
  applyFileChange?: (change: FileChange) => Promise<void>;
  /** 将变更放入待确认队列（A3 DiffPanel）。 */
  queueFileChange?: (change: FileChange) => Promise<void>;
  /** shell 命令执行出口（由应用层注入，bash 工具经此调用）。 */
  runCommand?: (options: RunCommandOptions) => Promise<RunCommandResult>;
}

export interface ToolHandler extends ToolDefinition {
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool(handler: ToolHandler): ToolHandler {
  return handler;
}

export function toToolDefinition(handler: ToolHandler): ToolDefinition {
  return {
    name: handler.name,
    description: handler.description,
    inputSchema: handler.inputSchema,
    mutates: handler.mutates,
  };
}

export type { JsonSchema, ToolDefinition, ToolResult };
