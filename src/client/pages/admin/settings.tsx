import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useQuery } from "../../lib/hooks";
import { invalidateLookups, useLookups } from "../../lib/lookups";
import { dateTimeJa, mdW, ymdJa } from "../../lib/format";
import { WEEKDAY_JA } from "../../../shared/dates";
import { Button, Checkbox, Field, Input, Modal, PageHeader, Panel, Pill, Select, Spinner, Textarea } from "../../components/ui";
import { useToast } from "../../components/toast";

type Tab = "company" | "org" | "patterns" | "holidays" | "leave" | "forms" | "routes" | "categories" | "rates" | "announcements" | "logs";

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "company";
  return (
    <div>
      <PageHeader title="設定" />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="lg:sticky lg:top-20 self-start">
          <ul className="flex lg:flex-col gap-0.5 overflow-x-auto text-[13px]">
            {(
              [
                ["company", "会社・締め日"],
                ["org", "部署・役職"],
                ["patterns", "勤務パターン"],
                ["holidays", "休日カレンダー"],
                ["leave", "休暇の種類"],
                ["forms", "申請フォーム"],
                ["routes", "承認ルート"],
                ["categories", "経費科目"],
                ["rates", "保険料率"],
                ["announcements", "お知らせ"],
                ["logs", "操作ログ"],
              ] as Array<[Tab, string]>
            ).map(([k, label]) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => setParams({ tab: k })}
                  className={`w-full text-left whitespace-nowrap px-3 py-2 rounded-md ${tab === k ? "bg-white border border-line font-semibold text-ink" : "text-ink-2 hover:bg-white/70"}`}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {tab === "company" && <CompanySettings />}
          {tab === "org" && <OrgSettings />}
          {tab === "patterns" && <PatternSettings />}
          {tab === "holidays" && <HolidaySettings />}
          {tab === "leave" && <LeaveTypeSettings />}
          {tab === "forms" && <FormSettings />}
          {tab === "routes" && <RouteSettings />}
          {tab === "categories" && <CategorySettings />}
          {tab === "rates" && <RateSettings />}
          {tab === "announcements" && <AnnouncementSettings />}
          {tab === "logs" && <AuditLogs />}
        </div>
      </div>
    </div>
  );
}

function useSave() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, msg = "保存しました") => {
    try {
      await fn();
      toast.ok(msg);
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    }
  };
}

function CompanySettings() {
  const { refresh } = useAuth();
  const { data } = useQuery<any>("/settings/company");
  const [v, setV] = useState<any>(null);
  const save = useSave();
  useEffect(() => setV(data), [data]);
  if (!v) return <Spinner />;
  const days = [{ value: 0, label: "末日" }, ...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `${i + 1}日` }))];
  return (
    <Panel title="会社・締め日">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="会社名"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="システムの表示名"><Input value={v.app_name} onChange={(e) => setV({ ...v, app_name: e.target.value })} /></Field>
        <Field label="勤怠の締め日"><Select value={v.closing_day} onChange={(e) => setV({ ...v, closing_day: Number(e.target.value) })} options={days} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="給与の支給月">
            <Select value={v.pay_month_offset} onChange={(e) => setV({ ...v, pay_month_offset: Number(e.target.value) })} options={[{ value: 0, label: "当月" }, { value: 1, label: "翌月" }]} />
          </Field>
          <Field label="支給日" hint="土日祝は前営業日"><Select value={v.pay_day} onChange={(e) => setV({ ...v, pay_day: Number(e.target.value) })} options={[{ value: 0, label: "末日" }, ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `${i + 1}日` }))]} /></Field>
        </div>
        <Field label="社会保険料の徴収" hint="翌月徴収: 当月分の保険料を翌月の給与から控除">
          <Select value={v.social_insurance_timing} onChange={(e) => setV({ ...v, social_insurance_timing: e.target.value })} options={[{ value: "next", label: "翌月徴収" }, { value: "current", label: "当月徴収" }]} />
        </Field>
        <Field label="月平均所定労働時間" hint="時間外手当などの1時間あたりの単価計算に使います"><Input type="number" step="0.1" value={v.monthly_avg_hours} onChange={(e) => setV({ ...v, monthly_avg_hours: e.target.value })} /></Field>
        <Field label="法定休日"><Select value={v.legal_holiday_weekday} onChange={(e) => setV({ ...v, legal_holiday_weekday: Number(e.target.value) })} options={WEEKDAY_JA.map((w, i) => ({ value: i, label: `${w}曜日` }))} /></Field>
        <Field label="週の起算曜日" hint="週40時間の計算に使います"><Select value={v.week_start} onChange={(e) => setV({ ...v, week_start: Number(e.target.value) })} options={WEEKDAY_JA.map((w, i) => ({ value: i, label: `${w}曜日` }))} /></Field>
        <Field label="時間外労働のアラート (月)" hint="36協定の上限に合わせて設定します"><Input type="number" value={v.overtime_alert_hours} onChange={(e) => setV({ ...v, overtime_alert_hours: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end mt-5">
        <Button variant="primary" onClick={async () => { if (await save(() => api.put("/settings/company", v))) refresh(); }}>保存する</Button>
      </div>
    </Panel>
  );
}

function OrgSettings() {
  const depts = useQuery<any[]>("/departments");
  const positions = useQuery<any[]>("/positions");
  const lookups = useLookups();
  const save = useSave();
  const [d, setD] = useState<any | null>(null);
  const [p, setP] = useState<any | null>(null);
  const done = () => {
    depts.reload();
    positions.reload();
    invalidateLookups();
  };
  return (
    <div className="space-y-5">
      <Panel title="部署" actions={<Button size="sm" onClick={() => setD({ name: "", code: "", parent_id: "", head_employee_id: "", sort_order: 0 })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
        <table className="table">
          <thead><tr><th>部署名</th><th>コード</th><th>親部署</th><th>部門長</th><th className="r">人数</th><th /></tr></thead>
          <tbody>
            {depts.data?.map((x) => (
              <tr key={x.id}>
                <td className="font-medium">{x.name}</td>
                <td className="text-ink-2">{x.code}</td>
                <td>{depts.data?.find((y) => y.id === x.parent_id)?.name ?? "-"}</td>
                <td>{(() => { const e = lookups?.employees.find((y) => y.id === x.head_employee_id); return e ? `${e.last_name} ${e.first_name}` : "-"; })()}</td>
                <td className="r num">{x.member_count}</td>
                <td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setD({ ...x, parent_id: x.parent_id ?? "", head_employee_id: x.head_employee_id ?? "" })}>編集</Button>
                  <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm(`${x.name} を削除しますか？`) && (await save(() => api.del(`/departments/${x.id}`), "削除しました"))) done(); }}><Trash2 className="size-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="役職" actions={<Button size="sm" onClick={() => setP({ name: "", rank: 0 })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
        <table className="table">
          <thead><tr><th>役職名</th><th className="r">序列 (大きいほど上位)</th><th /></tr></thead>
          <tbody>
            {positions.data?.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td className="r num">{x.rank}</td>
                <td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setP(x)}>編集</Button>
                  <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm(`${x.name} を削除しますか？`) && (await save(() => api.del(`/positions/${x.id}`), "削除しました"))) done(); }}><Trash2 className="size-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {d && (
        <Modal open onClose={() => setD(null)} title={d.id ? "部署を編集" : "部署を追加"} footer={<><Button onClick={() => setD(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { const body = { ...d, parent_id: d.parent_id || null, head_employee_id: d.head_employee_id || null }; if (await save(() => (d.id ? api.put(`/departments/${d.id}`, body) : api.post("/departments", body)))) { setD(null); done(); } }}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="部署名" required><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="コード"><Input value={d.code ?? ""} onChange={(e) => setD({ ...d, code: e.target.value })} /></Field>
            <Field label="親部署"><Select value={d.parent_id} onChange={(e) => setD({ ...d, parent_id: e.target.value })} placeholder="なし (最上位)" options={(depts.data ?? []).filter((x) => x.id !== d.id).map((x) => ({ value: x.id, label: x.name }))} /></Field>
            <Field label="部門長" hint="承認ルートの「部門長」になります"><Select value={d.head_employee_id} onChange={(e) => setD({ ...d, head_employee_id: e.target.value })} placeholder="未設定" options={(lookups?.employees ?? []).map((e) => ({ value: e.id, label: `${e.last_name} ${e.first_name}` }))} /></Field>
            <Field label="表示順"><Input type="number" value={d.sort_order} onChange={(e) => setD({ ...d, sort_order: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {p && (
        <Modal open onClose={() => setP(null)} title={p.id ? "役職を編集" : "役職を追加"} footer={<><Button onClick={() => setP(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { if (await save(() => (p.id ? api.put(`/positions/${p.id}`, p) : api.post("/positions", p)))) { setP(null); done(); } }}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="役職名" required><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="序列"><Input type="number" value={p.rank} onChange={(e) => setP({ ...p, rank: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PatternSettings() {
  const { data, reload } = useQuery<any[]>("/settings/work-patterns");
  const save = useSave();
  const [v, setV] = useState<any | null>(null);
  const done = () => { reload(); invalidateLookups(); };
  return (
    <Panel title="勤務パターン" actions={<Button size="sm" onClick={() => setV({ name: "", start_time: "09:00", end_time: "18:00", break_minutes: 60, scheduled_minutes: 480, work_days: "1,2,3,4,5", late_grace_minutes: 0 })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
      <table className="table">
        <thead><tr><th>名称</th><th>始業〜終業</th><th className="r">休憩</th><th className="r">所定労働</th><th>勤務日</th><th /></tr></thead>
        <tbody>
          {data?.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.name} {p.is_default ? <Pill cls="bg-ai-100 text-ai-800 ml-1">既定</Pill> : null}</td>
              <td className="num">{p.start_time}〜{p.end_time}</td>
              <td className="r num">{p.break_minutes}分</td>
              <td className="r num">{Math.floor(p.scheduled_minutes / 60)}時間{p.scheduled_minutes % 60 ? `${p.scheduled_minutes % 60}分` : ""}</td>
              <td>{p.work_days.split(",").filter(Boolean).map((d: string) => WEEKDAY_JA[Number(d)]).join("")}</td>
              <td className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => setV({ ...p, is_default: !!p.is_default })}>編集</Button>
                {!p.is_default && <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm("削除しますか？") && (await save(() => api.del(`/settings/work-patterns/${p.id}`), "削除しました"))) done(); }}><Trash2 className="size-3.5" /></Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v && (
        <Modal open onClose={() => setV(null)} title={v.id ? "勤務パターンを編集" : "勤務パターンを追加"} footer={<><Button onClick={() => setV(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { if (await save(() => (v.id ? api.put(`/settings/work-patterns/${v.id}`, v) : api.post("/settings/work-patterns", v)))) { setV(null); done(); } }}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称" required className="sm:col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="始業"><Input type="time" value={v.start_time} onChange={(e) => setV({ ...v, start_time: e.target.value })} /></Field>
            <Field label="終業"><Input type="time" value={v.end_time} onChange={(e) => setV({ ...v, end_time: e.target.value })} /></Field>
            <Field label="休憩 (分)" hint="休憩の打刻がない日に自動で差し引きます (6時間超の勤務)"><Input type="number" value={v.break_minutes} onChange={(e) => setV({ ...v, break_minutes: e.target.value })} /></Field>
            <Field label="所定労働時間 (分)"><Input type="number" value={v.scheduled_minutes} onChange={(e) => setV({ ...v, scheduled_minutes: e.target.value })} /></Field>
            <Field label="遅刻の猶予 (分)"><Input type="number" value={v.late_grace_minutes} onChange={(e) => setV({ ...v, late_grace_minutes: e.target.value })} /></Field>
            <div>
              <div className="label">勤務日</div>
              <div className="flex gap-1">
                {WEEKDAY_JA.map((w, i) => {
                  const on = String(v.work_days).split(",").includes(String(i));
                  return (
                    <button key={i} type="button" aria-pressed={on} className={`btn btn-sm px-2 ${on ? "btn-primary" : "btn-secondary"}`} onClick={() => {
                      const set = new Set(String(v.work_days).split(",").filter(Boolean));
                      if (on) set.delete(String(i)); else set.add(String(i));
                      setV({ ...v, work_days: [...set].sort().join(",") });
                    }}>{w}</button>
                  );
                })}
              </div>
            </div>
            {v.id && <Checkbox label="既定の勤務パターンにする" checked={!!v.is_default} onChange={(x) => setV({ ...v, is_default: x })} />}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function HolidaySettings() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, reload } = useQuery<any>(`/settings/holidays?year=${year}`);
  const save = useSave();
  const [v, setV] = useState({ date: "", name: "" });
  return (
    <div className="space-y-5">
      <Panel
        title={`${year}年の休日`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setYear(year - 1)}>前年</Button>
            <Button size="sm" onClick={() => setYear(year + 1)}>翌年</Button>
            {data?.importableYears.includes(year) && <Button size="sm" onClick={async () => { if (await save(() => api.post("/settings/holidays/import", { year }), "祝日を取り込みました")) reload(); }}>国民の祝日を取り込む</Button>}
          </div>
        }
        bodyClass="p-0"
      >
        <table className="table">
          <thead><tr><th>日付</th><th>名称</th><th>区分</th><th /></tr></thead>
          <tbody>
            {data?.holidays.length === 0 && <tr><td colSpan={4} className="text-center text-ink-3 py-6">休日が登録されていません</td></tr>}
            {data?.holidays.map((h: any) => (
              <tr key={h.date}>
                <td className="num">{mdW(h.date)}</td>
                <td>{h.name}</td>
                <td>{h.kind === "national" ? "国民の祝日" : <Pill cls="bg-asagi-100 text-asagi-700">会社休日</Pill>}</td>
                <td className="text-right"><Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (await save(() => api.del(`/settings/holidays/${h.date}`), "削除しました")) reload(); }}><Trash2 className="size-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="会社休日を追加" className="max-w-xl">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="日付"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="名称" className="flex-1 min-w-40"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="例: 年末年始休暇" /></Field>
          <Button variant="primary" onClick={async () => { if (await save(() => api.post("/settings/holidays", { ...v, kind: "company" }))) { setV({ date: "", name: "" }); reload(); } }}>追加</Button>
        </div>
        <p className="text-[11px] text-ink-3 mt-2">休日は所定休日として扱い、出勤すると所定休日労働として集計します (法定休日の曜日は会社設定で指定)。</p>
      </Panel>
    </div>
  );
}

function LeaveTypeSettings() {
  const { data, reload } = useQuery<any[]>("/settings/leave-types");
  const save = useSave();
  const [v, setV] = useState<any | null>(null);
  const done = () => { reload(); invalidateLookups(); };
  return (
    <Panel title="休暇の種類" actions={<Button size="sm" onClick={() => setV({ name: "", is_paid: true, allow_half_day: true, active: true })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
      <table className="table">
        <thead><tr><th>名称</th><th>給与</th><th>半日取得</th><th>有休を消化</th><th>状態</th><th /></tr></thead>
        <tbody>
          {data?.map((t) => (
            <tr key={t.id}>
              <td className="font-medium">{t.name}</td>
              <td>{t.is_paid ? "有給" : "無給 (欠勤控除)"}</td>
              <td>{t.allow_half_day ? "可" : "-"}</td>
              <td>{t.uses_annual_leave ? "する" : "-"}</td>
              <td>{t.active ? "使用中" : <span className="text-ink-3">停止</span>}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setV({ ...t, is_paid: !!t.is_paid, allow_half_day: !!t.allow_half_day, active: !!t.active })}>編集</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {v && (
        <Modal open onClose={() => setV(null)} title={v.id ? "休暇の種類を編集" : "休暇の種類を追加"} footer={<><Button onClick={() => setV(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { if (await save(() => (v.id ? api.put(`/settings/leave-types/${v.id}`, v) : api.post("/settings/leave-types", v)))) { setV(null); done(); } }}>保存</Button></>}>
          <div className="space-y-3">
            <Field label="名称" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Checkbox label="有給 (給与を控除しない)" checked={v.is_paid} onChange={(x) => setV({ ...v, is_paid: x })} />
            <Checkbox label="半日単位で取得できる" checked={v.allow_half_day} onChange={(x) => setV({ ...v, allow_half_day: x })} />
            {v.id && <Checkbox label="使用中 (申請で選べる)" checked={v.active} onChange={(x) => setV({ ...v, active: x })} />}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function FormSettings() {
  const { data, reload } = useQuery<any[]>("/forms");
  const lookups = useLookups();
  const save = useSave();
  const [v, setV] = useState<any | null>(null);
  const done = () => { reload(); invalidateLookups(); };
  const move = (i: number, d: number) => {
    const f = [...v.fields];
    const [x] = f.splice(i, 1);
    f.splice(i + d, 0, x);
    setV({ ...v, fields: f });
  };
  return (
    <Panel title="申請フォーム" actions={<Button size="sm" onClick={() => setV({ name: "", description: "", route_id: lookups?.routes[0]?.id ?? "", fields: [{ key: "detail", label: "内容", type: "textarea", required: true }], active: true, kind: "general" })}><Plus className="size-3.5" />フォームを作る</Button>} bodyClass="p-0">
      <table className="table">
        <thead><tr><th>フォーム名</th><th>種類</th><th>承認ルート</th><th>状態</th><th /></tr></thead>
        <tbody>
          {data?.map((f) => (
            <tr key={f.id}>
              <td className="font-medium">{f.name}<div className="text-[11px] text-ink-3 font-normal">{f.description}</div></td>
              <td>{f.kind === "general" ? `汎用 (${f.fields.length}項目)` : "標準"}</td>
              <td>{f.route_name ?? "既定"}</td>
              <td>{f.active ? "公開中" : <span className="text-ink-3">非公開</span>}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setV({ ...f, route_id: f.route_id ?? "", active: !!f.active })}>編集</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {v && (
        <Modal open width="max-w-3xl" onClose={() => setV(null)} title={v.id ? "申請フォームを編集" : "申請フォームを作る"} footer={<><Button onClick={() => setV(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { const body = { ...v, route_id: v.route_id || null }; if (await save(() => (v.id ? api.put(`/forms/${v.id}`, body) : api.post("/forms", body)))) { setV(null); done(); } }}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="フォーム名" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="承認ルート"><Select value={v.route_id} onChange={(e) => setV({ ...v, route_id: e.target.value })} placeholder="既定のルート" options={(lookups?.routes ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
            <Field label="説明" className="sm:col-span-2"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
            {v.id && <Checkbox label="公開する (従業員が申請できる)" checked={v.active} onChange={(x) => setV({ ...v, active: x })} />}
          </div>
          {v.kind === "general" && (
            <div className="mt-5">
              <div className="label">入力項目</div>
              <div className="space-y-2">
                {v.fields.map((f: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line-2 p-2">
                    <Input className="w-40" value={f.label} placeholder="項目名" onChange={(e) => setV({ ...v, fields: v.fields.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <Input className="w-32" value={f.key} placeholder="キー (英数字)" onChange={(e) => setV({ ...v, fields: v.fields.map((x: any, j: number) => (j === i ? { ...x, key: e.target.value } : x)) })} aria-label="項目キー" />
                    <Select className="w-32" value={f.type} onChange={(e) => setV({ ...v, fields: v.fields.map((x: any, j: number) => (j === i ? { ...x, type: e.target.value } : x)) })} options={[{ value: "text", label: "1行テキスト" }, { value: "textarea", label: "複数行" }, { value: "number", label: "数値" }, { value: "date", label: "日付" }, { value: "select", label: "選択肢" }]} />
                    {f.type === "select" && <Input className="w-48" value={(f.options ?? []).join(",")} placeholder="選択肢 (カンマ区切り)" onChange={(e) => setV({ ...v, fields: v.fields.map((x: any, j: number) => (j === i ? { ...x, options: e.target.value.split(",") } : x)) })} />}
                    <Checkbox label="必須" checked={!!f.required} onChange={(x) => setV({ ...v, fields: v.fields.map((y: any, j: number) => (j === i ? { ...y, required: x } : y)) })} />
                    <div className="ml-auto flex">
                      <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上へ"><ArrowUp className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" disabled={i === v.fields.length - 1} onClick={() => move(i, 1)} aria-label="下へ"><ArrowDown className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setV({ ...v, fields: v.fields.filter((_: any, j: number) => j !== i) })} aria-label="削除"><Trash2 className="size-3.5" /></Button>
                    </div>
                  </div>
                ))}
                <Button size="sm" onClick={() => setV({ ...v, fields: [...v.fields, { key: `field_${v.fields.length + 1}`, label: "", type: "text", required: false }] })}><Plus className="size-3.5" />項目を追加</Button>
              </div>
              <p className="text-[11px] text-ink-3 mt-2">キーを「amount」にした数値項目は、申請一覧の金額欄に表示されます。</p>
            </div>
          )}
        </Modal>
      )}
    </Panel>
  );
}

const STEP_JA: Record<string, string> = { manager: "申請者の上長", department_head: "所属部署の部門長", role: "権限を持つ人のいずれか", employee: "指定した従業員" };

function RouteSettings() {
  const { data, reload } = useQuery<any[]>("/routes");
  const lookups = useLookups();
  const save = useSave();
  const [v, setV] = useState<any | null>(null);
  const done = () => { reload(); invalidateLookups(); };
  const describe = (s: any) => {
    if (s.type === "role") return `${s.role === "manager" ? "マネージャー" : "管理者"}のいずれか`;
    if (s.type === "employee") { const e = lookups?.employees.find((x) => x.id === s.employee_id); return e ? `${e.last_name} ${e.first_name}` : "指定の従業員"; }
    return STEP_JA[s.type];
  };
  return (
    <Panel title="承認ルート" actions={<Button size="sm" onClick={() => setV({ name: "", steps: [{ type: "manager", label: "上長" }] })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
      <ul>
        {data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-2">
            <div className="min-w-48">
              <div className="font-medium text-[13px]">{r.name} {r.is_default ? <Pill cls="bg-ai-100 text-ai-800 ml-1">既定</Pill> : null}</div>
            </div>
            <ol className="flex flex-wrap items-center gap-1.5 text-xs flex-1">
              <li className="pill bg-line-2 text-ink-2">申請者</li>
              {r.steps.map((s: any, i: number) => (
                <li key={i} className="flex items-center gap-1.5"><span className="text-ink-3">→</span><span className="pill bg-asagi-100 text-asagi-700">{s.label || describe(s)}</span></li>
              ))}
            </ol>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setV({ ...r, is_default: !!r.is_default })}>編集</Button>
              {!r.is_default && <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm("削除しますか？") && (await save(() => api.del(`/routes/${r.id}`), "削除しました"))) done(); }}><Trash2 className="size-3.5" /></Button>}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-3 px-4 py-3">承認者が決まらないステップ (上長がいない、申請者自身が部門長など) は自動的に飛ばします。管理者はどの申請も代理で承認できます。</p>
      {v && (
        <Modal open width="max-w-2xl" onClose={() => setV(null)} title={v.id ? "承認ルートを編集" : "承認ルートを追加"} footer={<><Button onClick={() => setV(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { if (await save(() => (v.id ? api.put(`/routes/${v.id}`, v) : api.post("/routes", v)))) { setV(null); done(); } }}>保存</Button></>}>
          <Field label="ルート名" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <div className="mt-4 space-y-2">
            <div className="label">承認ステップ (上から順に承認)</div>
            {v.steps.map((s: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line-2 p-2">
                <span className="text-xs text-ink-3 w-6 text-center num">{i + 1}</span>
                <Select className="w-48" value={s.type} onChange={(e) => setV({ ...v, steps: v.steps.map((x: any, j: number) => (j === i ? { ...x, type: e.target.value } : x)) })} options={Object.entries(STEP_JA).map(([value, label]) => ({ value, label }))} />
                {s.type === "role" && <Select className="w-36" value={s.role ?? "admin"} onChange={(e) => setV({ ...v, steps: v.steps.map((x: any, j: number) => (j === i ? { ...x, role: e.target.value } : x)) })} options={[{ value: "admin", label: "管理者" }, { value: "manager", label: "マネージャー" }]} />}
                {s.type === "employee" && <Select className="w-44" value={s.employee_id ?? ""} placeholder="選択" onChange={(e) => setV({ ...v, steps: v.steps.map((x: any, j: number) => (j === i ? { ...x, employee_id: Number(e.target.value) } : x)) })} options={(lookups?.employees ?? []).map((e) => ({ value: e.id, label: `${e.last_name} ${e.first_name}` }))} />}
                <Input className="w-32" value={s.label ?? ""} placeholder="表示名 (任意)" onChange={(e) => setV({ ...v, steps: v.steps.map((x: any, j: number) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Button size="sm" variant="ghost" className="ml-auto" disabled={v.steps.length === 1} onClick={() => setV({ ...v, steps: v.steps.filter((_: any, j: number) => j !== i) })} aria-label="ステップを削除"><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => setV({ ...v, steps: [...v.steps, { type: "role", role: "admin" }] })}><Plus className="size-3.5" />ステップを追加</Button>
          </div>
          {v.id && <div className="mt-4"><Checkbox label="既定の承認ルートにする" checked={!!v.is_default} onChange={(x) => setV({ ...v, is_default: x })} /></div>}
        </Modal>
      )}
    </Panel>
  );
}

function CategorySettings() {
  const { data, reload } = useQuery<any[]>("/expense-categories");
  const save = useSave();
  const [v, setV] = useState<any | null>(null);
  const done = () => { reload(); invalidateLookups(); };
  return (
    <Panel title="経費科目" actions={<Button size="sm" onClick={() => setV({ name: "", account_code: "", tax_rate: 10, requires_receipt: true, is_transport: false, active: true })}><Plus className="size-3.5" />追加</Button>} bodyClass="p-0">
      <table className="table">
        <thead><tr><th>科目</th><th>勘定科目コード</th><th>既定の税率</th><th>領収書</th><th>交通費</th><th>状態</th><th /></tr></thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id}>
              <td className="font-medium">{c.name}</td>
              <td className="num">{c.account_code}</td>
              <td>{c.tax_rate}%</td>
              <td>{c.requires_receipt ? "必須" : "-"}</td>
              <td>{c.is_transport ? "区間入力" : "-"}</td>
              <td>{c.active ? "使用中" : <span className="text-ink-3">停止</span>}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setV({ ...c, requires_receipt: !!c.requires_receipt, is_transport: !!c.is_transport, active: !!c.active })}>編集</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {v && (
        <Modal open onClose={() => setV(null)} title={v.id ? "経費科目を編集" : "経費科目を追加"} footer={<><Button onClick={() => setV(null)}>キャンセル</Button><Button variant="primary" onClick={async () => { if (await save(() => (v.id ? api.put(`/expense-categories/${v.id}`, v) : api.post("/expense-categories", v)))) { setV(null); done(); } }}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="科目名" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="勘定科目コード"><Input value={v.account_code} onChange={(e) => setV({ ...v, account_code: e.target.value })} /></Field>
            <Field label="既定の税率"><Select value={v.tax_rate} onChange={(e) => setV({ ...v, tax_rate: Number(e.target.value) })} options={[{ value: 10, label: "10%" }, { value: 8, label: "8%" }, { value: 0, label: "対象外" }]} /></Field>
          </div>
          <div className="mt-4 space-y-2">
            <Checkbox label="領収書の添付を必須にする" checked={v.requires_receipt} onChange={(x) => setV({ ...v, requires_receipt: x })} />
            <Checkbox label="交通費 (出発・到着を入力する)" checked={v.is_transport} onChange={(x) => setV({ ...v, is_transport: x })} />
            {v.id && <Checkbox label="使用中" checked={v.active} onChange={(x) => setV({ ...v, active: x })} />}
          </div>
        </Modal>
      )}
    </Panel>
  );
}

const RATE_JA: Record<string, string> = {
  health: "健康保険料率",
  care: "介護保険料率",
  child_support: "子ども・子育て支援金率",
  pension: "厚生年金保険料率",
  employment_employee: "雇用保険料率 (労働者負担)",
  employment_employer: "雇用保険料率 (事業主負担)",
};

function RateSettings() {
  const { data, reload } = useQuery<any[]>("/settings/insurance-rates");
  const save = useSave();
  const [v, setV] = useState({ kind: "health", effective_from: "", rate: "", note: "" });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-5">
      <Panel title="保険料率" bodyClass="p-0">
        <table className="table">
          <thead><tr><th>種類</th><th>適用開始</th><th className="r">料率 (全体)</th><th>メモ</th><th /></tr></thead>
          <tbody>
            {Object.keys(RATE_JA).flatMap((k) =>
              data
                .filter((r) => r.kind === k)
                .map((r, i) => (
                  <tr key={r.id} className={i > 0 ? "text-ink-3" : ""}>
                    <td>{i === 0 ? RATE_JA[k] : ""}</td>
                    <td className="num">{r.effective_from.replace("-", "年")}月分〜</td>
                    <td className="r num">{r.rate}%</td>
                    <td className="text-xs">{r.note}</td>
                    <td className="text-right"><Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm("この料率を削除しますか？") && (await save(() => api.del(`/settings/insurance-rates/${r.id}`), "削除しました"))) reload(); }}><Trash2 className="size-3.5" /></Button></td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </Panel>
      <Panel title="料率を追加・改定" className="max-w-3xl">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="種類" className="sm:col-span-2"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={Object.entries(RATE_JA).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="適用開始月"><Input type="month" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} /></Field>
          <Field label="料率 (%)"><Input type="number" step="0.001" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></Field>
          <Field label="メモ" className="sm:col-span-4"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="例: 協会けんぽ東京支部 令和9年度" /></Field>
        </div>
        <p className="text-[11px] text-ink-3 mt-2">健康保険・介護保険・子ども・子育て支援金・厚生年金は労使折半の全体の料率、雇用保険はそれぞれの負担分の料率を入力します。社会保険は保険料の対象月、雇用保険は賃金の締日の月で切り替わります。初期値は協会けんぽ東京支部と一般の事業の料率です。</p>
        <div className="flex justify-end mt-3">
          <Button variant="primary" onClick={async () => { if (await save(() => api.post("/settings/insurance-rates", v))) { setV({ ...v, effective_from: "", rate: "", note: "" }); reload(); } }}>追加する</Button>
        </div>
      </Panel>
    </div>
  );
}

function AnnouncementSettings() {
  const { data, reload } = useQuery<any[]>("/announcements");
  const save = useSave();
  const [v, setV] = useState({ title: "", body: "", published_on: "" });
  return (
    <div className="space-y-5">
      <Panel title="お知らせを投稿" className="max-w-2xl">
        <div className="space-y-3">
          <Field label="タイトル" required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="本文"><Textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
          <Field label="掲載日" hint="空欄なら今日"><Input type="date" value={v.published_on} onChange={(e) => setV({ ...v, published_on: e.target.value })} className="w-44" /></Field>
          <Button variant="primary" onClick={async () => { if (await save(() => api.post("/announcements", v), "投稿しました")) { setV({ title: "", body: "", published_on: "" }); reload(); } }}>投稿する</Button>
        </div>
      </Panel>
      <Panel title="投稿済み" bodyClass="p-0">
        <ul>
          {data?.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3 border-b border-line-2">
              <span className="num text-xs text-ink-3 w-24 shrink-0 pt-0.5">{ymdJa(a.published_on)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{a.title}</div>
                <p className="text-xs text-ink-2 whitespace-pre-wrap">{a.body}</p>
              </div>
              <Button size="sm" variant="ghost" aria-label="削除" onClick={async () => { if (confirm("削除しますか？") && (await save(() => api.del(`/announcements/${a.id}`), "削除しました"))) reload(); }}><Trash2 className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function AuditLogs() {
  const { data } = useQuery<any[]>("/audit-logs");
  if (!data) return <Spinner />;
  return (
    <Panel title="操作ログ (直近200件)" bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>対象</th></tr></thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id}>
                <td className="num text-ink-2 whitespace-nowrap">{dateTimeJa(l.created_at)}</td>
                <td>{l.user_name ?? "-"}</td>
                <td className="text-xs">{l.action}</td>
                <td className="text-xs text-ink-2">{l.target_type} {l.target_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
