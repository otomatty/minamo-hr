import { useMemo, useState } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { formIdOf, useLookups } from "../lib/lookups";
import { mdW, REQ_STATUS, UNIT_JA, ymdJa } from "../lib/format";
import { Button, ErrorBox, Field, Input, PageHeader, Panel, Pill, Select, Spinner, Textarea } from "../components/ui";
import { useToast } from "../components/toast";
import { eachDay, weekday } from "../../shared/dates";

export function LeavePage() {
  const balance = useQuery<any>("/leave/balance");
  const requests = useQuery<any[]>("/requests?scope=mine&kind=leave");
  const reload = () => {
    balance.reload();
    requests.reload();
  };
  return (
    <div>
      <PageHeader title="休暇" sub="有給休暇の残日数の確認と、休暇の申請ができます。" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 min-w-0">
          <LeaveApplyForm onDone={reload} />
          <Panel title="申請履歴" bodyClass="p-0">
            {requests.loading && !requests.data ? (
              <Spinner />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>内容</th>
                    <th>申請日</th>
                    <th>状況</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.data?.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-ink-3 py-8">休暇の申請はまだありません</td>
                    </tr>
                  )}
                  {requests.data?.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/requests/${r.id}`} className="link">{r.title}</Link>
                      </td>
                      <td className="num text-ink-2">{r.submitted_at?.slice(0, 10).replaceAll("-", "/") ?? "-"}</td>
                      <td>
                        <Pill cls={REQ_STATUS[r.status].cls}>{REQ_STATUS[r.status].label}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          {balance.error && <ErrorBox message={balance.error} />}
          {balance.data && <BalancePanel b={balance.data} />}
          {balance.data && (
            <Panel title="取得記録" bodyClass="p-0">
              <ul className="max-h-80 overflow-y-auto">
                {balance.data.records.length === 0 && <li className="px-4 py-6 text-[13px] text-ink-3 text-center">取得記録はありません</li>}
                {balance.data.records.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2 border-b border-line-2 text-[13px]">
                    <span className="num">{mdW(r.leave_date)} <span className="text-ink-3 text-xs">{r.leave_date.slice(0, 4)}</span></span>
                    <span>{r.type_name} ・ {UNIT_JA[r.unit]}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

export function BalancePanel({ b }: { b: any }) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return (
    <Panel title="有給休暇の残日数">
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold num text-ai-900">{b.available}</span>
        <span className="text-ink-3">日</span>
        {b.pending > 0 && <span className="ml-auto text-xs text-ink-3">うち申請中 {b.pending}日</span>}
      </div>
      {b.currentGrant && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-ink-3">
            <span>年5日の取得義務</span>
            <span className="num">{Math.min(b.usedInCurrentYear, 5)} / 5日</span>
          </div>
          <div className="h-1.5 rounded-full bg-line-2 mt-1 overflow-hidden">
            <div className={`h-full ${b.usedInCurrentYear >= 5 ? "bg-ok" : "bg-yamabuki-600"}`} style={{ width: `${Math.min(100, (b.usedInCurrentYear / 5) * 100)}%` }} />
          </div>
          <p className="text-[11px] text-ink-3 mt-1">{ymdJa(b.currentGrant.granted_on)} の付与から1年以内に5日以上の取得が必要です</p>
        </div>
      )}
      <table className="table mt-4">
        <thead>
          <tr>
            <th>付与日</th>
            <th className="r">付与</th>
            <th className="r">残</th>
            <th>失効日</th>
          </tr>
        </thead>
        <tbody>
          {b.grants.length === 0 && (
            <tr>
              <td colSpan={4} className="text-ink-3 text-center py-4">付与はまだありません</td>
            </tr>
          )}
          {b.grants.map((g: any) => {
            const expired = g.expires_on <= today;
            return (
              <tr key={g.id} className={expired ? "text-ink-3" : ""}>
                <td className="num">{g.granted_on.replaceAll("-", "/")}</td>
                <td className="r num">{g.days}</td>
                <td className="r num">{expired ? "失効" : g.remaining}</td>
                <td className="num">{g.expires_on.replaceAll("-", "/")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {b.next && <p className="text-xs text-ink-3 mt-3">次回は {ymdJa(b.next.granted_on)} に {b.next.days}日 付与される予定です</p>}
    </Panel>
  );
}

function LeaveApplyForm({ onDone }: { onDone: () => void }) {
  const lookups = useLookups();
  const toast = useToast();
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unit, setUnit] = useState<"full" | "am" | "pm">("full");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const type = lookups?.leaveTypes.find((t) => String(t.id) === typeId);
  const dates = useMemo(() => {
    if (!from) return [];
    const end = to && to >= from ? to : from;
    const list = eachDay(from, end);
    if (list.length > 62) return [];
    return list.filter((d) => (list.length === 1 ? true : weekday(d) !== 0 && weekday(d) !== 6) && !removed.has(d));
  }, [from, to, removed]);
  const single = dates.length === 1;
  const days = dates.length * (single && unit !== "full" ? 0.5 : 1);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/requests", {
        formId: formIdOf(lookups, "leave"),
        submit: true,
        payload: { leave_type_id: Number(typeId), dates: dates.map((d) => ({ date: d, unit: single ? unit : "full" })), reason },
      });
      toast.ok("休暇を申請しました");
      setFrom("");
      setTo("");
      setReason("");
      setRemoved(new Set());
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="休暇を申請する">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="休暇の種類" required>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="選択してください" options={(lookups?.leaveTypes ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.is_paid ? "" : " (無給)"}` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="開始日" required>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setRemoved(new Set()); }} />
          </Field>
          <Field label="終了日">
            <Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setRemoved(new Set()); }} />
          </Field>
        </div>
      </div>
      {single && type?.allow_half_day ? (
        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="取得単位">
          {(["full", "am", "pm"] as const).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)} className={`btn btn-sm ${unit === u ? "btn-primary" : "btn-secondary"}`}>
              {UNIT_JA[u]}
            </button>
          ))}
        </div>
      ) : null}
      {dates.length > 1 && (
        <div className="mt-4">
          <div className="label">取得する日 (土日は除いています。不要な日は外してください)</div>
          <div className="flex flex-wrap gap-1.5">
            {dates.map((d) => (
              <span key={d} className="pill bg-ai-50 text-ai-800 border border-ai-100 gap-1">
                <span className="num">{mdW(d)}</span>
                <button type="button" onClick={() => setRemoved(new Set([...removed, d]))} aria-label={`${d} を外す`}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <Field label="理由・連絡事項" className="mt-4">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 私用のため" />
      </Field>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">{dates.length ? <>合計 <b className="num">{days}</b> 日</> : "取得日を選んでください"}</span>
        <Button variant="primary" loading={busy} disabled={!typeId || dates.length === 0} onClick={submit}>
          申請する
        </Button>
      </div>
    </Panel>
  );
}
