import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useQuery } from "../lib/hooks";
import { EMPLOYMENT_JA, ROLE_JA, ymdJa } from "../lib/format";
import { Button, DefList, ErrorBox, Field, Input, PageHeader, Panel, Spinner, Tabs } from "../components/ui";
import { DependentsEditor, EmployeeFields } from "../components/EmployeeForms";
import { useToast } from "../components/toast";

export function MePage() {
  const { me, refresh } = useAuth();
  const id = me!.user.employeeId;
  const { data, error, loading, reload } = useQuery<any>(`/employees/${id}`);
  const [tab, setTab] = useState<"profile" | "dependents" | "password">(me?.user.mustChangePassword ? "password" : "profile");
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setV(data.employee);
  }, [data]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data || !v) return <Spinner />;
  const e = data.employee;
  return (
    <div>
      <PageHeader title="マイページ" sub={`${e.last_name} ${e.first_name} ・ ${me?.user.email} ・ ${ROLE_JA[me!.user.role]}`} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "profile", label: "プロフィール" }, { key: "dependents", label: "扶養家族" }, { key: "password", label: "パスワード" }]} />
      {tab === "profile" && (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="所属・雇用">
            <DefList
              items={[
                ["社員番号", e.code],
                ["部署", e.department_name],
                ["役職", e.position_name],
                ["雇用形態", EMPLOYMENT_JA[e.employment_type]],
                ["入社日", ymdJa(e.hire_date)],
                ["上長", e.manager_name],
                ["生年月日", ymdJa(e.birth_date)],
              ]}
            />
            <p className="text-[11px] text-ink-3 mt-4">氏名・所属の変更は人事労務の担当者に依頼してください。</p>
          </Panel>
          <Panel title="連絡先・口座">
            <EmployeeFields v={v} set={(p) => setV({ ...v, ...p })} sections={["contact", "bank"]} />
            <div className="flex justify-end mt-5">
              <Button
                variant="primary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.put(`/employees/${id}`, v);
                    toast.ok("プロフィールを保存しました");
                    reload();
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存する
              </Button>
            </div>
          </Panel>
        </div>
      )}
      {tab === "dependents" && (
        <Panel title="扶養家族">
          <DependentsEditor employeeId={id} dependents={data.dependents} onChange={reload} />
        </Panel>
      )}
      {tab === "password" && <PasswordForm onDone={refresh} />}
    </div>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="パスワードを変更" className="max-w-md">
      <form
        className="space-y-4"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (next !== confirm) return toast.error("新しいパスワードが一致しません");
          setBusy(true);
          try {
            await api.post("/auth/password", { current: cur, next });
            toast.ok("パスワードを変更しました");
            setCur("");
            setNext("");
            setConfirm("");
            onDone();
          } catch (e: any) {
            toast.error(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="現在のパスワード"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
        <Field label="新しいパスワード" hint="8文字以上で、英字と数字を含めてください"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
        <Field label="新しいパスワード (確認)"><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
        <Button type="submit" variant="primary" loading={busy}>変更する</Button>
      </form>
    </Panel>
  );
}
