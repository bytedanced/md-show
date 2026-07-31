import { PathPolicyError } from "../safety/pathPolicy";
import type { ToolResult } from "../types";

export function toolOk(
  content: string,
  meta?: Record<string, unknown>,
): ToolResult {
  return meta ? { ok: true, content, meta } : { ok: true, content };
}

export function toolErr(error: string, retryable = false): ToolResult {
  return { ok: false, error, retryable };
}

export function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export function readString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export function readPositiveInt(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

export function readBool(
  input: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

export function catchToolError(error: unknown): ToolResult {
  if (error instanceof PathPolicyError) {
    return toolErr(error.message, error.code === "no-workspace" ? false : true);
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolErr(message, true);
}
