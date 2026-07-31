import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import type { Extension } from "@codemirror/state";

/**
 * 按文件扩展名返回对应的 CodeMirror 语言扩展。
 * 未识别的扩展名返回 null（纯文本，无语法高亮）。
 */
export function getLanguageExtension(path: string | null): Extension[] {
  if (!path) {
    return [markdown()];
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "md":
    case "markdown":
    case "mdown":
    case "mkd":
      return [markdown()];
    case "js":
    case "mjs":
    case "cjs":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [json()];
    case "py":
      return [python()];
    case "html":
    case "htm":
      return [html()];
    case "css":
      return [css()];
    case "scss":
    case "sass":
      return [css()];
    case "rs":
      return [rust()];
    case "go":
      return [go()];
    case "sql":
      return [sql()];
    case "xml":
    case "svg":
    case "rss":
    case "atom":
      return [xml()];
    case "yml":
    case "yaml":
      return [yaml()];
    case "java":
      return [java()];
    case "c":
      return [cpp()];
    case "cc":
    case "cpp":
    case "cxx":
    case "h":
    case "hh":
    case "hpp":
      return [cpp()];
    case "sh":
    case "bash":
    case "zsh":
      // shell 走 shell 语言（codemirror 没独立 shell 包，用纯文本近似）
      return [];
    default:
      return [];
  }
}

/** 是否是 Markdown 文件（决定是否显示预览栏）。 */
export function isMarkdownPath(path: string | null): boolean {
  if (!path) return true;
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}
