interface StatusBarProps {
  content: string;
  editorFontSize: number;
  filePath: string | null;
  isDirty: boolean;
  previewFontSize: number;
  readingMinutes: number;
  wordCount: number;
}

export function StatusBar({
  content,
  editorFontSize,
  filePath,
  isDirty,
  previewFontSize,
  readingMinutes,
  wordCount,
}: StatusBarProps) {
  const lineCount = Math.max(1, content.split(/\r\n|\r|\n/).length);

  return (
    <footer className="status-bar">
      <div>
        <span className="status-bar__ready">
          <i />
          {isDirty ? "未保存" : "就绪"}
        </span>
        <span>UTF-8</span>
        <span>Markdown</span>
        <span
          className="status-bar__font-size"
          title="编辑区 / 预览区字号（Ctrl+= / Ctrl+- 调整）"
        >
          字号 {editorFontSize}/{previewFontSize}
        </span>
      </div>
      <div>
        <span>{filePath ?? "尚未保存到本地"}</span>
        <span>{lineCount} 行</span>
        <span>{content.length} 字符</span>
        <span>{wordCount} 字</span>
        <span>约 {readingMinutes} 分钟</span>
      </div>
    </footer>
  );
}
