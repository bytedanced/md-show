import { useEffect, useRef, useState } from "react";

interface InputDialogProps {
  description: string;
  initialValue?: string;
  isOpen: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  title: string;
}

export function InputDialog({
  description,
  initialValue = "",
  isOpen,
  label,
  onCancel,
  onConfirm,
  title,
}: InputDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && !dialog?.open) {
      setValue(initialValue);
      dialog?.showModal();
      window.setTimeout(() => inputRef.current?.select());
    } else if (!isOpen && dialog?.open) {
      dialog.close();
    }
  }, [initialValue, isOpen]);

  const submit = () => {
    const normalizedValue = value.trim();
    if (normalizedValue) {
      onConfirm(normalizedValue);
    }
  };

  return (
    <dialog
      aria-labelledby="input-dialog-title"
      className="dialog input-dialog"
      onCancel={onCancel}
      ref={dialogRef}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="dialog__content">
          <div className="dialog__icon">✎</div>
          <div>
            <h2 id="input-dialog-title">{title}</h2>
            <p>{description}</p>
            <label className="input-dialog__field">
              <span>{label}</span>
              <input
                onChange={(event) => setValue(event.currentTarget.value)}
                ref={inputRef}
                value={value}
              />
            </label>
          </div>
        </div>
        <div className="dialog__actions">
          <button
            className="button button--ghost"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="button button--primary"
            disabled={!value.trim()}
            type="submit"
          >
            确认
          </button>
        </div>
      </form>
    </dialog>
  );
}
