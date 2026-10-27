import { Link } from "react-router";
import { useQuery } from "../../lib/hooks";
import { ymdJa } from "../../lib/format";
import { addDays, addMonthsToDate, diffDays } from "../../../shared/dates";
import { Empty, ErrorBox, PageHeader, Pill, Spinner } from "../../components/ui";

export function AdminLeavePage() {
  const { data, error, loading, reload } = useQuery<any[]>("/leave/obligation");
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="休暇管理" sub="年10日以上の有給休暇が付与された従業員の、年5日の取得義務の状況です。" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <div className="panel"><Empty title="対象の従業員はいません">年10日以上の有給休暇が付与されると、ここに表示されます。</Empty></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>従業員</th>
                <th>基準日 (付与日)</th>
                <th>期限</th>
                <th className="r">付与日数</th>
                <th className="w-48">取得日数</th>
                <th className="r">残日数</th>
                <th>状況</th>
              </tr>
            </thead>
            <tbody>
              {data
                ?.map((r) => ({ ...r, deadline: addMonthsToDate(r.grantedOn, 12) }))
                .sort((a, b) => (a.used >= 5 ? 1 : 0) - (b.used >= 5 ? 1 : 0) || a.deadline.localeCompare(b.deadline))
                .map((r) => {
                  const left = diffDays(today, r.deadline);
                  const done = r.used >= 5;
                  return (
                    <tr key={r.employee.id}>
                      <td><Link to={`/employees/${r.employee.id}?tab=leave`} className="link">{r.employee.last_name} {r.employee.first_name}</Link><div className="text-[11px] text-ink-3">{r.employee.department_name}</div></td>
                      <td className="num">{ymdJa(r.grantedOn)}</td>
                      <td className="num">{ymdJa(addDays(r.deadline, -1))}<div className="text-[11px] text-ink-3">{left > 0 ? `あと${left}日` : "期限切れ"}</div></td>
                      <td className="r num">{r.grantedDays}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-line-2 overflow-hidden">
                            <div className={`h-full ${done ? "bg-ok" : left < 90 ? "bg-ng" : "bg-yamabuki-600"}`} style={{ width: `${Math.min(100, (r.used / 5) * 100)}%` }} />
                          </div>
                          <span className="num text-[13px] w-12 text-right">{r.used}日</span>
                        </div>
                      </td>
                      <td className="r num">{r.available}</td>
                      <td>{done ? <Pill cls="bg-ok-bg text-ok">達成</Pill> : left < 90 ? <Pill cls="bg-ng-bg text-ng">あと{5 - r.used}日 要取得</Pill> : <Pill cls="bg-warn-bg text-warn">あと{5 - r.used}日</Pill>}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-3 mt-3">労働基準法により、年10日以上の年次有給休暇が付与される労働者には、付与日から1年以内に5日を取得させる必要があります。期限まで90日を切ると赤で表示します。</p>
    </div>
  );
}
