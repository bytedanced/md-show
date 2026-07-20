import { useEffect } from "react";

export interface ToastMessage {
  id: number;
  message: string;
  title: string;
  tone?: "error" | "info";
}

interface ToastProps {
  onDismiss: () => void;
  toast: ToastMessage | null;
}

export function Toast({ onDismiss, toast }: ToastProps) {
  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast]);

  if (!toast) {
    return null;
  }

  return (
    <div
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className={`toast toast--${toast.tone ?? "info"}`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span className="toast__mark">{toast.tone === "error" ? "!" : "i"}</span>
      <div className="toast__body">
        <strong>{toast.title}</strong>
        <span>{toast.message}</span>
      </div>
      <button
        aria-label="关闭提示"
        className="toast__close"
        onPointerDown={(event) => {
          event.preventDefault();
          onDismiss();
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
