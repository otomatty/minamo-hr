import { useState } from "react";
import { Link } from "react-router";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { formIdOf, useLookups } from "../lib/lookups";
import { hm, hmOrDash, mdW, time } from "../lib/format";
import { Button, ErrorBox, Field, Input, Modal, MonthNav, Panel, Pill, Spinner, Stat, Textarea } from "./ui";
import { DayRuler, RulerLegend } from "./DayRuler";
import { useToast } from "./toast";
import { addDays, weekday } from "../../shared/dates";

interface Props {
  employeeId?: number;
  month: string;
  onMonthChange: (m: string) => void;
  mode: "self" | "manage";
  headerExtra?: React.ReactNode;
}

export function AttendanceMonth({ employeeId, month, onMonthChange, mode, headerExtra }: Props) {
  const url = `/attendance/month?month=${month}${employeeId ? `&employeeId=${employeeId}` : ""}`;
  const { data, error, loading, reload } = useQuery<any>(url);
  const [fixDay, setFixDay] = useState<any | null>(null);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const s = data?.summary;
  const otAlert = data ? s.legalOvertime / 60 >= data.overtimeAlertHours : false;
  const pendingDates = new Set((data?.pendingRequests ?? []).map((r: any) => r.date));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthNav month={month} onChange={onMonthChange} />
        {data && (
          <span className="text-[13px] text-ink-3 num">
            {data.start.replaceAll("-", "/")} 〜 {data.end.replaceAll("-", "/")}
          </span>
        )}
        {data?.locked && (
          <Pill cls="bg-line-2 text-ink-2">
            <Lock className="size-3 mr-1" />締め済み
          </Pill>
        )}
        <div className="flex-1" />
        {headerExtra}
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        data && (
          <>
            <Panel>
              <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-9 gap-4">
                <Stat label="出勤日数" value={`${s.workDays}日`} sub={`所定 ${s.scheduledDays}日`} />
                <Stat label="総労働" value={hm(s.totalWorkMinutes)} />
                <Stat label="法定内残業" value={hm(s.withinLegalOvertime + s.nonScheduledMinutes)} />
                <Stat label="時間外 (法定外)" value={hm(s.legalOvertime)} tone={otAlert ? "ng" : undefined} sub={s.over60Minutes ? `60h超 ${hm(s.over60Minutes)}` : undefined} />
                <Stat label="深夜" value={hm(s.lateNightMinutes)} />
                <Stat label="法定休日" value={hm(s.legalHolidayMinutes)} />
                <Stat label="有給取得" value={`${s.paidLeaveDays}日`} />
                <Stat label="欠勤" value={`${s.absenceDays + s.unpaidLeaveDays}日`} tone={s.absenceDays ? "warn" : undefined} />
                <Stat label="遅刻 / 早退" value={`${s.lateCount} / ${s.earlyLeaveCount}`} />
              </div>
              {otAlert && <p className="mt-3 text-[13px] text-ng">時間外労働が月 {data.overtimeAlertHours} 時間を超えています。36協定の上限に注意してください。</p>}
            </Panel>

            <div className="panel overflow-x-auto">
              <table className="table min-w-[920px]">
                <thead>
                  <tr>
                    <th className="w-28">日付</th>
                    <th className="w-[26%]">
                      <span className="sr-only">勤務帯</span>
                    </th>
                    <th>出勤</th>
                    <th>退勤</th>
                    <th className="r">休憩</th>
                    <th className="r">実働</th>
                    <th className="r">残業</th>
                    <th className="r">深夜</th>
                    <th>状況</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((d: any) => {
                    const wd = weekday(d.date);
                    const off = d.dayType !== "workday";
                    const leave = d.leaveUnit;
                    const notes: React.ReactNode[] = [];
                    for (const n of d.leaveNames) notes.push(<Pill key={n} cls="bg-yamabuki-100 text-yamabuki-600">{n}</Pill>);
                    if (d.absent) notes.push(<Pill key="ab" cls="bg-ng-bg text-ng">欠勤</Pill>);
                    if (d.incomplete) notes.push(<Pill key="in" cls="bg-warn-bg text-warn">退勤漏れ</Pill>);
                    if (d.lateMinutes) notes.push(<Pill key="la" cls="bg-line-2 text-ink-2">遅刻 {hm(d.lateMinutes)}</Pill>);
                    if (d.earlyLeaveMinutes) notes.push(<Pill key="ea" cls="bg-line-2 text-ink-2">早退 {hm(d.earlyLeaveMinutes)}</Pill>);
                    if (pendingDates.has(d.date)) notes.push(<Pill key="pe" cls="bg-ai-100 text-ai-800">申請中</Pill>);
                    if (d.autoBreak) notes.push(<span key="ab2" className="text-[11px] text-ink-3">休憩自動</span>);
                    const future = d.date > today;
                    return (
                      <tr key={d.date} className={off ? "bg-surface/70" : ""}>
                        <td className="whitespace-nowrap">
                          <span className={`num ${wd === 0 || d.holidayName ? "text-ng" : wd === 6 ? "text-ai-600" : ""}`}>{mdW(d.date)}</span>
                          {d.holidayName && <div className="text-[10px] text-ink-3 truncate max-w-28">{d.holidayName}</div>}
                          {!d.holidayName && d.dayType === "legal_holiday" && <div className="text-[10px] text-ink-3">法定休日</div>}
                        </td>
                        <td>
                          <DayRuler
                            date={d.date}
                            clockIn={d.clockIn}
                            clockOut={d.clockOut}
                            breaks={d.breaks}
                            scheduled={d.dayType === "workday" ? { start: data.pattern.startTime, end: data.pattern.endTime } : null}
                            overtimeMinutes={d.legalOvertime + d.legalHolidayMinutes}
                            leave={leave}
                            nowMin={d.date === today && d.clockIn && !d.clockOut ? nowMinutes() : null}
                          />
                        </td>
                        <td className="num">{time(d.clockIn)}{d.clockIn && d.clockIn.slice(0, 10) !== d.date ? "*" : ""}</td>
                        <td className="num">{d.clockOut ? `${d.clockOut.slice(0, 10) !== d.date ? "翌" : ""}${time(d.clockOut)}` : ""}</td>
                        <td className="r num text-ink-2">{hmOrDash(d.breakMinutes)}</td>
                        <td className="r num">{hmOrDash(d.workMinutes)}</td>
                        <td className="r num">{hmOrDash(d.withinLegalOvertime + d.nonScheduledMinutes + d.legalOvertime + d.legalHolidayMinutes)}</td>
                        <td className="r num text-ink-2">{hmOrDash(d.lateNightMinutes)}</td>
                        <td>
                          <div className="flex flex-wrap gap-1 items-center">{notes}</div>
                          {d.note && <div className="text-[11px] text-ink-3 truncate max-w-48" title={d.note}>{d.note}</div>}
                        </td>
                        <td className="text-right">
                          {!data.locked && !future && d.inEmployment && (
                            <Button size="sm" variant="ghost" onClick={() => setFixDay(d)} aria-label={`${mdW(d.date)} の勤怠を${mode === "self" ? "修正申請" : "編集"}`}>
                              <Pencil className="size-3.5" />
                              {mode === "self" ? "修正申請" : "編集"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <RulerLegend />
          </>
        )
      )}
      {fixDay && (
        <DayEditModal
          day={fixDay}
          mode={mode}
          employeeId={employeeId ?? data?.employee?.id}
          pattern={data?.pattern}
          onClose={() => setFixDay(null)}
          onDone={() => {
            setFixDay(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function nowMinutes() {
  const j = new Date(Date.now() + 9 * 3600000);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

function DayEditModal({ day, mode, employeeId, pattern, onClose, onDone }: { day: any; mode: "self" | "manage"; employeeId: number; pattern: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const lookups = useLookups();
  const [clockIn, setClockIn] = useState(time(day.clockIn) || pattern?.startTime || "09:00");
  const [clockOut, setClockOut] = useState(time(day.clockOut) || pattern?.endTime || "18:00");
  const [nextDay, setNextDay] = useState(!!day.clockOut && day.clockOut.slice(0, 10) !== day.date);
  const [breaks, setBreaks] = useState<Array<{ start: string; end: string }>>(
    day.breaks.length ? day.breaks.map((b: any) => ({ start: time(b.start), end: time(b.end) })) : [{ start: "12:00", end: "13:00" }],
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "self") {
        const formId = formIdOf(lookups, "punch_fix");
        await api.post("/requests", {
          formId,
          submit: true,
          payload: { date: day.date, clock_in: clockIn, clock_out: clockOut, clock_out_next_day: nextDay, breaks: breaks.filter((b) => b.start && b.end), reason },
        });
        toast.ok("打刻修正を申請しました");
      } else {
        const at = (hhmm: string, next = false) => `${next ? addDays(day.date, 1) : day.date}T${hhmm}`;
        const ci = clear ? null : at(clockIn);
        let co = clear ? null : at(clockOut, nextDay);
        if (ci && co && co <= ci) co = at(clockOut, true);
        await api.put("/attendance/day", {
          employeeId,
          date: day.date,
          clock_in: ci,
          clock_out: co,
          breaks: clear
            ? []
            : breaks
                .filter((b) => b.start && b.end)
                .map((b) => {
                  const s = at(b.start, !!ci && at(b.start) < ci);
                  let e = at(b.end, !!ci && at(b.end) < ci);
                  if (e <= s) e = at(b.end, true);
                  return { start: s, end: e };
                }),
          note: reason || null,
        });
        toast.ok("勤怠を更新しました");
      }
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${mdW(day.date)} の${mode === "self" ? "打刻修正を申請" : "勤怠を編集"}`}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={mode === "self" && !reason.trim()}>
            {mode === "self" ? "申請する" : "保存する"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === "manage" && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-ai-800" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            打刻を削除する (未出勤に戻す)
          </label>
        )}
        {!clear && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="出勤">
                <Input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
              </Field>
              <Field label="退勤">
                <Input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
                <label className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
                  <input type="checkbox" className="accent-ai-800" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
                  翌日の時刻
                </label>
              </Field>
            </div>
            <div>
              <div className="label">休憩</div>
              <div className="space-y-2">
                {breaks.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="time" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label="休憩開始" />
                    <span className="text-ink-3">〜</span>
                    <Input type="time" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label="休憩終了" />
                    <Button size="sm" variant="ghost" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} aria-label="この休憩を削除">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setBreaks([...breaks, { start: "", end: "" }])}>
                  <Plus className="size-3.5" />
                  休憩を追加
                </Button>
              </div>
            </div>
          </>
        )}
        <Field label={mode === "self" ? "修正理由" : "メモ (任意)"} required={mode === "self"}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "self" ? "例: 退勤の打刻を忘れたため" : ""} />
        </Field>
        {mode === "self" && <p className="text-xs text-ink-3">承認されると勤怠に反映されます。申請の状況は<Link to="/requests" className="link">申請一覧</Link>で確認できます。</p>}
      </div>
    </Modal>
  );
}
