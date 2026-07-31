import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parse as parseYaml } from "yaml";
import "katex/dist/katex.min.css";
import { rehypeSourceLine } from "../lib/rehypeSourceLine";
import { sourceLineProps } from "../lib/sourceLine";
import { MediaAudio, MediaImage, MediaVideo } from "./MediaElement";

type CodeProps = ComponentPropsWithoutRef<"code">;
type PositionNode = {
  position?: { start?: { line?: number } };
};

const ANCHORED_BLOCK_TAGS = [
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "ul",
] as const;

function createAnchoredBlockComponent(
  tag: (typeof ANCHORED_BLOCK_TAGS)[number],
  lineOffset: number,
) {
  return function AnchoredBlock({
    children,
    node,
    ...props
  }: {
    children?: ReactNode;
    node?: PositionNode;
    [key: string]: unknown;
  }) {
    return createElement(
      tag,
      {
        ...props,
        ...sourceLineProps(node?.position?.start?.line, lineOffset),
      },
      children,
    );
  };
}

function TableWrapper({
  children,
  node,
  lineOffset,
  ...props
}: {
  children?: ReactNode;
  node?: PositionNode;
  lineOffset: number;
  [key: string]: unknown;
}) {
  return (
    <div
      className="table-wrapper"
      {...sourceLineProps(node?.position?.start?.line, lineOffset)}
    >
      <table {...props}>{children}</table>
    </div>
  );
}

export type PreviewTheme = "paper" | "midnight" | "sepia" | "ocean";

interface MarkdownPreviewProps {
  content: string;
  customCss?: string;
  documentPath: string | null;
  previewTheme?: PreviewTheme;
}

const mediaSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "audio", "source", "video"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataSourceLine"],
    audio: ["autoplay", "controls", "loop", "muted", "preload", "src"],
    source: ["src", "type"],
    video: [
      "autoplay",
      "controls",
      "height",
      "loop",
      "muted",
      "playsinline",
      "poster",
      "preload",
      "src",
      "width",
    ],
  },
};

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function transformMediaDirectives(markdown: string) {
  return markdown
    .replace(
      /@\[video\]\((\S+?)(?:\s+"([^"]*)")?\)/g,
      (_, source: string, title?: string) =>
        `<video controls src="${escapeAttribute(source)}"${title ? ` title="${escapeAttribute(title)}"` : ""
        }></video>`,
    )
    .replace(
      /@\[audio\]\((\S+?)(?:\s+"([^"]*)")?\)/g,
      (_, source: string, title?: string) =>
        `<audio controls src="${escapeAttribute(source)}"${title ? ` title="${escapeAttribute(title)}"` : ""
        }></audio>`,
    );
}

function splitFrontMatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      body: content,
      data: null as Record<string, unknown> | null,
      lineOffset: 0,
    };
  }

  const lineOffset = match[0].split(/\r\n|\r|\n/).length;

  try {
    const data = parseYaml(match[1]);
    return {
      body: content.slice(match[0].length),
      data:
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null,
      lineOffset,
    };
  } catch {
    return {
      body: content,
      data: null as Record<string, unknown> | null,
      lineOffset: 0,
    };
  }
}

function MermaidDiagram({
  lineOffset = 0,
  source,
  sourceLine,
}: {
  lineOffset?: number;
  source: string;
  sourceLine?: number;
}) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          securityLevel: "strict",
          startOnLoad: false,
          theme: "base",
        });
        const result = await mermaid.render(`mermaid-${id}`, source);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setSvg("");
          setError(
            renderError instanceof Error ? renderError.message : "图表语法无效",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error) {
    return (
      <pre
        className="mermaid-error"
        title={error}
        {...sourceLineProps(sourceLine, lineOffset)}
      >
        Mermaid 图表无法渲染：{error}
      </pre>
    );
  }

  return svg ? (
    <div
      aria-label="Mermaid 图表"
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      {...sourceLineProps(sourceLine, lineOffset)}
    />
  ) : (
    <div
      className="mermaid-loading"
      {...sourceLineProps(sourceLine, lineOffset)}
    >
      正在渲染 Mermaid 图表…
    </div>
  );
}

function CodeBlock({
  children,
  className,
  lineOffset = 0,
  node,
  ...props
}: CodeProps & { lineOffset?: number; node?: { position?: { start?: { line?: number } } } }) {
  const [copied, setCopied] = useState(false);
  const isBlock = className?.startsWith("language-");
  const source = String(children).replace(/\n$/, "");

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [source]);

  const sourceLine = node?.position?.start?.line;

  if (className?.includes("language-mermaid")) {
    return (
      <MermaidDiagram
        lineOffset={lineOffset}
        source={source}
        sourceLine={sourceLine}
      />
    );
  }

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <span
      className="code-block"
      {...sourceLineProps(sourceLine, lineOffset)}
    >
      <button
        aria-label="复制代码"
        className="code-block__copy"
        onClick={() => void copyCode()}
        type="button"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <code className={className} {...props}>
        {children}
      </code>
    </span>
  );
}

export function MarkdownPreview({
  content,
  customCss = "",
  documentPath,
  previewTheme = "paper",
}: MarkdownPreviewProps) {
  const { body, data, lineOffset } = splitFrontMatter(content);
  const markdownComponents = useMemo(
    () => ({
      ...Object.fromEntries(
        ANCHORED_BLOCK_TAGS.map((tag) => [
          tag,
          createAnchoredBlockComponent(tag, lineOffset),
        ]),
      ),
      audio: ({ node, ...props }: ComponentPropsWithoutRef<"audio"> & { node?: PositionNode }) => (
        <div {...sourceLineProps(node?.position?.start?.line, lineOffset)}>
          <MediaAudio {...props} documentPath={documentPath} />
        </div>
      ),
      code: ({ node, ...props }: CodeProps & { node?: PositionNode }) => (
        <CodeBlock {...props} lineOffset={lineOffset} node={node} />
      ),
      img: ({ node, ...props }: ComponentPropsWithoutRef<"img"> & { node?: PositionNode }) => (
        <div {...sourceLineProps(node?.position?.start?.line, lineOffset)}>
          <MediaImage {...props} documentPath={documentPath} />
        </div>
      ),
      video: ({ node, ...props }: ComponentPropsWithoutRef<"video"> & { node?: PositionNode }) => (
        <div {...sourceLineProps(node?.position?.start?.line, lineOffset)}>
          <MediaVideo {...props} documentPath={documentPath} />
        </div>
      ),
      table: ({ node, ...props }: ComponentPropsWithoutRef<"table"> & { node?: PositionNode }) => (
        <TableWrapper {...props} lineOffset={lineOffset} node={node} />
      ),
    }),
    [documentPath, lineOffset],
  );

  if (!body.trim()) {
    return (
      <div className="preview-empty">
        <div className="media-preview__art">
          <span>MARKDOWN</span>
        </div>
        <div>
          <strong>当前文档为空</strong>
          <p>在左侧编辑区输入内容，预览会自动更新。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`markdown-preview markdown-preview--${previewTheme}`}>
      {customCss && <style>{customCss}</style>}
      {data && (
        <dl className="front-matter">
          {Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, mediaSchema],
          rehypeHighlight,
          rehypeKatex,
          [rehypeSourceLine, { lineOffset }],
        ]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {transformMediaDirectives(body)}
      </ReactMarkdown>
    </div>
  );
}
