import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { Download, FileUp, KeyRound, Plus, Search, Trash2 } from "lucide-react";
import { api, downloadUrl } from "../../lib/api";
import { useAuth, useRole } from "../../lib/auth";
import { useQuery } from "../../lib/hooks";
import { invalidateLookups, useLookups } from "../../lib/lookups";
import { dateTimeJa, EMP_STATUS_JA, EMPLOYMENT_JA, EVENT_JA, GENDER_JA, ROLE_JA, ymdJa } from "../../lib/format";
import { Avatar, Button, Checkbox, DefList, Empty, ErrorBox, Field, Input, Modal, PageHeader, Panel, Pill, Select, Spinner, Tabs, Textarea } from "../../components/ui";
import { BLANK_EMPLOYEE, DependentsEditor, EmployeeFields, SalarySettingForm } from "../../components/EmployeeForms";
import { BalancePanel } from "../leave";
import { useToast } from "../../components/toast";
import { ageOn } from "../../../shared/dates";

const STATUS_CLS: Record<string, string> = { pre_hire: "bg-ai-100 text-ai-800", active: "bg-ok-bg text-ok", leave_of_absence: "bg-warn-bg text-warn", retired: "bg-line-2 text-ink-3" };

export function EmployeesPage() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "current";
  const dept = params.get("department") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const url = `/employees?status=${status}${dept ? `&department=${dept}` : ""}${params.get("q") ? `&q=${encodeURIComponent(params.get("q")!)}` : ""}`;
  const { data, error, loading, reload } = useQuery<any[]>(url);
  const update = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };
  return (
    <div>
      <PageHeader
        title="従業員"
        sub={data ? `${data.length}名` : undefined}
        actions={
          <>
            <Button onClick={() => downloadUrl("/employees/export.csv")}><Download className="size-4" />CSV出力</Button>
            <Link to="/admin/employees/new" className="btn btn-primary"><Plus className="size-4" />従業員を登録</Link>
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-4">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); update("q", q); }}>
          <Search className="size-4 absolute left-2.5 top-2.5 text-ink-3" />
          <Input className="pl-8 w-64" placeholder="氏名・フリガナ・社員番号・メール" value={q} onChange={(e) => setQ(e.target.value)} aria-label="従業員を検索" />
        </form>
        <Select className="w-44" value={dept} onChange={(e) => update("department", e.target.value)} placeholder="すべての部署" options={(lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <Select
          className="w-40"
          value={status}
          onChange={(e) => update("status", e.target.value)}
          options={[{ value: "current", label: "在籍者 (退職者を除く)" }, { value: "all", label: "すべて" }, ...Object.entries(EMP_STATUS_JA).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <div className="panel"><Empty title="該当する従業員はいません" /></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th>社員番号</th>
                <th>氏名</th>
                <th>部署 / 役職</th>
                <th>雇用形態</th>
                <th>入社日</th>
                <th>上長</th>
                <th>権限</th>
                <th>状況</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((e) => (
                <tr key={e.id}>
                  <td className="num text-ink-2">{e.code}</td>
                  <td>
                    <Link to={`/employees/${e.id}`} className="flex items-center gap-2 link font-medium">
                      <Avatar name={e.last_name + e.first_name} size={26} />
                      <span>
                        {e.last_name} {e.first_name}
                        <span className="block text-[11px] text-ink-3 font-normal">{e.last_name_kana} {e.first_name_kana}</span>
                      </span>
                    </Link>
                  </td>
                  <td>{e.department_name ?? <span className="text-ink-3">未所属</span>}<div className="text-[11px] text-ink-3">{e.position_name}</div></td>
                  <td>{EMPLOYMENT_JA[e.employment_type]}</td>
                  <td className="num">{e.hire_date?.replaceAll("-", "/")}</td>
                  <td>{e.manager_name ?? "-"}</td>
                  <td>{e.user_id ? ROLE_JA[e.role] : <span className="text-ink-3">未発行</span>}</td>
                  <td><Pill cls={STATUS_CLS[e.status]}>{EMP_STATUS_JA[e.status]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function NewEmployeePage() {
  const nav = useNavigate();
  const toast = useToast();
  const [v, setV] = useState<any>({ ...BLANK_EMPLOYEE, hire_date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <PageHeader title="従業員を登録" back={<Link to="/admin/employees" className="link">← 従業員一覧</Link>} />
      <Panel>
        <EmployeeFields v={v} set={(p) => setV({ ...v, ...p })} sections={["basic", "employment", "contact", "bank"]} />
        <div className="flex justify-end gap-2 mt-6">
          <Link to="/admin/employees" className="btn btn-secondary">キャンセル</Link>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ id: number }>("/employees", v);
                toast.ok("従業員を登録しました。続けて給与設定とログインアカウントを設定してください");
                invalidateLookups();
                nav(`/employees/${r.id}?tab=salary`);
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            登録する
          </Button>
        </div>
      </Panel>
    </div>
  );
}

type TabKey = "profile" | "dependents" | "history" | "files" | "leave" | "salary" | "account";

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { isAdmin, isManager } = useRole();
  const { me } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useQuery<any>(`/employees/${id}`);
  const tab = (params.get("tab") as TabKey) ?? "profile";
  const setTab = (t: TabKey) => setParams({ tab: t });
  const [retireOpen, setRetireOpen] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const e = data.employee;
  const isSelf = me?.user.employeeId === e.id;

  const header = (
    <div className="flex items-center gap-4 mb-5">
      <Avatar name={e.last_name + e.first_name} size={52} />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold flex items-center gap-2 flex-wrap">
          {e.last_name} {e.first_name}
          {e.status && <Pill cls={STATUS_CLS[e.status]}>{EMP_STATUS_JA[e.status]}</Pill>}
        </h1>
        <div className="text-[13px] text-ink-3">
          {[e.code && `社員番号 ${e.code}`, e.department_name, e.position_name, EMPLOYMENT_JA[e.employment_type]].filter(Boolean).join(" ／ ")}
        </div>
      </div>
      <div className="flex gap-2 no-print">
        {isManager && !data.limited && <Link to={`/admin/attendance/${e.id}`} className="btn btn-secondary">勤怠を見る</Link>}
        {isAdmin && e.status !== "retired" && !e.leave_date && <Button variant="danger" onClick={() => setRetireOpen(true)}>退職手続き</Button>}
        {isAdmin && e.leave_date && (
          <Button onClick={async () => { if (confirm("退職予定を取り消しますか？")) { await api.post(`/employees/${e.id}/cancel-retire`); reload(); } }}>退職を取り消す</Button>
        )}
      </div>
    </div>
  );

  if (data.limited || (!isAdmin && !isSelf)) {
    return (
      <div>
        <button type="button" className="link text-xs mb-3" onClick={() => nav(-1)}>← 戻る</button>
        {header}
        <Panel title="プロフィール" className="max-w-xl">
          <DefList items={[["部署", e.department_name], ["役職", e.position_name], ["メール", e.email], ["電話", e.phone], ["入社日", ymdJa(e.hire_date)], ["上長", e.manager_name]]} />
        </Panel>
      </div>
    );
  }
  if (!isAdmin && isSelf) return <Navigate to="/me" replace />;

  return (
    <div>
      <Link to="/admin/employees" className="link text-xs mb-3 inline-block">← 従業員一覧</Link>
      {header}
      {e.leave_date && <div className="mb-4 rounded-md bg-warn-bg text-warn text-[13px] px-4 py-2">{ymdJa(e.leave_date)} 付で退職{e.status === "retired" ? "しました" : "予定です"}{e.leave_reason ? ` (${e.leave_reason})` : ""}</div>}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "profile", label: "基本情報" },
          { key: "dependents", label: `扶養家族 (${data.dependents.length})` },
          { key: "history", label: "人事履歴" },
          { key: "files", label: `書類 (${data.files.length})` },
          { key: "leave", label: "休暇" },
          { key: "salary", label: "給与設定" },
          { key: "account", label: "アカウント" },
        ]}
      />
      {tab === "profile" && <ProfileTab data={data} onSaved={reload} />}
      {tab === "dependents" && <Panel title="扶養家族"><DependentsEditor employeeId={e.id} dependents={data.dependents} onChange={reload} /></Panel>}
      {tab === "history" && <HistoryTab data={data} onChange={reload} />}
      {tab === "files" && <FilesTab data={data} onChange={reload} />}
      {tab === "leave" && <LeaveTab employeeId={e.id} />}
      {tab === "salary" && <SalaryTab employeeId={e.id} />}
      {tab === "account" && <AccountTab data={data} onChange={reload} />}
      <RetireModal open={retireOpen} onClose={() => setRetireOpen(false)} employeeId={e.id} onDone={() => { setRetireOpen(false); reload(); }} />
    </div>
  );
}

function ProfileTab({ data, onSaved }: { data: any; onSaved: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<any>(data.employee);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(data.employee), [data]);
  const e = data.employee;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  if (edit) {
    return (
      <Panel>
        <EmployeeFields v={v} set={(p) => setV({ ...v, ...p })} sections={["basic", "employment", "contact", "bank"]} selfId={e.id} />
        <Field label="部署・役職の変更日 (人事履歴に記録されます)" className="mt-4 max-w-xs">
          <Input type="date" value={v.event_date ?? today} onChange={(ev) => setV({ ...v, event_date: ev.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 mt-6">
          <Button onClick={() => { setV(data.employee); setEdit(false); }}>キャンセル</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put(`/employees/${e.id}`, v);
                toast.ok("従業員情報を保存しました");
                invalidateLookups();
                setEdit(false);
                onSaved();
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
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="基本情報" actions={<Button size="sm" onClick={() => setEdit(true)}>編集</Button>}>
        <DefList
          items={[
            ["氏名", `${e.last_name} ${e.first_name}`],
            ["フリガナ", `${e.last_name_kana} ${e.first_name_kana}`],
            ["生年月日", e.birth_date ? `${ymdJa(e.birth_date)} (${ageOn(e.birth_date, today)}歳)` : null],
            ["性別", GENDER_JA[e.gender ?? ""]],
            ["メール", e.email],
            ["電話番号", e.phone],
            ["住所", e.address ? `〒${e.postal_code ?? ""} ${e.address}` : null],
            ["緊急連絡先", e.emergency_name ? `${e.emergency_name} (${e.emergency_relation ?? ""}) ${e.emergency_phone ?? ""}` : null],
          ]}
        />
      </Panel>
      <Panel title="所属・雇用">
        <DefList
          items={[
            ["入社日", ymdJa(e.hire_date)],
            ["雇用形態", EMPLOYMENT_JA[e.employment_type]],
            ["部署", e.department_name],
            ["役職", e.position_name],
            ["上長", e.manager_name],
            ["週の所定労働", `${e.weekly_work_days}日 / ${e.weekly_work_hours}時間`],
            ["振込口座", e.bank_name ? `${e.bank_name} ${e.bank_branch ?? ""} ${e.bank_account_type ?? ""} ${e.bank_account_number ?? ""} (${e.bank_account_holder ?? ""})` : null],
            ["社内メモ", e.note ? <span className="whitespace-pre-wrap">{e.note}</span> : null],
          ]}
        />
      </Panel>
    </div>
  );
}

function HistoryTab({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ event_date: "", event_type: "other", description: "" });
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="人事履歴" bodyClass="p-0">
        <ol>
          {data.events.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-ink-3">履歴はありません</li>}
          {data.events.map((ev: any) => (
            <li key={ev.id} className="flex items-start gap-4 px-4 py-3 border-b border-line-2">
              <span className="num text-[13px] text-ink-2 w-24 shrink-0">{ev.event_date.replaceAll("-", "/")}</span>
              <span className="pill bg-ai-50 text-ai-800 shrink-0">{EVENT_JA[ev.event_type] ?? ev.event_type}</span>
              <span className="text-[13px] flex-1">{ev.description}</span>
              <button type="button" className="text-ink-3 hover:text-ng" onClick={async () => { if (confirm("この履歴を削除しますか？")) { await api.del(`/events/${ev.id}`); onChange(); } }} aria-label="履歴を削除">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="履歴を追加">
        <div className="space-y-3">
          <Field label="日付"><Input type="date" value={v.event_date} onChange={(e) => setV({ ...v, event_date: e.target.value })} /></Field>
          <Field label="種類">
            <Select value={v.event_type} onChange={(e) => setV({ ...v, event_type: e.target.value })} options={Object.entries(EVENT_JA).filter(([k]) => k !== "hire" && k !== "retire").map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="内容"><Textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <p className="text-[11px] text-ink-3">「休職」「復職」を登録すると在籍状況も切り替わります。部署・役職の変更は基本情報の編集で自動的に記録されます。</p>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.post(`/employees/${data.employee.id}/events`, v);
                toast.ok("履歴を追加しました");
                setV({ event_date: "", event_type: "other", description: "" });
                onChange();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            追加する
          </Button>
        </div>
      </Panel>
    </div>
  );
}

const FILE_CATEGORIES: Record<string, string> = { contract: "雇用契約書", certificate: "資格・証明書", pledge: "誓約書・身元保証書", tax: "税・社会保険関係", other: "その他" };

function FilesTab({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState("contract");
  const [busy, setBusy] = useState(false);
  return (
    <Panel
      title="書類"
      actions={
        <div className="flex items-center gap-2">
          <Select className="w-44 h-8" value={category} onChange={(e) => setCategory(e.target.value)} options={Object.entries(FILE_CATEGORIES).map(([value, label]) => ({ value, label }))} aria-label="書類の種類" />
          <label className={`btn btn-secondary btn-sm cursor-pointer ${busy ? "opacity-50" : ""}`}>
            <FileUp className="size-3.5" />{busy ? "アップロード中..." : "ファイルを追加"}
            <input
              type="file"
              className="sr-only"
              disabled={busy}
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                if (!f) return;
                setBusy(true);
                try {
                  const fd = new FormData();
                  fd.append("file", f);
                  fd.append("category", category);
                  await api.upload(`/employees/${data.employee.id}/files`, fd);
                  toast.ok("書類を保存しました");
                  onChange();
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setBusy(false);
                  ev.target.value = "";
                }
              }}
            />
          </label>
        </div>
      }
      bodyClass="p-0"
    >
      <table className="table">
        <thead>
          <tr>
            <th>ファイル名</th>
            <th>種類</th>
            <th className="r">サイズ</th>
            <th>登録日時</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.files.length === 0 && <tr><td colSpan={5} className="text-center text-ink-3 py-8">書類はまだありません。雇用契約書などを保管できます (1ファイル10MBまで)</td></tr>}
          {data.files.map((f: any) => (
            <tr key={f.id}>
              <td><a href={`/api/employee-files/${f.id}`} target="_blank" rel="noreferrer" className="link">{f.name}</a></td>
              <td>{FILE_CATEGORIES[f.category] ?? f.category}</td>
              <td className="r num">{Math.ceil(f.size / 1024).toLocaleString()} KB</td>
              <td className="num text-ink-2">{dateTimeJa(f.created_at)}</td>
              <td className="text-right">
                <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`${f.name} を削除しますか？`)) { await api.del(`/employee-files/${f.id}`); onChange(); } }} aria-label="削除"><Trash2 className="size-3.5" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function LeaveTab({ employeeId }: { employeeId: number }) {
  const toast = useToast();
  const { data, reload } = useQuery<any>(`/leave/balance?employeeId=${employeeId}`);
  const [v, setV] = useState({ granted_on: "", expires_on: "", days: "", remaining: "", reason: "manual" });
  const [adjust, setAdjust] = useState<any | null>(null);
  if (!data) return <Spinner />;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <BalancePanel b={data} />
        <Panel title="付与の調整" bodyClass="p-0">
          <table className="table">
            <thead>
              <tr><th>付与日</th><th>区分</th><th className="r">付与</th><th className="r">残</th><th /></tr>
            </thead>
            <tbody>
              {data.grants.map((g: any) => (
                <tr key={g.id}>
                  <td className="num">{g.granted_on.replaceAll("-", "/")}</td>
                  <td>{g.reason === "auto" ? "自動付与" : g.reason === "carryover" ? "繰越 (導入時)" : "手動"}</td>
                  <td className="r num">{g.days}</td>
                  <td className="r num">{g.remaining}</td>
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setAdjust({ ...g })}>残日数を修正</Button>
                    <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm("この付与を削除しますか？")) { await api.del(`/leave/grants/${g.id}`); reload(); } }}><Trash2 className="size-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="手動で付与する">
        <div className="space-y-3">
          <Field label="区分">
            <Select value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} options={[{ value: "manual", label: "手動付与 (特別付与など)" }, { value: "carryover", label: "導入前からの繰越" }]} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="付与日"><Input type="date" value={v.granted_on} onChange={(e) => setV({ ...v, granted_on: e.target.value })} /></Field>
            <Field label="失効日"><Input type="date" value={v.expires_on} onChange={(e) => setV({ ...v, expires_on: e.target.value })} /></Field>
            <Field label="付与日数"><Input type="number" step="0.5" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></Field>
            <Field label="残日数" hint="空欄なら付与日数と同じ"><Input type="number" step="0.5" value={v.remaining} onChange={(e) => setV({ ...v, remaining: e.target.value })} /></Field>
          </div>
          <p className="text-[11px] text-ink-3">法定の年次有給休暇は入社日から自動で付与されます。導入前に消化済みの日数は、自動付与分の「残日数を修正」で調整してください。</p>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.post("/leave/grants", { ...v, employee_id: employeeId });
                toast.ok("付与しました");
                setV({ granted_on: "", expires_on: "", days: "", remaining: "", reason: "manual" });
                reload();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            付与する
          </Button>
        </div>
      </Panel>
      {adjust && (
        <Modal
          open
          onClose={() => setAdjust(null)}
          title="残日数を修正"
          footer={
            <>
              <Button onClick={() => setAdjust(null)}>キャンセル</Button>
              <Button variant="primary" onClick={async () => {
                try {
                  await api.put(`/leave/grants/${adjust.id}`, { remaining: adjust.remaining, expires_on: adjust.expires_on });
                  setAdjust(null);
                  reload();
                } catch (e: any) {
                  toast.error(e.message);
                }
              }}>保存</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="残日数"><Input type="number" step="0.5" value={adjust.remaining} onChange={(e) => setAdjust({ ...adjust, remaining: e.target.value })} /></Field>
            <Field label="失効日"><Input type="date" value={adjust.expires_on} onChange={(e) => setAdjust({ ...adjust, expires_on: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SalaryTab({ employeeId }: { employeeId: number }) {
  const { data, reload } = useQuery<any>(`/payroll/settings/${employeeId}`);
  const slips = useQuery<any[]>(`/payslips?employeeId=${employeeId}`);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-5">
      <Panel title="給与設定">
        {!data.setting && <p className="mb-4 text-[13px] text-warn">給与設定がまだありません。設定すると給与計算の対象になります。</p>}
        <SalarySettingForm key={JSON.stringify(data.setting)} employeeId={employeeId} initial={data.setting} dependentsCount={data.dependentsCount} onSaved={reload} />
      </Panel>
      <Panel title="給与明細の履歴" bodyClass="p-0">
        <table className="table">
          <thead><tr><th>支給月</th><th>状態</th><th className="r">総支給</th><th className="r">差引支給</th></tr></thead>
          <tbody>
            {slips.data?.length === 0 && <tr><td colSpan={4} className="text-center text-ink-3 py-6">まだありません</td></tr>}
            {slips.data?.map((s) => (
              <tr key={s.id}>
                <td><Link className="link" to={`/payslips/${s.id}`}>{s.pay_month.replace("-", "年")}月</Link></td>
                <td>{s.status === "published" ? "公開済み" : s.status === "confirmed" ? "確定" : "計算中"}</td>
                <td className="r num">{s.gross_pay.toLocaleString()}</td>
                <td className="r num">{s.net_pay.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function AccountTab({ data, onChange }: { data: any; onChange: () => void }) {
  const toast = useToast();
  const acc = data.account;
  const [email, setEmail] = useState(acc?.email ?? data.employee.email ?? "");
  const [role, setRole] = useState(acc?.role ?? "employee");
  const [active, setActive] = useState(acc ? !!acc.is_active : true);
  const [pw, setPw] = useState<string | null>(null);
  const roleHint = useMemo(
    () => ({ admin: "すべての従業員・給与・設定を管理できます", manager: "部下の勤怠を確認し、申請を承認できます", employee: "自分の勤怠・申請・給与明細を扱えます" })[role as "admin"],
    [role],
  );
  return (
    <Panel title="ログインアカウント" className="max-w-xl">
      <div className="space-y-4">
        {acc && <DefList items={[["最終ログイン", acc.last_login_at ? dateTimeJa(acc.last_login_at) : "未ログイン"], ["初期パスワード", acc.must_change_password ? "未変更" : "変更済み"]]} />}
        <Field label="メールアドレス (ログインID)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="権限" hint={roleHint}>
          <Select value={role} onChange={(e) => setRole(e.target.value)} options={Object.entries(ROLE_JA).map(([value, label]) => ({ value, label }))} />
        </Field>
        {acc && <Checkbox label="ログインを許可する" checked={active} onChange={setActive} />}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const r = await api.post<{ initialPassword?: string }>(`/employees/${data.employee.id}/account`, { email, role, is_active: active });
                if (r.initialPassword) setPw(r.initialPassword);
                toast.ok(acc ? "アカウントを更新しました" : "アカウントを発行しました");
                onChange();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            {acc ? "保存する" : "アカウントを発行"}
          </Button>
          {acc && (
            <Button
              onClick={async () => {
                if (!confirm("パスワードをリセットして新しい初期パスワードを発行しますか？")) return;
                const r = await api.post<{ initialPassword: string }>(`/employees/${data.employee.id}/account/reset-password`);
                setPw(r.initialPassword);
              }}
            >
              <KeyRound className="size-4" />パスワードをリセット
            </Button>
          )}
        </div>
        {pw && (
          <div className="rounded-md border border-asagi-600/40 bg-asagi-100/50 p-3 text-[13px]">
            初期パスワード: <code className="font-semibold text-[15px] select-all">{pw}</code>
            <p className="text-xs text-ink-2 mt-1">この画面を閉じると再表示できません。本人に安全な方法で伝えてください。初回ログイン後に変更を求めます。</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RetireModal({ open, onClose, employeeId, onDone }: { open: boolean; onClose: () => void; employeeId: number; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("自己都合");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="退職手続き"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            variant="danger"
            disabled={!date}
            onClick={async () => {
              try {
                await api.post(`/employees/${employeeId}/retire`, { leave_date: date, reason });
                toast.ok("退職日を登録しました");
                onDone();
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            登録する
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="退職日" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="退職理由">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} options={["自己都合", "会社都合", "契約期間満了", "定年", "その他"].map((x) => ({ value: x, label: x }))} />
        </Field>
        <p className="text-xs text-ink-3">退職日の翌日にログインできなくなり、社会保険は退職日の翌日に資格を喪失したものとして計算されます。</p>
      </div>
    </Modal>
  );
}
