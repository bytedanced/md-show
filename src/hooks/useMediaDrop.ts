import { getCurrentWindow } from "@tauri-apps/api/window";
import { basename, dirname, join } from "@tauri-apps/api/path";
import { copyFile, mkdir } from "@tauri-apps/plugin-fs";
import { useEffect, useRef, useState } from "react";

const imageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const videoExtensions = new Set(["m4v", "mov", "mp4", "ogg", "ogv", "webm"]);
const audioExtensions = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
]);

interface UseMediaDropOptions {
  content: string;
  documentPath: string | null;
  onContentChange: (content: string) => void;
  onNotice: (message: string, isError?: boolean) => void;
}

function getMediaSnippet(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const relativePath = `./assets/${fileName}`;

  if (imageExtensions.has(extension)) {
    return `![${fileName}](${relativePath})`;
  }

  if (videoExtensions.has(extension)) {
    return `@[video](${relativePath})`;
  }

  if (audioExtensions.has(extension)) {
    return `@[audio](${relativePath})`;
  }

  return null;
}

export function useMediaDrop({
  content,
  documentPath,
  onContentChange,
  onNotice,
}: UseMediaDropOptions) {
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const latestContentRef = useRef(content);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return undefined;
    }

    let unlisten: (() => void) | undefined;

    const registerDropListener = async () => {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
          if (event.payload.type === "enter") {
            setIsDraggingMedia(true);
            return;
          }

          if (event.payload.type === "leave") {
            setIsDraggingMedia(false);
            return;
          }

          if (event.payload.type !== "drop") {
            return;
          }

          setIsDraggingMedia(false);

          if (!documentPath) {
            onNotice("请先保存文档，再拖入媒体文件。", true);
            return;
          }

          try {
            const documentDirectory = await dirname(documentPath);
            const assetsDirectory = await join(documentDirectory, "assets");
            await mkdir(assetsDirectory, { recursive: true });

            const snippets = await Promise.all(
              event.payload.paths.map(async (sourcePath, index) => {
                const originalName = await basename(sourcePath);
                const snippet = getMediaSnippet(originalName);
                if (!snippet) {
                  return null;
                }

                const targetName = `${Date.now()}-${index}-${originalName}`;
                await copyFile(
                  sourcePath,
                  await join(assetsDirectory, targetName),
                );
                return snippet.replace(originalName, targetName);
              }),
            );
            const validSnippets = snippets.filter(
              (snippet): snippet is string => snippet !== null,
            );

            if (validSnippets.length === 0) {
              onNotice("未找到可用的图片、视频或音频文件。", true);
              return;
            }

            const separator = latestContentRef.current.trim() ? "\n\n" : "";
            onContentChange(
              `${latestContentRef.current}${separator}${validSnippets.join("\n\n")}`,
            );
            onNotice(
              `已添加 ${validSnippets.length} 个媒体文件到 assets 目录。`,
            );
          } catch {
            onNotice("媒体导入失败，请确认文件可读取且文档目录可写入。", true);
          }
        });
      } catch {
        // 浏览器预览模式没有 Tauri 拖放事件。
      }
    };

    void registerDropListener();
    return () => unlisten?.();
  }, [documentPath, onContentChange, onNotice]);

  return isDraggingMedia;
}
