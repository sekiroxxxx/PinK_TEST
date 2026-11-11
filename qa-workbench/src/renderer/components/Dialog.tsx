import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import { hasHostAccess } from "../browserBridge";
import { Feedback } from "./Feedback";

export const DialogDraftSlot = createContext<HTMLElement | null>(null);

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  side = false,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const feedback = useContext(Feedback);
  const [draftSlot, setDraftSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={[
        "dialog",
        side ? "side-editor" : wide ? "wide" : "",
        footer ? "with-footer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button aria-label="关闭弹窗" onClick={onClose} className="icon-button">
          ×
        </button>
      </header>
      <DialogDraftSlot.Provider value={draftSlot}>
        <div className="dialog-body">
          {feedback.error && (
            <div className="notice error-text" role="alert">
              {feedback.text}
            </div>
          )}
          {children}
        </div>
      </DialogDraftSlot.Provider>
      <div className="dialog-draft-slot" ref={setDraftSlot} />
      {footer && (
        <footer className="dialog-actions dialog-footer">{footer}</footer>
      )}
    </dialog>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">
        ＋
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function PathInput({
  label,
  value,
  onChange,
  kind = "directory",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  kind?: "file" | "directory";
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="path-input">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          disabled={!hasHostAccess}
          title={!hasHostAccess ? "浏览器中请手动填写路径" : undefined}
          onClick={() => {
            void window.qa.pickPath(kind).then((path) => {
              if (path) onChange(path);
            });
          }}
        >
          选择
        </button>
      </span>
    </label>
  );
}
