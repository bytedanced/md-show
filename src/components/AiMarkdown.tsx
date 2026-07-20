import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface AiMarkdownProps {
  content: string;
}

const chatSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
  },
};

export function AiMarkdown({ content }: AiMarkdownProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="ai-markdown">
      <ReactMarkdown
        rehypePlugins={[[rehypeSanitize, chatSchema], rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
