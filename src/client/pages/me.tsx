import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useQuery } from "../lib/hooks";
import { EMPLOYMENT_JA, ROLE_JA, ymdJa } from "../lib/format";
import { Button, DefList, ErrorBox, PageHeader, Panel, Spinner, Tabs } from "../components/ui";
import { DependentsEditor, EmployeeFields } from "../components/EmployeeForms";
import { useToast } from "../components/toast";

export function MePage() {
  const { me } = useAuth();
  const id = me!.user.employeeId;
  const { data, error, loading, reload } = useQuery<any>(`/employees/${id}`);
  const [tab, setTab] = useState<"profile" | "dependents">("profile");
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
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "profile", label: "プロフィール" }, { key: "dependents", label: "扶養家族" }]} />
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
    </div>
  );
}
