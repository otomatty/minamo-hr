import { Link, useNavigate, useParams } from "react-router";
import { Printer } from "lucide-react";
import { useQuery } from "../lib/hooks";
import { hm, monthJa, ymdJa, yen } from "../lib/format";
import { Button, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";

export function PayslipsPage() {
  const { data, error, loading, reload } = useQuery<any[]>("/payslips");
  return (
    <div>
      <PageHeader title="給与明細" sub="公開された給与明細を確認できます。" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <div className="panel">
          <Empty title="公開された給与明細はまだありません">給与が確定して公開されると、ここに表示されます。</Empty>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>対象月</th>
                <th>支給日</th>
                <th className="r">総支給額</th>
                <th className="r">控除合計</th>
                <th className="r">差引支給額</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/payslips/${s.id}`} className="link font-medium">{monthJa(s.pay_month)}分</Link>
                  </td>
                  <td className="num">{ymdJa(s.pay_date)}</td>
                  <td className="r num">{yen(s.gross_pay)}</td>
                  <td className="r num">{yen(s.total_deductions)}</td>
                  <td className="r num font-semibold">{yen(s.net_pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PayslipDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: s, error, loading } = useQuery<any>(`/payslips/${id}`);
  if (error) return <ErrorBox message={error} />;
  if (loading || !s) return <Spinner />;
  return (
    <div>
      <PageHeader
        back={<button type="button" className="link" onClick={() => nav(-1)}>← 戻る</button>}
        title={`${monthJa(s.pay_month)}分 給与明細`}
        actions={<Button onClick={() => window.print()}><Printer className="size-4" />印刷・PDF保存</Button>}
      />
      <PayslipSheet s={s} />
    </div>
  );
}

export function PayslipSheet({ s }: { s: any }) {
  const p = s.payload;
  const a = p.attendance;
  return (
    <article className="panel print-area max-w-4xl p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b-2 border-ai-900">
        <div>
          <h2 className="text-lg font-semibold">給与明細書</h2>
          <p className="text-[13px] text-ink-2 mt-0.5">{monthJa(s.pay_month)}分 ・ 支給日 {ymdJa(s.pay_date)}</p>
          <p className="text-xs text-ink-3 mt-0.5 num">対象期間 {s.period_start.replaceAll("-", "/")} 〜 {s.period_end.replaceAll("-", "/")}</p>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold">{s.last_name} {s.first_name} 様</div>
          <div className="text-xs text-ink-3">社員番号 {s.code}{s.department_name ? ` ・ ${s.department_name}` : ""}</div>
          <div className="text-xs text-ink-3 mt-1">{s.company_name}</div>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-6 mt-6">
        <LineTable title="支給" lines={p.payments} total={p.totals.gross} totalLabel="総支給額" />
        <LineTable title="控除" lines={p.deductions} total={p.totals.deductions} totalLabel="控除合計" />
        <div>
          <h3 className="text-[13px] font-semibold border-b border-line pb-1.5 mb-2">勤怠</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
            <dt className="text-ink-2">出勤日数</dt><dd className="num text-right">{a.workDays}日</dd>
            <dt className="text-ink-2">所定労働日数</dt><dd className="num text-right">{a.scheduledDays}日</dd>
            <dt className="text-ink-2">有給取得</dt><dd className="num text-right">{a.paidLeaveDays}日</dd>
            <dt className="text-ink-2">欠勤</dt><dd className="num text-right">{a.absenceDays + a.unpaidLeaveDays}日</dd>
            <dt className="text-ink-2">総労働時間</dt><dd className="num text-right">{hm(a.totalWorkMinutes)}</dd>
            <dt className="text-ink-2">時間外労働</dt><dd className="num text-right">{hm(a.legalOvertime)}</dd>
            <dt className="text-ink-2">深夜労働</dt><dd className="num text-right">{hm(a.lateNightMinutes)}</dd>
            <dt className="text-ink-2">休日労働</dt><dd className="num text-right">{hm(a.legalHolidayMinutes)}</dd>
            <dt className="text-ink-2">遅刻早退</dt><dd className="num text-right">{hm(a.lateMinutes + a.earlyLeaveMinutes)}</dd>
          </dl>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4 rounded-md bg-ai-50 px-5 py-4">
        <div className="text-xs text-ink-2 space-y-0.5">
          <div>課税対象額 <span className="num">{yen(p.totals.taxable)}</span>円 ・ 社会保険料等 <span className="num">{yen(p.totals.socialInsurance)}</span>円</div>
          {p.meta.standard ? <div>標準報酬月額 <span className="num">{yen(p.meta.standard)}</span>円 ・ 扶養親族等 {p.meta.dependents}人 ・ 税額表 {p.meta.taxColumn === "kou" ? "甲欄" : p.meta.taxColumn === "otsu" ? "乙欄" : "-"}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-2">差引支給額</div>
          <div className="text-3xl font-semibold num text-ai-900">{yen(p.totals.net)}<span className="text-base font-normal ml-1">円</span></div>
        </div>
      </div>
      {p.warnings?.length > 0 && (
        <ul className="mt-4 text-xs text-warn list-disc pl-5 no-print">
          {p.warnings.map((w: string) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </article>
  );
}

function LineTable({ title, lines, total, totalLabel }: { title: string; lines: any[]; total: number; totalLabel: string }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold border-b border-line pb-1.5 mb-2">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
        {lines.length === 0 && <dd className="text-ink-3 col-span-2">なし</dd>}
        {lines.map((l, i) => (
          <div key={i} className="contents">
            <dt className="text-ink-2">
              {l.name}
              {l.note && <span className="text-[11px] text-ink-3 ml-1">{l.note}</span>}
              {l.taxable === false && <span className="text-[10px] text-ink-3 ml-1">(非課税)</span>}
            </dt>
            <dd className={`num text-right ${l.amount < 0 ? "text-ng" : ""}`}>{yen(l.amount)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-between border-t border-line mt-3 pt-2 text-[13px] font-semibold">
        <span>{totalLabel}</span>
        <span className="num">{yen(total)}</span>
      </div>
    </div>
  );
}
