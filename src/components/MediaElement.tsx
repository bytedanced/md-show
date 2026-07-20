import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";

type ImageProps = ComponentPropsWithoutRef<"img">;
type VideoProps = ComponentPropsWithoutRef<"video">;
type AudioProps = ComponentPropsWithoutRef<"audio">;

interface ResolvedMediaProps {
  documentPath: string | null;
  source?: string;
}

function isRemoteSource(source: string) {
  return /^(https?:|data:|blob:|asset:)/i.test(source);
}

function isAbsolutePath(source: string) {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(source);
}

function useResolvedMediaSource({ documentPath, source }: ResolvedMediaProps) {
  const [resolvedSource, setResolvedSource] = useState(source);

  useEffect(() => {
    let isActive = true;

    const resolveSource = async () => {
      if (!source || isRemoteSource(source) || !documentPath || !isTauri()) {
        setResolvedSource(source);
        return;
      }

      if (isAbsolutePath(source)) {
        setResolvedSource(undefined);
        return;
      }

      try {
        const documentDirectory = await dirname(documentPath);
        const localPath = await join(
          documentDirectory,
          decodeURIComponent(source),
        );

        if (isActive) {
          setResolvedSource(convertFileSrc(localPath));
        }
      } catch {
        if (isActive) {
          setResolvedSource(undefined);
        }
      }
    };

    void resolveSource();

    return () => {
      isActive = false;
    };
  }, [documentPath, source]);

  return resolvedSource;
}

function UnavailableMedia({ source }: { source?: string }) {
  return (
    <span className="media-unavailable">
      无法加载本地媒体{source ? `：${source}` : ""}
    </span>
  );
}

interface MediaImageProps extends ImageProps {
  documentPath: string | null;
}

export function MediaImage({
  alt = "",
  documentPath,
  src,
  ...props
}: MediaImageProps) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const resolvedSource = useResolvedMediaSource({ documentPath, source: src });
  const hasError = failedSource === resolvedSource;

  useEffect(() => {
    if (!isPreviewOpen) {
      return undefined;
    }

    const closePreviewOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPreviewOpen(false);
      }
    };

    window.addEventListener("keydown", closePreviewOnEscape);
    return () => window.removeEventListener("keydown", closePreviewOnEscape);
  }, [isPreviewOpen]);

  if (!resolvedSource || hasError) {
    return <UnavailableMedia source={src} />;
  }

  return (
    <>
      <button
        aria-label={`放大查看图片：${alt || "图片"}`}
        className="media-image-trigger"
        onClick={() => setIsPreviewOpen(true)}
        type="button"
      >
        <img
          {...props}
          alt={alt}
          className="markdown-media markdown-media--image"
          onError={() => setFailedSource(resolvedSource)}
          src={resolvedSource}
        />
      </button>
      {isPreviewOpen &&
        createPortal(
          <div
            aria-label="图片预览"
            aria-modal="true"
            className="image-lightbox"
            onMouseDown={() => setIsPreviewOpen(false)}
            role="dialog"
          >
            <button
              aria-label="关闭图片预览"
              className="image-lightbox__close"
              onClick={() => setIsPreviewOpen(false)}
              type="button"
            >
              ×
            </button>
            <img
              alt={alt}
              className="image-lightbox__image"
              onMouseDown={(event) => event.stopPropagation()}
              src={resolvedSource}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

interface MediaVideoProps extends VideoProps {
  documentPath: string | null;
}

export function MediaVideo({
  children,
  documentPath,
  src,
  ...props
}: MediaVideoProps) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const resolvedSource = useResolvedMediaSource({ documentPath, source: src });
  const hasError = failedSource === resolvedSource;

  if (!resolvedSource || hasError) {
    return <UnavailableMedia source={src} />;
  }

  return (
    <video
      {...props}
      className="markdown-media markdown-media--video"
      controls
      onError={() => setFailedSource(resolvedSource)}
      src={resolvedSource}
    >
      {children}
      浏览器不支持此视频格式。
    </video>
  );
}

interface MediaAudioProps extends AudioProps {
  documentPath: string | null;
}

export function MediaAudio({
  children,
  documentPath,
  src,
  ...props
}: MediaAudioProps) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const resolvedSource = useResolvedMediaSource({ documentPath, source: src });
  const hasError = failedSource === resolvedSource;

  if (!resolvedSource || hasError) {
    return <UnavailableMedia source={src} />;
  }

  return (
    <audio
      {...props}
      className="markdown-media markdown-media--audio"
      controls
      onError={() => setFailedSource(resolvedSource)}
      src={resolvedSource}
    >
      {children}
      浏览器不支持此音频格式。
    </audio>
  );
}
