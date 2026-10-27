import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { useQuery } from "../lib/hooks";
import { EMPLOYMENT_JA } from "../lib/format";
import { Avatar, ErrorBox, Input, PageHeader, Spinner, Tabs } from "../components/ui";

export function OrgPage() {
  const [tab, setTab] = useState<"chart" | "directory">("chart");
  return (
    <div>
      <PageHeader title="組織・社員名簿" sub="部署の構成と、社内のメンバーを確認できます。" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "chart", label: "組織図" }, { key: "directory", label: "社員名簿" }]} />
      {tab === "chart" ? <OrgChart /> : <Directory />}
    </div>
  );
}

function OrgChart() {
  const { data, error, loading } = useQuery<any>("/org/chart");
  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Spinner />;
  const roots = data.departments.filter((d: any) => !d.parent_id);
  const unassigned = data.employees.filter((e: any) => !e.department_id);
  const render = (d: any, depth: number): React.ReactNode => {
    const members = data.employees.filter((e: any) => e.department_id === d.id);
    const children = data.departments.filter((c: any) => c.parent_id === d.id);
    return (
      <div key={d.id} className={depth ? "ml-4 sm:ml-8 pl-4 border-l-2 border-ai-100" : ""}>
        <section className="panel mb-3">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{d.name}</h3>
              <div className="text-xs text-ink-3">{d.head_name ? `部門長 ${d.head_name}` : "部門長 未設定"} ・ {members.length}名</div>
            </div>
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line-2">
            {members.map((e: any) => (
              <li key={e.id} className="bg-white">
                <Link to={`/employees/${e.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-ai-50">
                  <Avatar name={e.last_name + e.first_name} size={30} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{e.last_name} {e.first_name}</div>
                    <div className="text-[11px] text-ink-3 truncate">{e.position_name ?? "-"}{e.employment_type !== "full_time" ? ` ・ ${EMPLOYMENT_JA[e.employment_type]}` : ""}</div>
                  </div>
                </Link>
              </li>
            ))}
            {members.length === 0 && <li className="bg-white px-4 py-3 text-xs text-ink-3">所属メンバーはいません</li>}
          </ul>
        </section>
        {children.map((c: any) => render(c, depth + 1))}
      </div>
    );
  };
  return (
    <div>
      {roots.map((d: any) => render(d, 0))}
      {unassigned.length > 0 && (
        <section className="panel mb-3">
          <div className="panel-head"><h3 className="panel-title">未所属</h3></div>
          <ul className="px-4 py-2 text-[13px]">
            {unassigned.map((e: any) => <li key={e.id} className="py-1"><Link to={`/employees/${e.id}`} className="link">{e.last_name} {e.first_name}</Link></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Directory() {
  const { data, error, loading } = useQuery<any[]>("/employees");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const k = q.replace(/\s/g, "");
    return (data ?? []).filter((e) => !k || `${e.last_name}${e.first_name}${e.last_name_kana}${e.first_name_kana}${e.department_name ?? ""}${e.code}`.includes(k));
  }, [data, q]);
  if (error) return <ErrorBox message={error} />;
  if (loading || !data) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="size-4 absolute left-2.5 top-2.5 text-ink-3" />
        <Input className="pl-8" placeholder="名前・部署で検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="社員を検索" />
      </div>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>氏名</th>
              <th>部署</th>
              <th>役職</th>
              <th>メール</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/employees/${e.id}`} className="flex items-center gap-2 link">
                    <Avatar name={e.last_name + e.first_name} size={24} />
                    {e.last_name} {e.first_name}
                  </Link>
                </td>
                <td>{e.department_name ?? "-"}</td>
                <td>{e.position_name ?? "-"}</td>
                <td className="text-ink-2">{e.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
