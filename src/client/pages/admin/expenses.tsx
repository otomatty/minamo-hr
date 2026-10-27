import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { api, downloadUrl } from "../../lib/api";
import { useQuery } from "../../lib/hooks";
import { dateTimeJa, yen } from "../../lib/format";
import { Button, Empty, ErrorBox, Field, Input, PageHeader, Panel, Pill, Spinner, Tabs } from "../../components/ui";
import { useToast } from "../../components/toast";
import { RequestTable } from "../requests";

export function AdminExpensesPage() {
  const [tab, setTab] = useState<"payables" | "pending" | "journal">("payables");
  return (
    <div>
      <PageHeader title="経費精算" sub="承認済み経費の支払管理と、会計ソフト向けの仕訳データの出力を行います。" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "payables", label: "支払管理" },
          { key: "pending", label: "承認待ちの経費" },
          { key: "journal", label: "仕訳データ" },
        ]}
      />
      {tab === "payables" && <Payables />}
      {tab === "pending" && <PendingExpenses />}
      {tab === "journal" && <Journal />}
    </div>
  );
}

function Payables() {
  const toast = useToast();
  const { data, error, loading, reload } = useQuery<any[]>("/expenses/payables");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [paidOn, setPaidOn] = useState(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  const unpaidTransfer = useMemo(() => (data ?? []).filter((r) => !r.paid_at && r.settlement === "transfer"), [data]);
  const total = (data ?? []).filter((r) => selected.has(r.id)).reduce((t, r) => t + r.amount, 0);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      {unpaidTransfer.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-end gap-3">
            <div className="text-[13px] flex-1 min-w-56">
              振込で精算する承認済みの経費が <b>{unpaidTransfer.length}件</b> ({yen(unpaidTransfer.reduce((t, r) => t + r.amount, 0))}円) あります。振り込んだものを選んで支払済みにしてください。
            </div>
            <Field label="支払日"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-40" /></Field>
            <Button
              variant="primary"
              disabled={selected.size === 0}
              onClick={async () => {
                await api.post("/expenses/mark-paid", { ids: [...selected], paid_on: paidOn });
                toast.ok(`${selected.size}件を支払済みにしました`);
                setSelected(new Set());
                reload();
              }}
            >
              選択した {selected.size}件 ({yen(total)}円) を支払済みにする
            </Button>
          </div>
        </Panel>
      )}
      {data?.length === 0 ? (
        <div className="panel"><Empty title="承認済みの経費はまだありません" /></div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th className="w-8" />
                <th>件名</th>
                <th>申請者</th>
                <th className="r">金額</th>
                <th>承認日時</th>
                <th>精算方法</th>
                <th>支払</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r) => {
                const selectable = !r.paid_at && r.settlement === "transfer";
                return (
                  <tr key={r.id}>
                    <td>
                      {selectable && (
                        <input
                          type="checkbox"
                          className="accent-ai-800"
                          aria-label={`${r.title} を選択`}
                          checked={selected.has(r.id)}
                          onChange={(e) => {
                            const s = new Set(selected);
                            if (e.target.checked) s.add(r.id);
                            else s.delete(r.id);
                            setSelected(s);
                          }}
                        />
                      )}
                    </td>
                    <td><Link to={`/requests/${r.id}`} className="link">{r.title}</Link></td>
                    <td>{r.applicant_name}<div className="text-[11px] text-ink-3">{r.department_name}</div></td>
                    <td className="r num">{yen(r.amount)}</td>
                    <td className="num text-ink-2">{dateTimeJa(r.decided_at)}</td>
                    <td>{r.settlement === "transfer" ? "振込" : "給与と一緒に支給"}</td>
                    <td>
                      {r.paid_at ? (
                        <Pill cls="bg-ok-bg text-ok">{r.paid_at.slice(0, 10).replaceAll("-", "/")} 支払済</Pill>
                      ) : r.settlement === "payroll" ? (
                        <Pill cls="bg-ai-100 text-ai-800">次回の給与で支給</Pill>
                      ) : (
                        <Pill cls="bg-warn-bg text-warn">未払い</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PendingExpenses() {
  const { data, error, loading } = useQuery<any[]>("/requests?scope=all&kind=expense&status=pending");
  if (error) return <ErrorBox message={error} />;
  if (loading && !data) return <Spinner />;
  return <RequestTable rows={data ?? []} empty="承認待ちの経費はありません" showApplicant />;
}

function Journal() {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  return (
    <Panel title="仕訳データを出力" className="max-w-2xl">
      <p className="text-[13px] text-ink-2 mb-4">承認済みの経費明細を、勘定科目コード・税率・消費税額・登録番号つきの CSV で出力します。会計ソフトの取込形式に合わせて加工してください。</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="利用日 (から)"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="利用日 (まで)"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="primary" onClick={() => downloadUrl(`/expenses/journal.csv?from=${from}&to=${to}`)}><Download className="size-4" />CSVを出力</Button>
      </div>
    </Panel>
  );
}
