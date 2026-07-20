import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToastMessage } from "../components/Toast";

const RECENT_FILES_KEY = "md-show-recent-files";
const MAX_RECENT_FILES = 8;

export interface RecentFile {
  name: string;
  path: string;
  updatedAt: number;
}

interface DocumentState {
  content: string;
  filePath: string | null;
  savedContent: string;
}

interface PendingConfirmation {
  action: () => void | Promise<void>;
  description: string;
  title: string;
}

type Notify = (message: Omit<ToastMessage, "id">) => void;

const markdownFilters = [
  {
    name: "Markdown 文档",
    extensions: ["md", "markdown", "mdown", "mkd"],
  },
];

function getFileName(path: string | null) {
  if (!path) {
    return "未命名.md";
  }

  return path.split(/[\\/]/).pop() || "未命名.md";
}

function ensureMarkdownExtension(path: string) {
  return /\.(md|markdown|mdown|mkd)$/i.test(path) ? path : `${path}.md`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function loadRecentFiles(): RecentFile[] {
  try {
    const saved = localStorage.getItem(RECENT_FILES_KEY);
    return saved ? (JSON.parse(saved) as RecentFile[]) : [];
  } catch {
    return [];
  }
}

export function useDocumentManager(notify: Notify) {
  const [documentState, setDocumentState] = useState<DocumentState>({
    content: "",
    filePath: null,
    savedContent: "",
  });
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecentFiles);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const allowWindowCloseRef = useRef(false);
  const isDirtyRef = useRef(false);

  const isDirty = documentState.content !== documentState.savedContent;
  const fileName = useMemo(
    () => getFileName(documentState.filePath),
    [documentState.filePath],
  );

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const rememberFile = useCallback((path: string) => {
    setRecentFiles((currentFiles) => {
      const nextFile = {
        name: getFileName(path),
        path,
        updatedAt: Date.now(),
      };
      const nextFiles = [
        nextFile,
        ...currentFiles.filter((file) => file.path !== path),
      ].slice(0, MAX_RECENT_FILES);

      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(nextFiles));
      return nextFiles;
    });
  }, []);

  const updateContent = useCallback((content: string) => {
    setDocumentState((currentDocument) => ({
      ...currentDocument,
      content,
    }));
  }, []);

  const readDocument = useCallback(
    async (path: string) => {
      try {
        const content = await readTextFile(path);
        setDocumentState({
          content,
          filePath: path,
          savedContent: content,
        });
        rememberFile(path);
        notify({
          message: getFileName(path),
          title: "文档已打开",
          tone: "info",
        });
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法打开文档",
          tone: "error",
        });
      }
    },
    [notify, rememberFile],
  );

  const chooseAndReadDocument = useCallback(
    async (defaultPath?: string) => {
      try {
        const selectedPath = await open({
          defaultPath,
          directory: false,
          filters: markdownFilters,
          multiple: false,
          title: "打开 Markdown 文档",
        });

        if (typeof selectedPath === "string") {
          await readDocument(selectedPath);
        }
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法选择文档",
          tone: "error",
        });
      }
    },
    [notify, readDocument],
  );

  const requestAfterDiscard = useCallback(
    (
      action: () => void | Promise<void>,
      title: string,
      description: string,
    ) => {
      if (!isDirty) {
        void action();
        return;
      }

      setPendingConfirmation({ action, description, title });
    },
    [isDirty],
  );

  const newDocument = useCallback(() => {
    requestAfterDiscard(
      () =>
        setDocumentState({
          content: "",
          filePath: null,
          savedContent: "",
        }),
      "放弃当前修改？",
      "当前文档尚未保存。继续新建将丢失这些修改。",
    );
  }, [requestAfterDiscard]);

  const openDocument = useCallback(() => {
    requestAfterDiscard(
      () => chooseAndReadDocument(),
      "放弃当前修改？",
      "当前文档尚未保存。继续打开其他文档将丢失这些修改。",
    );
  }, [chooseAndReadDocument, requestAfterDiscard]);

  const openRecentDocument = useCallback(
    (recentFile: RecentFile) => {
      requestAfterDiscard(
        () => chooseAndReadDocument(recentFile.path),
        "放弃当前修改？",
        "当前文档尚未保存。继续打开最近文档将丢失这些修改。",
      );
    },
    [chooseAndReadDocument, requestAfterDiscard],
  );

  const saveDocument = useCallback(
    async (saveAs = false) => {
      try {
        let destination = saveAs ? null : documentState.filePath;

        if (!destination) {
          destination = await save({
            defaultPath: fileName,
            filters: markdownFilters,
            title: saveAs ? "Markdown 文档另存为" : "保存 Markdown 文档",
          });
        }

        if (!destination) {
          return false;
        }

        destination = ensureMarkdownExtension(destination);
        const contentToSave = documentState.content;
        await writeTextFile(destination, contentToSave);
        setDocumentState((currentDocument) => ({
          ...currentDocument,
          filePath: destination,
          savedContent: contentToSave,
        }));
        rememberFile(destination);
        notify({
          message: getFileName(destination),
          title: saveAs ? "文档已另存为" : "文档已保存",
          tone: "info",
        });
        return true;
      } catch (error) {
        notify({
          message: getErrorMessage(error),
          title: "无法保存文档",
          tone: "error",
        });
        return false;
      }
    },
    [
      documentState.content,
      documentState.filePath,
      fileName,
      notify,
      rememberFile,
    ],
  );

  const cancelPendingConfirmation = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const confirmPendingAction = useCallback(() => {
    const action = pendingConfirmation?.action;
    setPendingConfirmation(null);
    if (action) {
      void action();
    }
  }, [pendingConfirmation]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        newDocument();
      } else if (key === "o") {
        event.preventDefault();
        openDocument();
      } else if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [newDocument, openDocument, saveDocument]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return undefined;
    }

    let removeCloseListener: (() => void) | undefined;
    let isDisposed = false;

    const registerCloseListener = async () => {
      try {
        const unlisten = await getCurrentWindow().onCloseRequested((event) => {
          if (allowWindowCloseRef.current || !isDirtyRef.current) {
            return;
          }

          event.preventDefault();
          setPendingConfirmation({
            action: async () => {
              allowWindowCloseRef.current = true;
              await getCurrentWindow().destroy();
            },
            description: "当前文档尚未保存。关闭应用将丢失这些修改。",
            title: "确定关闭应用？",
          });
        });

        if (isDisposed) {
          unlisten();
        } else {
          removeCloseListener = unlisten;
        }
      } catch {
        // 浏览器预览模式没有 Tauri 窗口事件。
      }
    };

    void registerCloseListener();

    return () => {
      isDisposed = true;
      removeCloseListener?.();
    };
  }, []);

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  return {
    cancelPendingConfirmation,
    confirmPendingAction,
    content: documentState.content,
    fileName,
    filePath: documentState.filePath,
    isDirty,
    newDocument,
    openDocument,
    openRecentDocument,
    pendingConfirmation,
    recentFiles,
    saveAsDocument: () => saveDocument(true),
    saveDocument: () => saveDocument(false),
    updateContent,
  };
}
