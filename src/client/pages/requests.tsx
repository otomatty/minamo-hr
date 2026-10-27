import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Check, CornerUpLeft, FileText, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useQuery } from "../lib/hooks";
import { useLookups } from "../lib/lookups";
import { dateTimeJa, KIND_JA, mdW, REQ_STATUS, UNIT_JA, yen } from "../lib/format";
import { Avatar, Button, DefList, Empty, ErrorBox, Field, Input, Modal, PageHeader, Panel, Pill, Select, Spinner, Tabs, Textarea } from "../components/ui";
import { useToast } from "../components/toast";

// ───────────── 一覧 ─────────────
export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "active";
  const status = tab === "active" ? "draft,pending,returned" : tab === "done" ? "approved,rejected,withdrawn,canceled" : "";
  const { data, error, loading, reload } = useQuery<any[]>(`/requests?scope=mine${status ? `&status=${status}` : ""}`);
  return (
    <div>
      <PageHeader title="申請" sub="あなたが出した申請の一覧です。" actions={<Link to="/requests/new" className="btn btn-primary"><Plus className="size-4" />新しく申請する</Link>} />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { key: "active", label: "進行中" },
          { key: "done", label: "完了" },
          { key: "all", label: "すべて" },
        ]}
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : <RequestTable rows={data ?? []} empty="該当する申請はありません" />}
    </div>
  );
}

export function RequestTable({ rows, empty, showApplicant, selectable, selected, onSelect }: { rows: any[]; empty: string; showApplicant?: boolean; selectable?: boolean; selected?: Set<number>; onSelect?: (s: Set<number>) => void }) {
  if (rows.length === 0) return <div className="panel"><Empty title={empty} /></div>;
  return (
    <div className="panel overflow-x-auto">
      <table className="table min-w-[720px]">
        <thead>
          <tr>
            {selectable && (
              <th className="w-8">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  className="accent-ai-800"
                  checked={rows.length > 0 && rows.every((r) => selected?.has(r.id))}
                  onChange={(e) => onSelect?.(new Set(e.target.checked ? rows.map((r) => r.id) : []))}
                />
              </th>
            )}
            <th>種類</th>
            <th>件名</th>
            {showApplicant && <th>申請者</th>}
            <th className="r">金額</th>
            <th>申請日時</th>
            <th>状況</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${r.title} を選択`}
                    className="accent-ai-800"
                    checked={selected?.has(r.id) ?? false}
                    onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(r.id);
                      else s.delete(r.id);
                      onSelect?.(s);
                    }}
                  />
                </td>
              )}
              <td className="text-ink-2 whitespace-nowrap">{r.kind === "general" ? r.form_name : KIND_JA[r.kind]}</td>
              <td>
                <Link to={`/requests/${r.id}`} className="link font-medium">{r.title}</Link>
              </td>
              {showApplicant && (
                <td className="whitespace-nowrap">
                  {r.applicant_name}
                  <div className="text-[11px] text-ink-3">{r.department_name}</div>
                </td>
              )}
              <td className="r num">{r.amount ? yen(r.amount) : ""}</td>
              <td className="num text-ink-2 whitespace-nowrap">{r.submitted_at ? dateTimeJa(r.submitted_at) : "未提出"}</td>
              <td>
                <Pill cls={REQ_STATUS[r.status].cls}>{REQ_STATUS[r.status].label}</Pill>
                {r.kind === "expense" && r.status === "approved" && (
                  <div className="text-[11px] text-ink-3 mt-0.5">{r.paid_at ? `支払済 (${r.paid_via === "payroll" ? "給与" : "振込"})` : r.settlement === "payroll" ? "給与で精算予定" : "振込待ち"}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── 承認 ─────────────
export function ApprovalsPage() {
  const { isManager } = useRole();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "pending";
  const url = tab === "pending" ? "/requests?scope=approvals" : tab === "done" ? "/requests?scope=approved_by_me" : "/requests?scope=all";
  const { data, error, loading, reload } = useQuery<any[]>(url);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setSelected(new Set()), [tab]);
  const bulk = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; errors: Array<{ id: number; message: string }> }>("/requests/bulk-approve", { ids: [...selected] });
      if (r.errors.length) toast.error(`${r.errors.length}件は承認できませんでした: ${r.errors[0].message}`);
      else toast.ok(`${selected.size}件を承認しました`);
      setSelected(new Set());
      reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title="承認"
        sub="あなたが承認者になっている申請です。"
        actions={tab === "pending" && selected.size > 0 && (
          <Button variant="ok" loading={busy} onClick={bulk}>
            <Check className="size-4" />選択した {selected.size}件 を承認
          </Button>
        )}
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { key: "pending", label: "承認待ち" },
          { key: "done", label: "対応済み" },
          ...(isManager ? [{ key: "all", label: "部下・全社の申請" }] : []),
        ]}
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Spinner />
      ) : (
        <RequestTable rows={data ?? []} empty={tab === "pending" ? "承認待ちの申請はありません" : "該当する申請はありません"} showApplicant selectable={tab === "pending"} selected={selected} onSelect={setSelected} />
      )}
    </div>
  );
}

// ───────────── 新規・編集 ─────────────
export function NewRequestPage() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const kind = params.get("kind");
  const formId = params.get("form");
  const form = lookups?.forms.find((f) => (formId ? String(f.id) === formId : kind && kind !== "general" ? f.kind === kind : false));
  useEffect(() => {
    if (form?.kind === "leave") nav("/leave", { replace: true });
  }, [form, nav]);
  if (!lookups) return <Spinner />;
  if (!form) {
    return (
      <div>
        <PageHeader title="新しく申請する" sub="申請の種類を選んでください。" back={<Link to="/requests" className="link">← 申請一覧</Link>} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lookups.forms.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => (f.kind === "leave" ? nav("/leave") : setParams({ form: String(f.id) }))}
              className="panel text-left p-4 hover:border-ai-200 hover:bg-ai-50/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-asagi-600" />
                <span className="font-semibold text-[14px]">{f.name}</span>
              </div>
              <p className="text-xs text-ink-3 mt-1.5">{f.description}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title={form.name} sub={form.description} back={<Link to="/requests/new" className="link">← 申請の種類を選び直す</Link>} />
      <RequestForm form={form} />
    </div>
  );
}

export function EditRequestPage() {
  const { id } = useParams();
  const lookups = useLookups();
  const { data, error } = useQuery<any>(`/requests/${id}`);
  if (error) return <ErrorBox message={error} />;
  if (!data || !lookups) return <Spinner />;
  const form = lookups.forms.find((f) => f.id === data.form_id) ?? { id: data.form_id, kind: data.kind, name: data.form_name, description: "" };
  return (
    <div>
      <PageHeader title={`${form.name}を修正`} back={<Link to={`/requests/${id}`} className="link">← 申請に戻る</Link>} />
      <RequestForm form={form} existing={data} />
    </div>
  );
}

function RequestForm({ form, existing }: { form: { id: number; kind: string; name: string }; existing?: any }) {
  if (form.kind === "punch_fix") return <PunchFixForm form={form} existing={existing} />;
  if (form.kind === "overtime") return <OvertimeForm form={form} existing={existing} />;
  if (form.kind === "expense") return <ExpenseForm form={form} existing={existing} />;
  if (form.kind === "leave") return <p className="text-[13px]">休暇の申請は<Link to="/leave" className="link">休暇画面</Link>から行ってください。</p>;
  return <GeneralForm form={form} existing={existing} />;
}

function useSubmit(form: { id: number }, existing?: any) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const save = async (body: { payload: any; items?: any[] }, submit: boolean) => {
    setBusy(submit ? "submit" : "draft");
    try {
      const res = existing
        ? await api.put<{ id: number }>(`/requests/${existing.id}`, { ...body, submit })
        : await api.post<{ id: number }>("/requests", { formId: form.id, ...body, submit });
      toast.ok(submit ? "申請しました" : "下書きを保存しました");
      nav(`/requests/${res.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, save };
}

function FormActions({ busy, onDraft, onSubmit, disabled }: { busy: "draft" | "submit" | null; onDraft: () => void; onSubmit: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 mt-5">
      <Button loading={busy === "draft"} onClick={onDraft} disabled={disabled}>下書き保存</Button>
      <Button variant="primary" loading={busy === "submit"} onClick={onSubmit} disabled={disabled}>申請する</Button>
    </div>
  );
}

function PunchFixForm({ form, existing }: { form: any; existing?: any }) {
  const p = existing?.payload ?? {};
  const [v, setV] = useState({ date: p.date ?? "", clock_in: p.clock_in ?? "09:00", clock_out: p.clock_out ?? "18:00", clock_out_next_day: !!p.clock_out_next_day, reason: p.reason ?? "" });
  const [breaks, setBreaks] = useState<Array<{ start: string; end: string }>>(p.breaks ?? [{ start: "12:00", end: "13:00" }]);
  const { busy, save } = useSubmit(form, existing);
  const body = () => ({ payload: { ...v, breaks: breaks.filter((b) => b.start && b.end) } });
  return (
    <Panel className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="対象日" required><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="出勤" required><Input type="time" value={v.clock_in} onChange={(e) => setV({ ...v, clock_in: e.target.value })} /></Field>
        <Field label="退勤" required>
          <Input type="time" value={v.clock_out} onChange={(e) => setV({ ...v, clock_out: e.target.value })} />
          <label className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
            <input type="checkbox" className="accent-ai-800" checked={v.clock_out_next_day} onChange={(e) => setV({ ...v, clock_out_next_day: e.target.checked })} />翌日の時刻
          </label>
        </Field>
      </div>
      <div className="mt-4">
        <div className="label">休憩</div>
        {breaks.map((b, i) => (
          <div key={i} className="flex items-center gap-2 mb-2 max-w-sm">
            <Input type="time" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label="休憩開始" />
            <span>〜</span>
            <Input type="time" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label="休憩終了" />
            <Button size="sm" variant="ghost" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))} aria-label="削除"><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setBreaks([...breaks, { start: "", end: "" }])}><Plus className="size-3.5" />休憩を追加</Button>
      </div>
      <Field label="修正理由" required className="mt-4"><Textarea rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <FormActions busy={busy} onDraft={() => save(body(), false)} onSubmit={() => save(body(), true)} />
    </Panel>
  );
}

function OvertimeForm({ form, existing }: { form: any; existing?: any }) {
  const p = existing?.payload ?? {};
  const [v, setV] = useState({ date: p.date ?? "", end: p.end ?? "20:00", end_next_day: !!p.end_next_day, reason: p.reason ?? "" });
  const { busy, save } = useSubmit(form, existing);
  return (
    <Panel className="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="対象日" required><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="終了予定時刻" required>
          <Input type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
          <label className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
            <input type="checkbox" className="accent-ai-800" checked={v.end_next_day} onChange={(e) => setV({ ...v, end_next_day: e.target.checked })} />翌日の時刻
          </label>
        </Field>
      </div>
      <Field label="業務内容・理由" required className="mt-4"><Textarea rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <FormActions busy={busy} onDraft={() => save({ payload: v }, false)} onSubmit={() => save({ payload: v }, true)} />
    </Panel>
  );
}

function GeneralForm({ form, existing }: { form: any; existing?: any }) {
  const forms = useQuery<any[]>("/forms");
  const def = forms.data?.find((f) => f.id === form.id);
  const [v, setV] = useState<Record<string, any>>(existing?.payload ?? {});
  const { busy, save } = useSubmit(form, existing);
  if (!def) return <Spinner />;
  return (
    <Panel className="max-w-2xl">
      <div className="space-y-4">
        <Field label="件名" hint={`空欄の場合は「${def.name}」になります`}>
          <Input value={v.title ?? ""} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        {def.fields.map((f: any) => (
          <Field key={f.key} label={f.label} required={f.required}>
            {f.type === "textarea" ? (
              <Textarea rows={4} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            ) : f.type === "select" ? (
              <Select value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} placeholder="選択してください" options={(f.options ?? []).map((o: string) => ({ value: o, label: o }))} />
            ) : (
              <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
      <FormActions busy={busy} onDraft={() => save({ payload: v }, false)} onSubmit={() => save({ payload: v }, true)} />
    </Panel>
  );
}

interface ExpenseItem {
  used_on: string;
  category_id: string;
  description: string;
  payee: string;
  amount: string;
  tax_rate: string;
  invoice_number: string;
  route_from: string;
  route_to: string;
  round_trip: boolean;
  receipt_key: string | null;
  receipt_name: string | null;
}

const emptyItem = (): ExpenseItem => ({ used_on: "", category_id: "", description: "", payee: "", amount: "", tax_rate: "10", invoice_number: "", route_from: "", route_to: "", round_trip: false, receipt_key: null, receipt_name: null });

function ExpenseForm({ form, existing }: { form: any; existing?: any }) {
  const lookups = useLookups();
  const toast = useToast();
  const [title, setTitle] = useState(existing?.payload?.title ?? existing?.title ?? "");
  const [settlement, setSettlement] = useState(existing?.payload?.settlement ?? "payroll");
  const [items, setItems] = useState<ExpenseItem[]>(
    existing?.items?.length
      ? existing.items.map((i: any) => ({ ...emptyItem(), ...i, category_id: String(i.category_id ?? ""), amount: String(i.amount), tax_rate: String(i.tax_rate), invoice_number: i.invoice_number ?? "", route_from: i.route_from ?? "", route_to: i.route_to ?? "", round_trip: !!i.round_trip }))
      : [emptyItem()],
  );
  const [uploading, setUploading] = useState<number | null>(null);
  const { busy, save } = useSubmit(form, existing);
  const total = useMemo(() => items.reduce((t, i) => t + (Number(i.amount) || 0), 0), [items]);
  const set = (i: number, patch: Partial<ExpenseItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const upload = async (i: number, file: File) => {
    setUploading(i);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.upload<{ key: string; name: string }>("/receipts", fd);
      set(i, { receipt_key: r.key, receipt_name: r.name });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(null);
    }
  };

  const body = () => ({
    payload: { title, settlement },
    items: items.map((i) => ({ ...i, category_id: Number(i.category_id), amount: Number(i.amount), tax_rate: Number(i.tax_rate), invoice_number: i.invoice_number.trim() || undefined })),
  });

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="件名" hint="空欄の場合は「経費精算 N件」になります"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 10月 交通費" /></Field>
          <Field label="精算方法">
            <Select value={settlement} onChange={(e) => setSettlement(e.target.value)} options={[{ value: "payroll", label: "給与と一緒に支給" }, { value: "transfer", label: "個別に振込" }]} />
          </Field>
        </div>
      </Panel>
      {items.map((it, i) => {
        const cat = lookups?.categories.find((c) => String(c.id) === it.category_id);
        return (
          <Panel key={i} title={`明細 ${i + 1}`} actions={items.length > 1 && <Button size="sm" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-3.5" />削除</Button>}>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="利用日" required><Input type="date" value={it.used_on} onChange={(e) => set(i, { used_on: e.target.value })} /></Field>
              <Field label="経費科目" required>
                <Select value={it.category_id} placeholder="選択" onChange={(e) => { const c = lookups?.categories.find((x) => String(x.id) === e.target.value); set(i, { category_id: e.target.value, tax_rate: String(c?.tax_rate ?? 10) }); }} options={(lookups?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              </Field>
              <Field label="金額 (税込)" required><Input type="number" min={1} inputMode="numeric" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} /></Field>
              <Field label="税率">
                <Select value={it.tax_rate} onChange={(e) => set(i, { tax_rate: e.target.value })} options={[{ value: "10", label: "10%" }, { value: "8", label: "8% (軽減)" }, { value: "0", label: "対象外" }]} />
              </Field>
              <Field label="内容" required className="sm:col-span-2"><Input value={it.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="例: 顧客訪問" /></Field>
              {cat?.is_transport ? (
                <>
                  <Field label="出発" required><Input value={it.route_from} onChange={(e) => set(i, { route_from: e.target.value })} /></Field>
                  <Field label="到着" required>
                    <Input value={it.route_to} onChange={(e) => set(i, { route_to: e.target.value })} />
                    <label className="flex items-center gap-1.5 text-xs text-ink-2 mt-1.5">
                      <input type="checkbox" className="accent-ai-800" checked={it.round_trip} onChange={(e) => set(i, { round_trip: e.target.checked })} />往復
                    </label>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="支払先"><Input value={it.payee} onChange={(e) => set(i, { payee: e.target.value })} /></Field>
                  <Field label="登録番号 (インボイス)" hint="T + 13桁"><Input value={it.invoice_number} onChange={(e) => set(i, { invoice_number: e.target.value.toUpperCase() })} placeholder="T1234567890123" /></Field>
                </>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[13px]">
              {it.receipt_key ? (
                <>
                  <a href={`/api/receipts/${it.receipt_key}`} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1"><Paperclip className="size-3.5" />{it.receipt_name ?? "領収書"}</a>
                  <Button size="sm" variant="ghost" onClick={() => set(i, { receipt_key: null, receipt_name: null })}><X className="size-3.5" />外す</Button>
                </>
              ) : (
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  <Upload className="size-3.5" />
                  {uploading === i ? "アップロード中..." : "領収書を添付"}
                  <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(i, e.target.files[0])} />
                </label>
              )}
              {cat?.requires_receipt ? <span className="text-xs text-ink-3">この科目は領収書が必要です</span> : null}
            </div>
          </Panel>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setItems([...items, emptyItem()])}><Plus className="size-4" />明細を追加</Button>
        <div className="text-[14px]">合計 <span className="text-xl font-semibold num">{yen(total)}</span> 円</div>
      </div>
      <FormActions busy={busy} onDraft={() => save(body(), false)} onSubmit={() => save(body(), true)} disabled={uploading !== null} />
    </div>
  );
}

// ───────────── 詳細 ─────────────
export function RequestDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: r, error, loading, reload } = useQuery<any>(`/requests/${id}`);
  const [action, setAction] = useState<null | "approve" | "reject" | "return" | "cancel">(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [newComment, setNewComment] = useState("");

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !r) return <Spinner />;
  if (!r) return null;

  const doAction = async () => {
    setBusy(true);
    try {
      await api.post(`/requests/${id}/${action}`, action === "cancel" ? { reason: comment } : { comment });
      toast.ok({ approve: "承認しました", reject: "却下しました", return: "差し戻しました", cancel: "取り消しました" }[action!]);
      setAction(null);
      setComment("");
      reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const simple = async (path: string, msg: string) => {
    try {
      await api.post(path);
      toast.ok(msg);
      reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const st = REQ_STATUS[r.status];
  return (
    <div>
      <PageHeader
        back={<button type="button" className="link" onClick={() => nav(-1)}>← 戻る</button>}
        title={<span className="flex items-center gap-3 flex-wrap">{r.title}<Pill cls={st.cls}>{st.label}</Pill></span>}
        sub={`${r.form_name} ・ 申請番号 ${r.id}`}
        actions={
          <>
            {r.canEdit && <Link to={`/requests/${r.id}/edit`} className="btn btn-secondary">内容を修正</Link>}
            {r.canEdit && <Button variant="primary" onClick={() => simple(`/requests/${r.id}/submit`, "申請しました")}>{r.status === "returned" ? "再申請する" : "申請する"}</Button>}
            {r.canWithdraw && r.status !== "draft" && <Button variant="danger" onClick={() => confirm("この申請を取り下げますか？") && simple(`/requests/${r.id}/withdraw`, "取り下げました")}>取り下げる</Button>}
            {r.status === "draft" && r.canEdit && (
              <Button variant="danger" onClick={async () => { if (confirm("下書きを削除しますか？")) { await api.del(`/requests/${r.id}`); nav("/requests"); } }}>削除</Button>
            )}
            {r.canCancel && <Button variant="danger" onClick={() => setAction("cancel")}>承認を取り消す</Button>}
          </>
        }
      />

      {r.canAct && (
        <div className="panel border-ai-200 bg-ai-50 p-4 mb-5 flex flex-wrap items-center gap-3">
          <span className="text-[13px] flex-1 min-w-48">この申請はあなたの承認を待っています。</span>
          <Button variant="ok" onClick={() => setAction("approve")}><Check className="size-4" />承認</Button>
          <Button onClick={() => setAction("return")}><CornerUpLeft className="size-4" />差し戻す</Button>
          <Button variant="danger" onClick={() => setAction("reject")}><X className="size-4" />却下</Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 min-w-0">
          <Panel title="申請内容">
            <DefList items={[["申請者", `${r.applicant_name} (${r.department_name ?? "未所属"})`], ["申請日時", r.submitted_at ? dateTimeJa(r.submitted_at) : "未提出"]]} />
            <div className="border-t border-line-2 my-4" />
            <RequestBody r={r} />
          </Panel>
          <Panel title="コメント" bodyClass="p-0">
            <ul>
              {r.comments.length === 0 && <li className="px-4 py-4 text-[13px] text-ink-3">コメントはありません</li>}
              {r.comments.map((c: any) => (
                <li key={c.id} className="flex gap-3 px-4 py-3 border-b border-line-2">
                  <Avatar name={c.author} size={28} />
                  <div className="min-w-0">
                    <div className="text-xs text-ink-3"><span className="text-ink font-medium">{c.author}</span> ・ {dateTimeJa(c.created_at)}</div>
                    <p className="text-[13px] whitespace-pre-wrap mt-0.5">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="p-4 flex gap-2">
              <Textarea rows={2} value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="コメントを書く" className="min-h-0" />
              <Button
                className="self-end"
                disabled={!newComment.trim()}
                onClick={async () => {
                  try {
                    await api.post(`/requests/${id}/comments`, { body: newComment });
                    setNewComment("");
                    reload();
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}
              >
                送信
              </Button>
            </div>
          </Panel>
        </div>
        <Panel title="承認経路">
          <ol className="relative">
            <li className="flex gap-3 pb-4">
              <StepDot status="approved" />
              <div className="text-[13px]">
                <div className="font-medium">申請</div>
                <div className="text-xs text-ink-3">{r.applicant_name}{r.submitted_at && ` ・ ${dateTimeJa(r.submitted_at)}`}</div>
              </div>
            </li>
            {r.steps.length === 0 && r.status !== "draft" && <li className="text-xs text-ink-3 pl-7 pb-3">承認者がいないため自動で承認されました</li>}
            {r.steps.map((s: any) => (
              <li key={s.id} className="flex gap-3 pb-4">
                <StepDot status={s.status} />
                <div className="text-[13px] min-w-0">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-ink-3">{s.approver_name ?? (s.approver_role === "admin" ? "管理者のいずれか" : "マネージャーのいずれか")}</div>
                  {s.acted_at && (
                    <div className="text-xs mt-0.5">
                      <span className={s.status === "approved" ? "text-ok" : s.status === "rejected" ? "text-ng" : "text-warn"}>{REQ_STATUS[s.status]?.label ?? s.status}</span>
                      <span className="text-ink-3"> ・ {s.actor_name} ・ {dateTimeJa(s.acted_at)}</span>
                    </div>
                  )}
                  {s.comment && <div className="text-xs text-ink-2 mt-0.5 whitespace-pre-wrap">{s.comment}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={{ approve: "承認する", reject: "却下する", return: "差し戻す", cancel: "承認を取り消す" }[action ?? "approve"]}
        footer={
          <>
            <Button onClick={() => setAction(null)}>キャンセル</Button>
            <Button variant={action === "approve" ? "ok" : action === "return" ? "primary" : "danger"} loading={busy} onClick={doAction} disabled={action !== "approve" && !comment.trim()}>
              {{ approve: "承認", reject: "却下", return: "差し戻す", cancel: "取り消す" }[action ?? "approve"]}
            </Button>
          </>
        }
      >
        <Field label={action === "approve" ? "コメント (任意)" : "理由"} required={action !== "approve"}>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {action === "cancel" && r.kind === "leave" && <p className="text-xs text-ink-3 mt-2">休暇の取得記録が削除され、有給休暇の残日数が元に戻ります。</p>}
        {action === "cancel" && r.kind === "punch_fix" && <p className="text-xs text-warn mt-2">勤怠に反映済みの打刻は戻りません。必要に応じて勤怠管理から修正してください。</p>}
      </Modal>
    </div>
  );
}

function StepDot({ status }: { status: string }) {
  const cls =
    status === "approved" ? "bg-ok border-ok" : status === "rejected" ? "bg-ng border-ng" : status === "returned" ? "bg-warn border-warn" : status === "pending" ? "bg-white border-ai-800 ring-4 ring-ai-100" : "bg-white border-line";
  return <span className={`mt-1 size-3.5 shrink-0 rounded-full border-2 ${cls}`} aria-hidden />;
}

function RequestBody({ r }: { r: any }) {
  const p = r.payload;
  if (r.kind === "leave") {
    return (
      <div className="space-y-3">
        <DefList items={[["休暇の種類", r.leave_type?.name], ["理由", p.reason]]} />
        <div className="flex flex-wrap gap-1.5">
          {(p.dates ?? []).map((d: any) => (
            <span key={d.date} className="pill bg-yamabuki-100 text-yamabuki-600 num">{mdW(d.date)} {UNIT_JA[d.unit]}</span>
          ))}
        </div>
      </div>
    );
  }
  if (r.kind === "punch_fix") {
    return (
      <DefList
        items={[
          ["対象日", mdW(p.date)],
          ["出勤", p.clock_in],
          ["退勤", `${p.clock_out_next_day ? "翌" : ""}${p.clock_out}`],
          ["休憩", (p.breaks ?? []).map((b: any) => `${b.start}〜${b.end}`).join(", ") || "なし"],
          ["理由", p.reason],
        ]}
      />
    );
  }
  if (r.kind === "overtime") {
    return <DefList items={[["対象日", mdW(p.date)], ["終了予定", `${p.end_next_day ? "翌" : ""}${p.end}`], ["業務内容・理由", p.reason]]} />;
  }
  if (r.kind === "expense") {
    return (
      <div className="space-y-3">
        <DefList items={[["精算方法", p.settlement === "transfer" ? "個別に振込" : "給与と一緒に支給"], ["支払状況", r.paid_at ? `${r.paid_at} 支払済み` : r.status === "approved" ? "未払い" : "-"]]} />
        <div className="overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>利用日</th>
                <th>科目</th>
                <th>内容</th>
                <th className="r">金額</th>
                <th>領収書</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it: any) => (
                <tr key={it.id}>
                  <td className="num whitespace-nowrap">{mdW(it.used_on)}</td>
                  <td className="whitespace-nowrap">{it.category_name}<div className="text-[11px] text-ink-3">{it.tax_rate}%</div></td>
                  <td>
                    {it.description}
                    <div className="text-[11px] text-ink-3">
                      {it.route_from ? `${it.route_from} → ${it.route_to}${it.round_trip ? " (往復)" : ""}` : it.payee}
                      {it.invoice_number && ` ・ ${it.invoice_number}`}
                    </div>
                  </td>
                  <td className="r num">{yen(it.amount)}</td>
                  <td>{it.receipt_key ? <a className="link inline-flex items-center gap-1" href={`/api/receipts/${it.receipt_key}`} target="_blank" rel="noreferrer"><Paperclip className="size-3.5" />表示</a> : <span className="text-ink-3">-</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="r font-medium">合計</td>
                <td className="r num font-semibold">{yen(r.amount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }
  return (
    <DefList
      items={(r.form_fields ?? []).map((f: any) => [
        f.label,
        f.type === "number" && p[f.key] !== undefined && p[f.key] !== "" ? `${Number(p[f.key]).toLocaleString()}${f.key === "amount" ? " 円" : ""}` : f.type === "textarea" ? <span className="whitespace-pre-wrap">{p[f.key]}</span> : p[f.key],
      ])}
    />
  );
}

