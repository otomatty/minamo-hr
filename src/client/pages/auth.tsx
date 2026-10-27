import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { signInWithGoogle, signOut } from "../lib/auth";
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
        <div className="relative text-[11px] text-ai-200/60">Cloudflare Workers / D1 / R2 で動作</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className={`w-full ${wide ? "max-w-lg" : "max-w-sm"}`}>{children}</div>
      </div>
    </div>
  );
}

// Better Auth が ?error= で返すコード
const LOGIN_ERRORS: Record<string, string> = {
  account_not_registered: "この Google アカウントは登録されていません。ログインに使うメールアドレスの登録を、人事労務の担当者に依頼してください。",
  account_disabled: "このアカウントは利用できません。人事労務の担当者に確認してください。",
  email_not_verified: "Google アカウントのメールアドレスが確認されていません。",
  account_not_linked: "このメールアドレスは、以前に別の Google アカウントでログインに使われています。人事労務の担当者に確認してください。",
  not_setup_admin: "この Google アカウントは最初の管理者として指定されていません。SETUP_ADMIN_EMAIL に設定したメールアドレスの Google アカウントでログインしてください。",
  setup_admin_not_configured: "最初の管理者のメールアドレス (SETUP_ADMIN_EMAIL) が設定されていません。",
  access_denied: "Google でのログインがキャンセルされました。",
  unable_to_get_user_info: "Google アカウントの情報を取得できませんでした。会社の Google アカウントでログインしているか確認してください。",
};

/** Google ログインから戻ってきたときのエラー。表示したら URL からは消す */
function useLoginError() {
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (!code) return null;
    window.history.replaceState(null, "", window.location.pathname);
    return LOGIN_ERRORS[code] ?? `ログインできませんでした${/^[\w-]{1,64}$/.test(code) ? ` (${code})` : ""}。もう一度お試しください。`;
  });
  return [error, setError] as const;
}

function GoogleButton({ disabled, onError }: { disabled?: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className="w-full gap-3"
      loading={busy}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await signInWithGoogle();
        } catch (err: any) {
          onError(err.message);
          setBusy(false);
        }
      }}
    >
      {!busy && (
        <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
      )}
      Google でログイン
    </Button>
  );
}

function NotConfigured() {
  return (
    <p className="text-[13px] text-warn bg-warn-bg rounded-md px-3 py-2" role="alert">
      Google ログインがまだ設定されていません。BETTER_AUTH_SECRET・GOOGLE_CLIENT_ID・GOOGLE_CLIENT_SECRET を設定してください (README の「Google ログインの設定」)。
    </p>
  );
}

export function LoginPage({ appName, authConfigured }: { appName: string; authConfigured: boolean }) {
  const [error, setError] = useLoginError();
  return (
    <Shell>
      <h1 className="text-xl font-semibold">{appName} にログイン</h1>
      <p className="text-[13px] text-ink-3 mt-1">会社から登録された Google アカウントでログインしてください。</p>
      <div className="mt-6 space-y-4">
        {!authConfigured && <NotConfigured />}
        {error && <p className="text-[13px] text-ng" role="alert">{error}</p>}
        <GoogleButton disabled={!authConfigured} onError={setError} />
        <p className="text-[12px] text-ink-3">ログインできない場合は、人事労務の担当者に、ログインに使う Google アカウントのメールアドレスを伝えてください。</p>
      </div>
    </Shell>
  );
}

function SetupAdminNotConfigured() {
  return (
    <p className="text-[13px] text-warn bg-warn-bg rounded-md px-3 py-2" role="alert">
      最初の管理者のメールアドレスがまだ設定されていません。管理者になる方の Google アカウントのメールアドレスを SETUP_ADMIN_EMAIL に設定してください (README の「Google ログインの設定」)。
    </p>
  );
}

export function SetupPage({
  setupEmail,
  authConfigured,
  setupAdminConfigured,
}: {
  setupEmail: string | null;
  authConfigured: boolean;
  setupAdminConfigured: boolean;
}) {
  const [f, setF] = useState({ companyName: "", lastName: "", firstName: "", withSampleData: true });
  const [error, setError] = useLoginError();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/setup", f);
      window.location.replace("/");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  if (!setupEmail) {
    return (
      <Shell wide>
        <h1 className="text-xl font-semibold">はじめに会社と管理者を登録します</h1>
        <p className="text-[13px] text-ink-3 mt-1">最初の管理者として指定された方の Google アカウントでログインしてください。従業員は後から追加できます。</p>
        <div className="mt-6 space-y-4">
          {!authConfigured && <NotConfigured />}
          {authConfigured && !setupAdminConfigured && <SetupAdminNotConfigured />}
          {error && <p className="text-[13px] text-ng" role="alert">{error}</p>}
          <GoogleButton disabled={!authConfigured || !setupAdminConfigured} onError={setError} />
        </div>
      </Shell>
    );
  }
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
        <Field
          label="管理者の Google アカウント"
          hint={
            <>
              このアカウントでログインします。
              <button
                type="button"
                className="link ml-1"
                onClick={async () => {
                  try {
                    await signOut();
                    window.location.replace("/");
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
              >
                別のアカウントにする
              </button>
            </>
          }
        >
          <Input value={setupEmail} disabled />
        </Field>
        <Checkbox
          label="サンプルデータを入れる"
          hint="架空の部署・従業員・勤怠・申請を登録して、すぐに操作を試せるようにします。サンプル従業員のメールアドレスは example.com の架空のものなので、ログインはできません。"
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
