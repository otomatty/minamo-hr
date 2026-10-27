import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Download, Lock, Unlock } from "lucide-react";
import { api, downloadUrl } from "../../lib/api";
import { useAuth, useRole } from "../../lib/auth";
import { useQuery } from "../../lib/hooks";
import { currentMonth, hm, time } from "../../lib/format";
import { Avatar, Button, Empty, ErrorBox, MonthNav, PageHeader, Pill, Spinner, Tabs } from "../../components/ui";
import { AttendanceMonth } from "../../components/AttendanceMonth";
import { useToast } from "../../components/toast";

export function AdminAttendancePage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "summary";
  const month = params.get("month") ?? currentMonth(me?.company?.closingDay ?? 0);
  return (
    <div>
      <PageHeader title="勤怠管理" sub="従業員の勤怠の集計、本日の勤務状況、月次の締めを行います。" />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t, month })}
        tabs={[
          { key: "summary", label: "月次集計" },
          { key: "today", label: "本日の勤務状況" },
        ]}
      />
      {tab === "summary" ? <Summary month={month} setMonth={(m) => setParams({ tab, month: m })} /> : <Today />}
    </div>
  );
}

function Summary({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { isAdmin } = useRole();
  const toast = useToast();
  const { data, error, loading, reload } = useQuery<any>(`/attendance/summary?month=${month}`);
  const [busy, setBusy] = useState(false);
  const toggleLock = async () => {
    if (!data) return;
    const msg = data.locked ? "締めを解除すると、従業員の打刻・申請の反映ができるようになります。解除しますか？" : "この月の勤怠を締めます。締めた後は打刻・修正・休暇の反映ができなくなります。よろしいですか？";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      if (data.locked) await api.del(`/attendance/lock/${month}`);
      else await api.post("/attendance/lock", { month });
      toast.ok(data.locked ? "締めを解除しました" : "勤怠を締めました");
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const issues = (s: any) => s.incompleteDays + s.absenceDays;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthNav month={month} onChange={setMonth} />
        {data && <span className="text-[13px] text-ink-3 num">{data.start.replaceAll("-", "/")} 〜 {data.end.replaceAll("-", "/")}</span>}
        {data?.locked && <Pill cls="bg-line-2 text-ink-2"><Lock className="size-3 mr-1" />締め済み</Pill>}
        <div className="flex-1" />
        {isAdmin && (
          <>
            <Button onClick={() => downloadUrl(`/attendance/export.csv?month=${month}`)}><Download className="size-4" />集計CSV</Button>
            <Button onClick={() => downloadUrl(`/attendance/export.csv?month=${month}&detail=1`)}><Download className="size-4" />日次CSV</Button>
            <Button variant={data?.locked ? "secondary" : "primary"} loading={busy} onClick={toggleLock}>
              {data?.locked ? <><Unlock className="size-4" />締めを解除</> : <><Lock className="size-4" />この月を締める</>}
            </Button>
          </>
        )}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : data?.rows.length === 0 ? (
        <div className="panel"><Empty title="対象の従業員がいません" /></div>
      ) : (
        data && (
          <div className="panel overflow-x-auto">
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th>従業員</th>
                  <th className="r">出勤 / 所定</th>
                  <th className="r">総労働</th>
                  <th className="r">法定内残業</th>
                  <th className="r">時間外</th>
                  <th className="r">深夜</th>
                  <th className="r">休日</th>
                  <th className="r">有給</th>
                  <th className="r">欠勤</th>
                  <th className="r">遅刻/早退</th>
                  <th>確認事項</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ employee: e, summary: s }: any) => {
                  const otH = s.legalOvertime / 60;
                  const otTone = otH >= data.overtimeAlertHours ? "text-ng font-semibold" : otH >= data.overtimeAlertHours * 0.8 ? "text-warn font-semibold" : "";
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link to={`/admin/attendance/${e.id}?month=${month}`} className="flex items-center gap-2 link">
                          <Avatar name={e.last_name + e.first_name} size={24} />
                          <span>
                            {e.last_name} {e.first_name}
                            <span className="block text-[11px] text-ink-3">{e.department_name ?? "未所属"}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="r num">{s.workDays} / {s.scheduledDays}</td>
                      <td className="r num">{hm(s.totalWorkMinutes)}</td>
                      <td className="r num">{hm(s.withinLegalOvertime + s.nonScheduledMinutes)}</td>
                      <td className={`r num ${otTone}`}>{hm(s.legalOvertime)}</td>
                      <td className="r num">{hm(s.lateNightMinutes)}</td>
                      <td className="r num">{hm(s.legalHolidayMinutes)}</td>
                      <td className="r num">{s.paidLeaveDays}</td>
                      <td className="r num">{s.absenceDays + s.unpaidLeaveDays}</td>
                      <td className="r num">{s.lateCount} / {s.earlyLeaveCount}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {s.incompleteDays > 0 && <Pill cls="bg-warn-bg text-warn">打刻漏れ {s.incompleteDays}日</Pill>}
                          {s.absenceDays > 0 && <Pill cls="bg-ng-bg text-ng">欠勤 {s.absenceDays}日</Pill>}
                          {otH >= data.overtimeAlertHours && <Pill cls="bg-ng-bg text-ng">36協定 超過</Pill>}
                          {issues(s) === 0 && otH < data.overtimeAlertHours && <span className="text-xs text-ink-3">-</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      <p className="text-xs text-ink-3">時間外は法定労働時間 (1日8時間・週40時間) を超えた時間です。月 {data?.overtimeAlertHours ?? 45} 時間 (36協定の原則の上限) を超えると赤、8割を超えると黄色で表示します。</p>
    </div>
  );
}

const TODAY_STATUS: Record<string, { label: string; cls: string }> = {
  off: { label: "未出勤", cls: "bg-line-2 text-ink-2" },
  working: { label: "勤務中", cls: "bg-asagi-100 text-asagi-700" },
  on_break: { label: "休憩中", cls: "bg-warn-bg text-warn" },
  done: { label: "退勤済み", cls: "bg-ok-bg text-ok" },
};

function Today() {
  const { data, error, loading, reload } = useQuery<any[]>("/attendance/today");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  const order = { working: 0, on_break: 1, off: 2, done: 3 } as Record<string, number>;
  const rows = [...(data ?? [])].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="panel overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>従業員</th>
            <th>部署</th>
            <th>状況</th>
            <th>出勤</th>
            <th>退勤</th>
            <th>休暇</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee.id}>
              <td><Link to={`/admin/attendance/${r.employee.id}`} className="link">{r.employee.last_name} {r.employee.first_name}</Link></td>
              <td>{r.employee.department_name ?? "-"}</td>
              <td><Pill cls={TODAY_STATUS[r.status].cls}>{TODAY_STATUS[r.status].label}</Pill></td>
              <td className="num">{time(r.clock_in)}</td>
              <td className="num">{time(r.clock_out)}</td>
              <td>{r.leave ? <Pill cls="bg-yamabuki-100 text-yamabuki-600">{r.leave.name}</Pill> : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmployeeAttendancePage() {
  const { employeeId } = useParams();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth(me?.company?.closingDay ?? 0);
  const emp = useQuery<any>(`/employees/${employeeId}`);
  const e = emp.data?.employee;
  return (
    <div>
      <PageHeader
        back={<Link to={`/admin/attendance?month=${month}`} className="link">← 勤怠管理</Link>}
        title={e ? `${e.last_name} ${e.first_name} の勤怠` : "勤怠"}
        sub={e ? `${e.code} ・ ${e.department_name ?? "未所属"}` : undefined}
      />
      <AttendanceMonth employeeId={Number(employeeId)} month={month} onMonthChange={(m) => setParams({ month: m })} mode="manage" />
    </div>
  );
}
