/**
 * 底层 HTTP 传输（与具体厂商协议无关）。
 * A1 使用前端 fetch；Tauri 代理（plugin-http / Rust）可作为后续增强以规避 CORS。
 */

export async function providerFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, init);
}

/** 逐条产出 SSE `data:` 载荷（已去掉前缀；遇到 [DONE] 结束）。 */
export async function* iterateSseDataPayloads(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error("响应没有可读流。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException("已取消生成", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) {
          continue;
        }
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload) {
          continue;
        }
        if (payload === "[DONE]") {
          return;
        }
        yield payload;
      }
    }

    const rest = buffer.trim();
    if (rest.startsWith("data:")) {
      const payload = rest.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) {
    return `HTTP ${response.status}`;
  }
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof json.error === "string") {
      return json.error;
    }
    if (json.error && typeof json.error === "object" && json.error.message) {
      return json.error.message;
    }
    if (typeof json.message === "string") {
      return json.message;
    }
  } catch {
    // fall through
  }
  return text.slice(0, 400);
}
