import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface Toast {
  id: number;
  kind: "ok" | "error";
  message: string;
}

const Ctx = createContext<{ ok: (m: string) => void; error: (m: string) => void }>({ ok: () => {}, error: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  const ok = useCallback((m: string) => push("ok", m), [push]);
  const error = useCallback((m: string) => push("error", m), [push]);
  return (
    <Ctx.Provider value={{ ok, error }}>
      {children}
      <div className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 max-w-sm rounded-md px-3.5 py-2.5 text-[13px] shadow-lg border ${
              t.kind === "ok" ? "bg-ai-900 text-white border-ai-900" : "bg-white text-ng border-ng/40"
            }`}
          >
            {t.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-asagi-400" /> : <AlertCircle className="size-4 mt-0.5 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
