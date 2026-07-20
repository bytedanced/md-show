import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}

export function ConfirmDialog({
  cancelLabel = "取消",
  confirmLabel = "确认",
  description,
  isOpen,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (isOpen && !dialog?.open) {
      dialog?.showModal();
    } else if (!isOpen && dialog?.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      aria-labelledby="confirm-dialog-title"
      className="dialog"
      onCancel={onCancel}
      onClose={onCancel}
      ref={dialogRef}
    >
      <div className="dialog__content">
        <div className="dialog__icon">?</div>
        <div>
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="dialog__actions">
        <button
          className="button button--ghost"
          onClick={onCancel}
          type="button"
        >
          {cancelLabel}
        </button>
        <button
          className="button button--primary"
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
