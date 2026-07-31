import { defineTool } from "./types";
import type { RunCommandOptions, RunCommandResult } from "./types";
import {
  asRecord,
  catchToolError,
  readPositiveInt,
  readString,
  toolErr,
  toolOk,
} from "./helpers";

/**
 * 执行 shell 命令；进程派发由应用层经 ToolContext.runCommand 注入。
 * Windows 默认 powershell -NoProfile -Command，macOS 默认 zsh -c，Linux 默认 bash -c。
 * 可通过 shell 参数显式指定（cmd/powershell/gitbash/sh/bash/zsh）。
 */
export const bashTool = defineTool({
  name: "bash",
  description:
    "执行 shell 命令。Windows 默认 powershell -NoProfile -Command，macOS 默认 zsh -c，Linux 默认 bash -c；可通过 shell 参数指定（cmd/powershell/gitbash/sh/bash/zsh）。Windows 下选择 gitbash 将使用 Git for Windows 提供的 bash（自动探测常见安装路径，未找到则回退到 PATH 中的 bash）。默认在工作区根目录运行，可用 cwd 切换工作目录。返回 stdout、stderr、退出码与耗时。该工具会真实执行命令，请避免破坏性或不可逆操作。",
  mutates: true,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的 shell 命令字符串。",
      },
      cwd: {
        type: "string",
        description:
          "命令工作目录；相对工作区根或绝对路径。默认工作区根。允许在工作区外执行。",
      },
      timeout: {
        type: "integer",
        description: "执行超时（毫秒），默认 60000。",
        minimum: 1,
      },
      shell: {
        type: "string",
        description:
          "指定 shell：cmd/powershell/gitbash/sh/bash/zsh。省略则按平台默认（Windows→powershell、macOS→zsh、Linux→bash）。Windows 下 gitbash 使用 Git Bash 执行，适合需要 Unix 风格命令（ls/grep/find/sed 等）的场景。",
        enum: ["cmd", "powershell", "gitbash", "sh", "bash", "zsh"],
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    if (!ctx.runCommand) {
      return toolErr("未注入 runCommand 回调，无法执行 shell 命令。", false);
    }

    try {
      const record = asRecord(input);
      const command = readString(record, "command")?.trim();
      if (!command) {
        return toolErr("缺少 command 参数。", true);
      }

      const options: RunCommandOptions = {
        command,
        cwd:
          readString(record, "cwd")?.trim() || ctx.workspaceRoot || undefined,
        timeout: readPositiveInt(record, "timeout"),
        shell: readString(record, "shell")?.trim() || undefined,
      };

      const result: RunCommandResult = await ctx.runCommand(options);

      const header = [
        `command: ${result.command}`,
        `cwd: ${result.cwd}`,
        `shell: ${result.shell}`,
        `exitCode: ${result.exitCode}`,
        `duration: ${result.durationMs}ms`,
        result.timedOut ? "timedOut: true" : "timedOut: false",
      ].join("\n");

      const sections: string[] = [header];
      if (result.stdout) {
        sections.push(`--- stdout ---\n${result.stdout}`);
      }
      if (result.stderr) {
        sections.push(`--- stderr ---\n${result.stderr}`);
      }
      if (!result.stdout && !result.stderr) {
        sections.push("（无输出）");
      }

      return toolOk(sections.join("\n\n"), {
        command: result.command,
        cwd: result.cwd,
        shell: result.shell,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      });
    } catch (error) {
      return catchToolError(error);
    }
  },
});
