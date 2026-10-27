import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, Download, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { api, downloadUrl } from "../../lib/api";
import { useQuery } from "../../lib/hooks";
import { addMonths } from "../../../shared/dates";
import { EMPLOYMENT_JA, monthJa, RUN_STATUS, ymdJa, yen } from "../../lib/format";
import { Button, Checkbox, Empty, ErrorBox, Field, Input, Modal, PageHeader, Panel, Pill, Select, Spinner, Stat, Tabs } from "../../components/ui";
import { PayslipSheet } from "../payslips";
import { useToast } from "../../components/toast";

export function PayrollPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "runs";
  return (
    <div>
      <PageHeader title="給与計算" sub="勤怠の締めデータから給与を計算し、確定・明細の公開まで行います。" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ key: "runs", label: "給与計算" }, { key: "settings", label: "従業員の給与設定" }]} />
      {tab === "runs" ? <Runs /> : <SettingsList />}
    </div>
  );
}

function Runs() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useQuery<any[]>("/payroll/runs");
  const next = data?.length ? addMonths(data[0].pay_month, 1) : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const [month, setMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>("/payroll/runs", { payMonth: month ?? next });
      toast.ok("給与を計算しました");
      nav(`/admin/payroll/${r.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="支給年月">
            <Input type="month" value={month ?? next} onChange={(e) => setMonth(e.target.value)} className="w-44" />
          </Field>
          <Button variant="primary" loading={busy} onClick={create}><Plus className="size-4" />給与計算を始める</Button>
          <p className="text-xs text-ink-3 basis-full sm:basis-auto sm:flex-1">会社設定の締め日・支給日をもとに、対象の勤怠期間と社会保険料の対象月を決めて計算します。計算前に勤怠を締めておくと、計算後の打刻変更を防げます。</p>
        </div>
      </Panel>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <div className="panel"><Empty title="給与計算はまだありません">支給年月を選んで「給与計算を始める」を押してください。</Empty></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>支給月</th>
                <th>支給日</th>
                <th>勤怠期間</th>
                <th className="r">人数</th>
                <th className="r">総支給額</th>
                <th className="r">差引支給額</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/admin/payroll/${r.id}`} className="link font-medium">{monthJa(r.pay_month)}支給</Link></td>
                  <td className="num">{ymdJa(r.pay_date)}</td>
                  <td className="num text-ink-2">{r.period_start.replaceAll("-", "/")} 〜 {r.period_end.replaceAll("-", "/")}</td>
                  <td className="r num">{r.slip_count}</td>
                  <td className="r num">{yen(r.gross_total)}</td>
                  <td className="r num">{yen(r.net_total)}</td>
                  <td><Pill cls={RUN_STATUS[r.status].cls}>{RUN_STATUS[r.status].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsList() {
  const { data, error, loading } = useQuery<any[]>("/payroll/settings");
  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Spinner />;
  const PAY: Record<string, string> = { monthly: "月給", daily: "日給", hourly: "時給" };
  return (
    <div className="panel overflow-x-auto">
      <table className="table min-w-[860px]">
        <thead>
          <tr>
            <th>従業員</th>
            <th>雇用形態</th>
            <th>給与形態</th>
            <th className="r">基本給・単価</th>
            <th className="r">手当計</th>
            <th className="r">通勤手当</th>
            <th className="r">標準報酬月額</th>
            <th>保険</th>
            <th>税額表</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.employee_id}>
              <td>
                <Link to={`/employees/${r.employee_id}?tab=salary`} className="link">{r.last_name} {r.first_name}</Link>
                <div className="text-[11px] text-ink-3">{r.code}</div>
              </td>
              <td>{EMPLOYMENT_JA[r.employment_type]}</td>
              {r.has_setting ? (
                <>
                  <td>{PAY[r.pay_type]}</td>
                  <td className="r num">{yen(r.pay_type === "monthly" ? r.base_salary : r.pay_type === "daily" ? r.daily_wage : r.hourly_wage)}</td>
                  <td className="r num">{yen(r.allowances.reduce((t: number, a: any) => t + a.amount, 0))}</td>
                  <td className="r num">{yen(r.commute_allowance)}</td>
                  <td className="r num">{r.standard_monthly_remuneration ? yen(r.standard_monthly_remuneration) : "-"}</td>
                  <td className="text-xs">{[r.health_insurance && "健", r.pension_insurance && "厚", r.employment_insurance && "雇"].filter(Boolean).join(" ・ ") || "なし"}</td>
                  <td>{r.tax_column === "kou" ? "甲" : r.tax_column === "otsu" ? "乙" : "-"}</td>
                </>
              ) : (
                <td colSpan={7}>
                  <Link to={`/employees/${r.employee_id}?tab=salary`} className="text-warn text-[13px] underline">未設定 — 設定する</Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PayrollRunPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useQuery<any>(`/payroll/runs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [slip, setSlip] = useState<any | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const run = data.run;
  const slips: any[] = data.slips;
  const sum = (f: (s: any) => number) => slips.reduce((t, s) => t + f(s), 0);
  const ded = (s: any, codes: string[]) => s.payload.deductions.filter((d: any) => codes.includes(d.code)).reduce((t: number, d: any) => t + d.amount, 0);
  const warnCount = slips.filter((s) => s.payload.warnings?.length).length;

  const act = async (key: string, path: string, msg: string, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(key);
    try {
      await api.post(`/payroll/runs/${id}/${path}`);
      toast.ok(msg);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        back={<Link to="/admin/payroll" className="link">← 給与計算</Link>}
        title={<span className="flex items-center gap-3 flex-wrap">{monthJa(run.pay_month)}支給の給与<Pill cls={RUN_STATUS[run.status].cls}>{RUN_STATUS[run.status].label}</Pill></span>}
        sub={`支給日 ${ymdJa(run.pay_date)} ・ 勤怠 ${run.period_start.replaceAll("-", "/")}〜${run.period_end.replaceAll("-", "/")} ・ 社会保険料 ${monthJa(run.insurance_month)}分`}
        actions={
          <>
            <Button onClick={() => downloadUrl(`/payroll/runs/${id}/export.csv`)}><Download className="size-4" />給与一覧CSV</Button>
            <Button onClick={() => downloadUrl(`/payroll/runs/${id}/bank.csv`)}><Download className="size-4" />振込CSV</Button>
            {run.status === "draft" && (
              <>
                <Button loading={busy === "calc"} onClick={() => act("calc", "calculate", "再計算しました")}><RefreshCw className="size-4" />再計算</Button>
                <Button variant="primary" loading={busy === "confirm"} onClick={() => act("confirm", "confirm", "給与を確定しました", "給与を確定します。確定後は再計算できません (確定解除で戻せます)。よろしいですか？")}>確定する</Button>
              </>
            )}
            {run.status === "confirmed" && (
              <>
                <Button loading={busy === "reopen"} onClick={() => act("reopen", "reopen", "確定を解除しました")}>確定を解除</Button>
                <Button variant="primary" loading={busy === "publish"} onClick={() => act("publish", "publish", "給与明細を公開しました", "従業員に給与明細を公開して通知します。公開後は取り消せません。よろしいですか？")}>
                  <Send className="size-4" />明細を公開
                </Button>
              </>
            )}
          </>
        }
      />

      {data.missingSettings.length > 0 && (
        <div className="mb-4 rounded-md bg-warn-bg text-warn text-[13px] px-4 py-2.5 flex gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            給与設定がないため計算対象外の従業員がいます:{" "}
            {data.missingSettings.map((e: any, i: number) => (
              <span key={e.id}>
                {i > 0 && "、"}
                <Link to={`/employees/${e.id}?tab=salary`} className="underline">{e.last_name} {e.first_name}</Link>
              </span>
            ))}
          </span>
        </div>
      )}

      <Panel className="mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="対象人数" value={`${slips.length}名`} />
          <Stat label="総支給額" value={yen(sum((s) => s.gross_pay))} />
          <Stat label="社会保険料 (本人)" value={yen(sum((s) => ded(s, ["health", "care", "child_support", "pension", "employment"])))} />
          <Stat label="源泉所得税" value={yen(sum((s) => ded(s, ["income_tax"])))} />
          <Stat label="差引支給額" value={yen(sum((s) => s.net_pay))} />
          <Stat label="会社負担の保険料 (概算)" value={yen(sum((s) => s.payload.employer?.total ?? 0))} />
        </div>
        {warnCount > 0 && <p className="text-[13px] text-warn mt-3">確認が必要な明細が {warnCount}件 あります (行の「要確認」)。</p>}
      </Panel>

      <div className="panel overflow-x-auto mb-5">
        <table className="table min-w-[1000px]">
          <thead>
            <tr>
              <th>従業員</th>
              <th className="r">総支給額</th>
              <th className="r">うち時間外等</th>
              <th className="r">健保・介護・子育て</th>
              <th className="r">厚生年金</th>
              <th className="r">雇用保険</th>
              <th className="r">所得税</th>
              <th className="r">住民税</th>
              <th className="r">控除合計</th>
              <th className="r">差引支給額</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slips.length === 0 && <tr><td colSpan={11} className="text-center text-ink-3 py-8">計算対象の従業員がいません</td></tr>}
            {slips.map((s) => {
              const ot = s.payload.payments.filter((p: any) => ["overtime", "overtime_within", "overtime60", "holiday", "night"].includes(p.code)).reduce((t: number, p: any) => t + p.amount, 0);
              return (
                <tr key={s.id} className="cursor-pointer" onClick={() => setSlip(s)}>
                  <td>
                    <span className="link">{s.last_name} {s.first_name}</span>
                    <div className="text-[11px] text-ink-3">{s.code} ・ {EMPLOYMENT_JA[s.employment_type]}</div>
                  </td>
                  <td className="r num font-medium">{yen(s.gross_pay)}</td>
                  <td className="r num text-ink-2">{ot ? yen(ot) : ""}</td>
                  <td className="r num">{yen(ded(s, ["health", "care", "child_support"]))}</td>
                  <td className="r num">{yen(ded(s, ["pension"]))}</td>
                  <td className="r num">{yen(ded(s, ["employment"]))}</td>
                  <td className="r num">{yen(ded(s, ["income_tax"]))}</td>
                  <td className="r num">{yen(ded(s, ["resident_tax"]))}</td>
                  <td className="r num">{yen(s.total_deductions)}</td>
                  <td className="r num font-semibold">{yen(s.net_pay)}</td>
                  <td>{s.payload.warnings?.length ? <Pill cls="bg-warn-bg text-warn">要確認</Pill> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Panel
        title="臨時の支給・控除"
        actions={run.status === "draft" && <Button size="sm" onClick={() => setAdjOpen(true)}><Plus className="size-3.5" />追加</Button>}
        bodyClass="p-0"
      >
        <table className="table">
          <thead><tr><th>従業員</th><th>区分</th><th>項目</th><th className="r">金額</th><th>課税</th><th /></tr></thead>
          <tbody>
            {data.adjustments.length === 0 && <tr><td colSpan={6} className="text-center text-ink-3 py-6">今月だけの手当や控除 (例: 報奨金、立替金の返済) を追加できます</td></tr>}
            {data.adjustments.map((a: any) => (
              <tr key={a.id}>
                <td>{a.employee_name}</td>
                <td>{a.kind === "payment" ? "支給" : "控除"}</td>
                <td>{a.name}</td>
                <td className="r num">{yen(a.amount)}</td>
                <td>{a.kind === "payment" ? (a.taxable ? "課税" : "非課税") : "-"}</td>
                <td className="text-right">
                  {run.status === "draft" && (
                    <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { await api.del(`/payroll/adjustments/${a.id}`); await api.post(`/payroll/runs/${id}/calculate`); reload(); }}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {run.status === "draft" && (
        <div className="mt-6 text-right">
          <Button variant="danger" size="sm" onClick={async () => { if (confirm("この給与計算を削除しますか？")) { await api.del(`/payroll/runs/${id}`); nav("/admin/payroll"); } }}>この給与計算を削除</Button>
        </div>
      )}

      <Modal open={!!slip} onClose={() => setSlip(null)} title="給与明細 (プレビュー)" width="max-w-4xl">
        {slip && <PayslipSheet s={{ ...slip, pay_month: run.pay_month, pay_date: run.pay_date, period_start: run.period_start, period_end: run.period_end, company_name: "" }} />}
      </Modal>
      <AdjustmentModal open={adjOpen} onClose={() => setAdjOpen(false)} runId={Number(id)} slips={slips} onDone={() => { setAdjOpen(false); reload(); }} />
    </div>
  );
}

function AdjustmentModal({ open, onClose, runId, slips, onDone }: { open: boolean; onClose: () => void; runId: number; slips: any[]; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ employee_id: "", kind: "payment", name: "", amount: "", taxable: true });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="臨時の支給・控除を追加"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.post(`/payroll/runs/${runId}/adjustments`, { ...v, amount: Number(v.amount) });
                await api.post(`/payroll/runs/${runId}/calculate`);
                toast.ok("追加して再計算しました");
                setV({ employee_id: "", kind: "payment", name: "", amount: "", taxable: true });
                onDone();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            追加して再計算
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="従業員" className="sm:col-span-2">
          <Select value={v.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })} placeholder="選択してください" options={slips.map((s) => ({ value: s.employee_id, label: `${s.last_name} ${s.first_name}` }))} />
        </Field>
        <Field label="区分">
          <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={[{ value: "payment", label: "支給" }, { value: "deduction", label: "控除" }]} />
        </Field>
        <Field label="金額"><Input type="number" min={1} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="項目名" className="sm:col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例: 報奨金" /></Field>
        {v.kind === "payment" && <Checkbox label="課税対象 (所得税・雇用保険の計算に含める)" checked={v.taxable} onChange={(x) => setV({ ...v, taxable: x })} />}
      </div>
    </Modal>
  );
}
