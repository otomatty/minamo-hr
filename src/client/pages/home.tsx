import { useState } from "react";
import { Link } from "react-router";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useRole } from "../lib/auth";
import { useNow, useQuery } from "../lib/hooks";
import { hm, mdW, monthJa, REQ_STATUS, time, ymdJa, yen } from "../lib/format";
import { Button, ErrorBox, Panel, Pill, Spinner, Stat } from "../components/ui";
import { DayRuler, RulerLegend } from "../components/DayRuler";
import { useToast } from "../components/toast";
import { WEEKDAY_JA } from "../../shared/dates";

export function HomePage() {
  const { me } = useAuth();
  const { isAdmin } = useRole();
  const { data, error, loading, reload } = useQuery<any>("/dashboard");
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "読み込めませんでした"} onRetry={reload} />;
  const s = data.summary;
  const otHours = s.legalOvertime / 60;
  return (
    <div className="space-y-5">
      <PunchClock dashboard={data} onChange={reload} name={me?.user.name ?? ""} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={`${monthJa(data.month)}の勤務`} actions={<Link to="/attendance" className="link text-xs">勤怠を見る</Link>} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="出勤日数" value={`${s.workDays}日`} sub={`所定 ${s.scheduledDays}日`} />
            <Stat label="総労働時間" value={hm(s.totalWorkMinutes)} />
            <Stat label="時間外労働" value={hm(s.legalOvertime)} tone={otHours >= data.overtimeAlertHours ? "ng" : otHours >= data.overtimeAlertHours * 0.8 ? "warn" : undefined} sub={`上限の目安 ${data.overtimeAlertHours}時間`} />
            <Stat label="遅刻・早退" value={`${s.lateCount + s.earlyLeaveCount}回`} sub={s.incompleteDays ? `打刻漏れ ${s.incompleteDays}日` : undefined} tone={s.incompleteDays ? "warn" : undefined} />
          </div>
          {s.incompleteDays > 0 && (
            <p className="mt-4 text-[13px] text-warn">退勤の打刻がない日があります。<Link to="/attendance" className="underline">勤怠画面</Link>から打刻修正を申請してください。</p>
          )}
        </Panel>
        <Panel title="有給休暇" actions={<Link to="/leave" className="link text-xs">休暇を申請</Link>}>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold num">{data.leave.available}</span>
            <span className="text-ink-3">日 残っています</span>
          </div>
          {data.leave.pending > 0 && <p className="text-xs text-ink-3 mt-1">申請中 {data.leave.pending}日</p>}
          {data.leave.next && <p className="text-xs text-ink-3 mt-3">次回付与: {ymdJa(data.leave.next.granted_on)} に {data.leave.next.days}日</p>}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="申請と承認" bodyClass="p-0">
          <Link to="/approvals" className="flex items-center justify-between px-4 py-3 border-b border-line-2 hover:bg-ai-50">
            <span className="text-[13px]">あなたの承認待ち</span>
            <span className={`text-lg font-semibold num ${data.approvals ? "text-ai-800" : "text-ink-3"}`}>{data.approvals}件</span>
          </Link>
          <ul>
            {data.myPending.length === 0 && <li className="px-4 py-4 text-[13px] text-ink-3">進行中の申請はありません</li>}
            {data.myPending.map((r: any) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line-2 last:border-0 hover:bg-ai-50">
                  <span className="text-[13px] truncate">{r.title}</span>
                  <Pill cls={REQ_STATUS[r.status].cls}>{REQ_STATUS[r.status].label}</Pill>
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3">
            <Link to="/requests/new" className="btn btn-secondary btn-sm">新しく申請する</Link>
          </div>
        </Panel>
        <Panel title="お知らせ" bodyClass="p-0" className="lg:col-span-1">
          <ul>
            {data.announcements.length === 0 && <li className="px-4 py-4 text-[13px] text-ink-3">お知らせはありません</li>}
            {data.announcements.map((a: any) => (
              <li key={a.id} className="px-4 py-3 border-b border-line-2 last:border-0">
                <div className="text-[11px] text-ink-3 num">{ymdJa(a.published_on)}</div>
                <div className="text-[13px] font-medium">{a.title}</div>
                {a.body && <p className="text-xs text-ink-2 mt-0.5 whitespace-pre-wrap">{a.body}</p>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="給与明細" actions={<Link to="/payslips" className="link text-xs">一覧</Link>}>
          {data.latestSlip ? (
            <Link to={`/payslips/${data.latestSlip.id}`} className="block group">
              <div className="text-xs text-ink-3">{monthJa(data.latestSlip.pay_month)}分 ・ 支給日 {ymdJa(data.latestSlip.pay_date)}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-semibold num group-hover:text-ai-700">{yen(data.latestSlip.net_pay)}</span>
                <span className="text-ink-3 text-[13px]">円 (差引支給額)</span>
              </div>
            </Link>
          ) : (
            <p className="text-[13px] text-ink-3">公開された給与明細はまだありません</p>
          )}
        </Panel>
      </div>

      {(data.teamStats || data.adminAlerts) && (
        <div className="grid gap-5 lg:grid-cols-3">
          {data.teamStats && (
            <Panel title={isAdmin ? "本日の全社の勤務状況" : "本日のチームの勤務状況"} actions={<Link to="/admin/attendance?tab=today" className="link text-xs">詳細</Link>}>
              <div className="grid grid-cols-4 gap-3">
                <Stat label="対象" value={data.teamStats.total} />
                <Stat label="勤務中" value={data.teamStats.working} />
                <Stat label="退勤済み" value={data.teamStats.done} />
                <Stat label="休暇" value={data.teamStats.onLeave} />
              </div>
            </Panel>
          )}
          {data.adminAlerts && (
            <Panel title="対応が必要なこと" className="lg:col-span-2" bodyClass="p-0">
              <ul className="text-[13px]">
                {data.adminAlerts.unpaidExpenses.n > 0 && (
                  <li className="px-4 py-2.5 border-b border-line-2">
                    <Link to="/admin/expenses" className="link">振込待ちの経費が {data.adminAlerts.unpaidExpenses.n}件 ({yen(data.adminAlerts.unpaidExpenses.total)}円) あります</Link>
                  </li>
                )}
                {data.adminAlerts.employeesWithoutSalary > 0 && (
                  <li className="px-4 py-2.5 border-b border-line-2">
                    <Link to="/admin/payroll?tab=settings" className="link">給与設定が未登録の従業員が {data.adminAlerts.employeesWithoutSalary}名 います</Link>
                  </li>
                )}
                {data.adminAlerts.upcoming.map((e: any) => (
                  <li key={e.id} className="px-4 py-2.5 border-b border-line-2">
                    <Link to={`/employees/${e.id}`} className="link">
                      {e.last_name} {e.first_name}
                    </Link>{" "}
                    さんが {e.leave_date ? `${ymdJa(e.leave_date)} に退職予定` : `${ymdJa(e.hire_date)} に入社予定`}です
                  </li>
                ))}
                {data.adminAlerts.unpaidExpenses.n === 0 && data.adminAlerts.employeesWithoutSalary === 0 && data.adminAlerts.upcoming.length === 0 && (
                  <li className="px-4 py-4 text-ink-3">今のところ対応が必要なことはありません</li>
                )}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { off: "未出勤", working: "勤務中", on_break: "休憩中", done: "退勤済み" };

function PunchClock({ dashboard, onChange, name }: { dashboard: any; onChange: () => void; name: string }) {
  const now = useNow(1000);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const jst = new Date(now.getTime() + 9 * 3600000);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  const ss = String(jst.getUTCSeconds()).padStart(2, "0");
  const today = jst.toISOString().slice(0, 10);
  const p = dashboard.punch;
  const state: string = p.status;
  const workDate = p.workDate ?? today;
  const nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes() + (workDate < today ? 1440 : 0);

  const doPunch = async (kind: string, label: string) => {
    setBusy(kind);
    try {
      await api.post("/attendance/punch", { kind });
      toast.ok(`${label}を打刻しました (${hh}:${mm})`);
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel overflow-hidden">
      <div className="grid md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="p-5 md:p-6">
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <span>{today.slice(0, 4)}年{Number(today.slice(5, 7))}月{Number(today.slice(8, 10))}日 ({WEEKDAY_JA[jst.getUTCDay()]})</span>
            <span aria-hidden>/</span>
            <span>{name} さん</span>
          </div>
          <div className="mt-1 flex items-end gap-4 flex-wrap">
            <div className="font-semibold num leading-none tracking-tight text-ai-900" style={{ fontSize: "clamp(44px, 7vw, 64px)" }} aria-label={`現在時刻 ${hh}時${mm}分`}>
              {hh}:{mm}
              <span className="text-ink-3 text-[0.4em] ml-1 font-medium">{ss}</span>
            </div>
            <div className="pb-1.5">
              <Pill cls={state === "working" ? "bg-asagi-100 text-asagi-700" : state === "on_break" ? "bg-warn-bg text-warn" : state === "done" ? "bg-ok-bg text-ok" : "bg-line-2 text-ink-2"}>
                {STATUS_TEXT[state]}
              </Pill>
              <div className="text-xs text-ink-3 mt-1 num">
                {p.clockIn && <>出勤 {time(p.clockIn)}</>}
                {p.clockOut && <> ・ 退勤 {time(p.clockOut)}</>}
                {p.workDate && p.workDate !== today && <> ({mdW(p.workDate)} からの勤務)</>}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <DayRuler date={workDate} clockIn={p.clockIn} clockOut={p.clockOut} breaks={p.breaks} nowMin={p.clockOut ? null : nowMin} height={14} showScale />
            <div className="mt-2">
              <RulerLegend />
            </div>
          </div>
        </div>
        <div className="border-t md:border-t-0 md:border-l border-line-2 bg-surface/60 p-5 md:p-6 grid grid-cols-2 gap-2.5 content-center md:w-[300px]">
          <Button variant="primary" size="lg" className="h-14" disabled={p.workDate === today && state !== "off"} loading={busy === "clock_in"} onClick={() => doPunch("clock_in", "出勤")}>
            <LogIn className="size-4" /> 出勤
          </Button>
          <Button size="lg" className="h-14" disabled={state !== "working" && state !== "on_break"} loading={busy === "clock_out"} onClick={() => doPunch("clock_out", "退勤")}>
            <LogOut className="size-4" /> 退勤
          </Button>
          <Button size="lg" variant="ghost" className="border-line bg-white" disabled={state !== "working"} loading={busy === "break_start"} onClick={() => doPunch("break_start", "休憩開始")}>
            <Coffee className="size-4" /> 休憩開始
          </Button>
          <Button size="lg" variant="ghost" className="border-line bg-white" disabled={state !== "on_break"} loading={busy === "break_end"} onClick={() => doPunch("break_end", "休憩終了")}>
            <Play className="size-4" /> 休憩終了
          </Button>
        </div>
      </div>
    </section>
  );
}
