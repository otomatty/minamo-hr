import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Checkbox, Field, Input } from "../components/ui";

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] bg-white">
      <div className="hidden lg:flex flex-col justify-between bg-ai-900 text-ai-100 p-12 relative overflow-hidden">
        <svg className="absolute inset-x-0 bottom-0 w-full opacity-30" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M0 ${120 + i * 30} C 150 ${90 + i * 30}, 300 ${150 + i * 30}, 600 ${110 + i * 30}`} stroke="#6fb3bf" strokeWidth="1.2" fill="none" opacity={1 - i * 0.14} />
          ))}
        </svg>
        <div className="flex items-center gap-3 relative">
          <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#2f7f8f" />
            <path d="M6 13c3-3 6-3 10 0s7 3 10 0" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M6 20c3-3 6-3 10 0s7 3 10 0" stroke="#ddeff2" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".7" />
          </svg>
          <span className="text-white text-lg font-semibold tracking-wide">ミナモ</span>
        </div>
        <div className="relative max-w-sm">
          <p className="text-2xl leading-snug text-white font-semibold">勤怠、申請、給与を<br />ひとつの流れに。</p>
          <p className="mt-4 text-[13px] text-ai-200 leading-relaxed">打刻から月次の締め、承認、給与明細の配信までを一つの画面で扱う人事労務システムです。</p>
        </div>
        <div className="relative text-[11px] text-ai-200/60">Cloudflare Workers / D1 / R2 / KV で動作</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className={`w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>{children}</div>
      </div>
    </div>
  );
}

export function LoginPage({ appName }: { appName: string }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <h1 className="text-xl font-semibold">{appName} にログイン</h1>
      <p className="text-[13px] text-ink-3 mt-1">会社から案内されたメールアドレスとパスワードを入力してください。</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="メールアドレス">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="パスワード">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-[13px] text-ng" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          ログイン
        </Button>
        <p className="text-[12px] text-ink-3">パスワードを忘れた場合は、人事労務の担当者にリセットを依頼してください。</p>
      </form>
    </Shell>
  );
}

export function SetupPage() {
  const { refresh } = useAuth();
  const [f, setF] = useState({ companyName: "", lastName: "", firstName: "", email: "", password: "", withSampleData: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/setup", f);
      window.location.replace("/");
      await refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Shell wide>
      <h1 className="text-xl font-semibold">はじめに会社と管理者を登録します</h1>
      <p className="text-[13px] text-ink-3 mt-1">ここで登録した方が最初の管理者になります。従業員は後から追加できます。</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="会社名" required>
          <Input required value={f.companyName} onChange={set("companyName")} placeholder="株式会社〇〇" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓" required>
            <Input required value={f.lastName} onChange={set("lastName")} />
          </Field>
          <Field label="名" required>
            <Input required value={f.firstName} onChange={set("firstName")} />
          </Field>
        </div>
        <Field label="メールアドレス (ログインID)" required>
          <Input type="email" required value={f.email} onChange={set("email")} autoComplete="username" />
        </Field>
        <Field label="パスワード" required hint="8文字以上で、英字と数字を含めてください">
          <Input type="password" required value={f.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        <Checkbox
          label="サンプルデータを入れる"
          hint="架空の部署・従業員・勤怠・申請を登録して、すぐに操作を試せるようにします。サンプル従業員のパスワードは demo1234 です。"
          checked={f.withSampleData}
          onChange={(v) => setF({ ...f, withSampleData: v })}
        />
        {error && <p className="text-[13px] text-ng" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          登録して始める
        </Button>
      </form>
    </Shell>
  );
}
