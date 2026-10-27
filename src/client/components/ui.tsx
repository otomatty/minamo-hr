import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { addMonths } from "../../shared/dates";
import { monthJa } from "../lib/format";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "ok";

export function Button({
  variant = "secondary",
  size,
  loading,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "lg"; loading?: boolean }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, required, children, className = "" }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="text-ng ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string | number; label: string }>; placeholder?: string }) {
  return (
    <select {...props} className={`input ${props.className ?? ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className ?? ""}`} />;
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer select-none">
      <input type="checkbox" className="mt-0.5 size-4 accent-ai-800" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5">
      {back && <div className="mb-2 text-xs">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {sub && <div className="text-[13px] text-ink-3 mt-0.5">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, actions, children, className = "", bodyClass = "p-4" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Pill({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`pill ${cls}`}>{children}</span>;
}

export function Spinner({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-ink-3 text-[13px]" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-ng/30 bg-ng-bg px-4 py-3 text-[13px] text-ng flex items-center justify-between gap-3" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          再読み込み
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-12 px-4 text-center">
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      {children && <p className="text-[13px] text-ink-3 mt-1 max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`w-[calc(100%-2rem)] ${width} rounded-lg border border-line p-0 shadow-[0_20px_60px_-20px_rgba(15,34,56,.45)] backdrop:bg-ai-950/40 m-auto`}
    >
      {open && (
        <div className="flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-2">
            <h2 id={titleId} className="text-[15px] font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm px-1.5" aria-label="閉じる">
              <X className="size-4" />
            </button>
          </div>
          <div className="px-5 py-4 overflow-y-auto">{children}</div>
          {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line-2 bg-surface/50">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ key: T; label: ReactNode }>; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line mb-4 overflow-x-auto no-print" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-[13px] whitespace-nowrap border-b-2 -mb-px ${value === t.key ? "border-ai-800 text-ink font-semibold" : "border-transparent text-ink-3 hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="inline-flex items-center rounded-[5px] border border-line bg-white">
      <button type="button" className="px-2 h-9 hover:bg-ai-50 rounded-l-[5px]" onClick={() => onChange(addMonths(month, -1))} aria-label="前の月">
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-3 text-[13px] font-medium num min-w-[7.5rem] text-center">{monthJa(month)}</span>
      <button type="button" className="px-2 h-9 hover:bg-ai-50 rounded-r-[5px]" onClick={() => onChange(addMonths(month, 1))} aria-label="次の月">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "ng" }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`text-lg font-semibold num ${tone === "ng" ? "text-ng" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function DefList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2.5 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words">{v === null || v === undefined || v === "" ? <span className="text-ink-3">-</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const ch = name.trim().charAt(0) || "?";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.5 0.08 ${(h % 120) + 190})` }}
    >
      {ch}
    </span>
  );
}
