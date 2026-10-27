import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useLookups } from "../lib/lookups";
import { EMP_STATUS_JA, EMPLOYMENT_JA, GENDER_JA, yen } from "../lib/format";
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from "./ui";
import { useToast } from "./toast";
import { HEALTH_GRADES, standardFromRemuneration } from "../../shared/calc/insurance";

export const BLANK_EMPLOYEE = {
  code: "", last_name: "", first_name: "", last_name_kana: "", first_name_kana: "", email: "", phone: "", birth_date: "", gender: "",
  hire_date: "", status: "", employment_type: "full_time", department_id: "", position_id: "", manager_id: "", work_pattern_id: "",
  weekly_work_days: 5, weekly_work_hours: 40, postal_code: "", address: "", emergency_name: "", emergency_relation: "", emergency_phone: "",
  bank_name: "", bank_branch: "", bank_account_type: "普通", bank_account_number: "", bank_account_holder: "", note: "",
};

type Section = "basic" | "employment" | "contact" | "bank";

/** 従業員情報の編集フォーム。sections で表示する区分を選ぶ (本人編集は contact / bank だけ) */
export function EmployeeFields({ v, set, sections, selfId }: { v: any; set: (patch: any) => void; sections: Section[]; selfId?: number }) {
  const lookups = useLookups();
  const inp = (k: string, type = "text") => <Input type={type} value={v[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} />;
  return (
    <div className="space-y-6">
      {sections.includes("basic") && (
        <fieldset>
          <legend className="text-[13px] font-semibold mb-3">基本情報</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="社員番号" required>{inp("code")}</Field>
            <Field label="姓" required>{inp("last_name")}</Field>
            <Field label="名" required>{inp("first_name")}</Field>
            <Field label="性別">
              <Select value={v.gender ?? ""} onChange={(e) => set({ gender: e.target.value })} options={Object.entries(GENDER_JA).filter(([k]) => k).map(([value, label]) => ({ value, label }))} placeholder="未設定" />
            </Field>
            <Field label="姓 (フリガナ)">{inp("last_name_kana")}</Field>
            <Field label="名 (フリガナ)">{inp("first_name_kana")}</Field>
            <Field label="生年月日">{inp("birth_date", "date")}</Field>
            <Field label="メールアドレス">{inp("email", "email")}</Field>
          </div>
        </fieldset>
      )}
      {sections.includes("employment") && (
        <fieldset>
          <legend className="text-[13px] font-semibold mb-3">所属・雇用</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="入社日" required>{inp("hire_date", "date")}</Field>
            <Field label="雇用形態">
              <Select value={v.employment_type} onChange={(e) => set({ employment_type: e.target.value })} options={Object.entries(EMPLOYMENT_JA).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="在籍状況">
              <Select value={v.status ?? ""} onChange={(e) => set({ status: e.target.value })} placeholder="自動 (入社日から判定)" options={Object.entries(EMP_STATUS_JA).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="勤務パターン">
              <Select value={v.work_pattern_id ?? ""} onChange={(e) => set({ work_pattern_id: e.target.value })} placeholder="既定" options={(lookups?.workPatterns ?? []).map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="部署">
              <Select value={v.department_id ?? ""} onChange={(e) => set({ department_id: e.target.value })} placeholder="未所属" options={(lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
            </Field>
            <Field label="役職">
              <Select value={v.position_id ?? ""} onChange={(e) => set({ position_id: e.target.value })} placeholder="なし" options={(lookups?.positions ?? []).map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="上長 (承認者)">
              <Select
                value={v.manager_id ?? ""}
                onChange={(e) => set({ manager_id: e.target.value })}
                placeholder="なし"
                options={(lookups?.employees ?? []).filter((e) => e.id !== selfId).map((e) => ({ value: e.id, label: `${e.last_name} ${e.first_name} (${e.code})` }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="週の所定日数">
                <Input type="number" step="0.5" min={0} max={7} value={v.weekly_work_days ?? 5} onChange={(e) => set({ weekly_work_days: e.target.value })} />
              </Field>
              <Field label="週の所定時間">
                <Input type="number" step="0.5" min={0} value={v.weekly_work_hours ?? 40} onChange={(e) => set({ weekly_work_hours: e.target.value })} />
              </Field>
            </div>
          </div>
          <p className="text-[11px] text-ink-3 mt-2">週の所定日数・時間は有給休暇の付与日数 (比例付与) の判定に使います。</p>
        </fieldset>
      )}
      {sections.includes("contact") && (
        <fieldset>
          <legend className="text-[13px] font-semibold mb-3">連絡先</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {!sections.includes("basic") && (
              <>
                <Field label="姓 (フリガナ)">{inp("last_name_kana")}</Field>
                <Field label="名 (フリガナ)">{inp("first_name_kana")}</Field>
              </>
            )}
            <Field label="電話番号">{inp("phone", "tel")}</Field>
            <Field label="郵便番号">{inp("postal_code")}</Field>
            <Field label="住所" className="sm:col-span-2">{inp("address")}</Field>
            <Field label="緊急連絡先 氏名">{inp("emergency_name")}</Field>
            <Field label="続柄">{inp("emergency_relation")}</Field>
            <Field label="緊急連絡先 電話番号">{inp("emergency_phone", "tel")}</Field>
          </div>
        </fieldset>
      )}
      {sections.includes("bank") && (
        <fieldset>
          <legend className="text-[13px] font-semibold mb-3">給与振込口座</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="銀行名">{inp("bank_name")}</Field>
            <Field label="支店名">{inp("bank_branch")}</Field>
            <Field label="預金種目">
              <Select value={v.bank_account_type ?? "普通"} onChange={(e) => set({ bank_account_type: e.target.value })} options={["普通", "当座", "貯蓄"].map((x) => ({ value: x, label: x }))} />
            </Field>
            <Field label="口座番号">{inp("bank_account_number")}</Field>
            <Field label="口座名義 (カナ)">{inp("bank_account_holder")}</Field>
          </div>
        </fieldset>
      )}
      {sections.includes("basic") && (
        <Field label="社内メモ (管理者のみ閲覧)">
          <Textarea rows={2} value={v.note ?? ""} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

export const DISABILITY_JA: Record<string, string> = { none: "なし", general: "一般の障害者", special: "特別障害者", special_cohabiting: "同居特別障害者" };

export function DependentsEditor({ employeeId, dependents, onChange, readOnly }: { employeeId: number; dependents: any[]; onChange: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const save = async () => {
    try {
      const body = { ...edit, annual_income: Number(edit.annual_income || 0) };
      if (edit.id) await api.put(`/dependents/${edit.id}`, body);
      else await api.post(`/employees/${employeeId}/dependents`, body);
      toast.ok("扶養家族を保存しました");
      setEdit(null);
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th>氏名</th>
              <th>続柄</th>
              <th>生年月日</th>
              <th className="r">年間所得見込</th>
              <th>源泉控除</th>
              <th>健保扶養</th>
              <th>障害者</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {dependents.length === 0 && (
              <tr><td colSpan={8} className="text-center text-ink-3 py-6">扶養家族は登録されていません</td></tr>
            )}
            {dependents.map((d) => (
              <tr key={d.id}>
                <td>{d.name}{d.is_spouse ? <span className="pill bg-ai-50 text-ai-800 ml-1.5">配偶者</span> : null}</td>
                <td>{d.relationship}</td>
                <td className="num">{d.birth_date?.replaceAll("-", "/") ?? "-"}</td>
                <td className="r num">{yen(d.annual_income)}</td>
                <td>{d.withholding_target ? "対象" : "-"}</td>
                <td>{d.health_dependent ? "対象" : "-"}</td>
                <td>{DISABILITY_JA[d.disability] ?? "なし"}</td>
                {!readOnly && (
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...d, is_spouse: !!d.is_spouse, withholding_target: !!d.withholding_target, health_dependent: !!d.health_dependent })}>編集</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`${d.name} を削除しますか？`)) { await api.del(`/dependents/${d.id}`); onChange(); } }} aria-label="削除">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button className="mt-3" size="sm" onClick={() => setEdit({ name: "", name_kana: "", relationship: "", birth_date: "", annual_income: 0, is_spouse: false, withholding_target: true, health_dependent: true, disability: "none" })}>
          <Plus className="size-3.5" />扶養家族を追加
        </Button>
      )}
      <p className="text-[11px] text-ink-3 mt-2">「源泉控除」が対象の人数が、毎月の源泉所得税の扶養親族等の数になります (16歳未満の子は対象外)。</p>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "扶養家族を編集" : "扶養家族を追加"} footer={<><Button onClick={() => setEdit(null)}>キャンセル</Button><Button variant="primary" onClick={save}>保存</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="氏名" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="フリガナ"><Input value={edit.name_kana ?? ""} onChange={(e) => setEdit({ ...edit, name_kana: e.target.value })} /></Field>
            <Field label="続柄" required><Input value={edit.relationship} onChange={(e) => setEdit({ ...edit, relationship: e.target.value })} placeholder="例: 配偶者、長男" /></Field>
            <Field label="生年月日"><Input type="date" value={edit.birth_date ?? ""} onChange={(e) => setEdit({ ...edit, birth_date: e.target.value })} /></Field>
            <Field label="年間所得の見込額 (円)"><Input type="number" min={0} value={edit.annual_income} onChange={(e) => setEdit({ ...edit, annual_income: e.target.value })} /></Field>
            <Field label="障害者区分">
              <Select value={edit.disability} onChange={(e) => setEdit({ ...edit, disability: e.target.value })} options={Object.entries(DISABILITY_JA).map(([value, label]) => ({ value, label }))} />
            </Field>
          </div>
          <div className="mt-4 space-y-2">
            <Checkbox label="配偶者" checked={edit.is_spouse} onChange={(x) => setEdit({ ...edit, is_spouse: x })} />
            <Checkbox label="源泉控除対象 (源泉控除対象配偶者・親族)" checked={edit.withholding_target} onChange={(x) => setEdit({ ...edit, withholding_target: x })} />
            <Checkbox label="健康保険の被扶養者" checked={edit.health_dependent} onChange={(x) => setEdit({ ...edit, health_dependent: x })} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SalarySettingForm({ employeeId, initial, dependentsCount, onSaved }: { employeeId: number; initial: any | null; dependentsCount: number; onSaved?: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<any>(
    initial
      ? { ...initial, health_insurance: !!initial.health_insurance, pension_insurance: !!initial.pension_insurance, employment_insurance: !!initial.employment_insurance, absence_deduction: !!initial.absence_deduction }
      : {
          pay_type: "monthly", base_salary: 0, hourly_wage: 0, daily_wage: 0, allowances: [], commute_allowance: 0, other_deductions: [],
          standard_monthly_remuneration: 0, health_insurance: true, pension_insurance: true, employment_insurance: true, care_insurance: "auto",
          tax_column: "kou", tax_dependents_adjust: 0, resident_tax_june: 0, resident_tax_monthly: 0, absence_deduction: true,
        },
  );
  const [busy, setBusy] = useState(false);
  const set = (patch: any) => setV({ ...v, ...patch });
  const num = (k: string) => <Input type="number" min={0} inputMode="numeric" value={v[k] ?? 0} onChange={(e) => set({ [k]: e.target.value })} />;
  const monthlyEstimate =
    (v.pay_type === "monthly" ? Number(v.base_salary) : v.pay_type === "daily" ? Number(v.daily_wage) * 21 : Number(v.hourly_wage) * 160) +
    v.allowances.reduce((t: number, a: any) => t + Number(a.amount || 0), 0) +
    Number(v.commute_allowance || 0);
  const est = standardFromRemuneration(monthlyEstimate);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/payroll/settings/${employeeId}`, v);
      toast.ok("給与設定を保存しました");
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-[13px] font-semibold mb-3">支給</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="給与形態">
            <Select value={v.pay_type} onChange={(e) => set({ pay_type: e.target.value })} options={[{ value: "monthly", label: "月給" }, { value: "daily", label: "日給" }, { value: "hourly", label: "時給" }]} />
          </Field>
          {v.pay_type === "monthly" && <Field label="基本給 (月額)">{num("base_salary")}</Field>}
          {v.pay_type === "daily" && <Field label="日給">{num("daily_wage")}</Field>}
          {v.pay_type === "hourly" && <Field label="時給">{num("hourly_wage")}</Field>}
          <Field label="通勤手当 (月額)" hint="月15万円までは非課税で計算します">{num("commute_allowance")}</Field>
          {v.pay_type === "monthly" && (
            <div className="self-end pb-1">
              <Checkbox label="欠勤・遅刻早退を控除する" checked={v.absence_deduction} onChange={(x) => set({ absence_deduction: x })} />
            </div>
          )}
        </div>
        <div className="mt-4">
          <div className="label">手当</div>
          <div className="space-y-2">
            {v.allowances.map((a: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="w-40" placeholder="手当名" value={a.name} onChange={(e) => set({ allowances: v.allowances.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Input className="w-32" type="number" placeholder="金額" value={a.amount} onChange={(e) => set({ allowances: v.allowances.map((x: any, j: number) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                <Checkbox label="課税" checked={a.taxable !== false} onChange={(x) => set({ allowances: v.allowances.map((y: any, j: number) => (j === i ? { ...y, taxable: x } : y)) })} />
                <Checkbox label="残業単価に含める" checked={a.overtime_base !== false} onChange={(x) => set({ allowances: v.allowances.map((y: any, j: number) => (j === i ? { ...y, overtime_base: x } : y)) })} />
                <Button size="sm" variant="ghost" onClick={() => set({ allowances: v.allowances.filter((_: any, j: number) => j !== i) })} aria-label="手当を削除"><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => set({ allowances: [...v.allowances, { name: "", amount: 0, taxable: true, overtime_base: true }] })}><Plus className="size-3.5" />手当を追加</Button>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold mb-3">社会保険・雇用保険</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="標準報酬月額" hint={`固定的賃金の月額 約${yen(monthlyEstimate)}円 → ${est.healthGrade}等級 ${yen(est.healthStandard)}円`}>
            <div className="flex gap-1.5">
              <Select
                value={v.standard_monthly_remuneration || ""}
                onChange={(e) => set({ standard_monthly_remuneration: Number(e.target.value) })}
                placeholder="未設定"
                options={HEALTH_GRADES.map(([g, std]) => ({ value: std, label: `${g}等級 ${std.toLocaleString()}円` }))}
              />
              <Button size="sm" className="h-9" onClick={() => set({ standard_monthly_remuneration: est.healthStandard })}>算定</Button>
            </div>
          </Field>
          <Field label="介護保険">
            <Select value={v.care_insurance} onChange={(e) => set({ care_insurance: e.target.value })} options={[{ value: "auto", label: "年齢で自動判定 (40〜64歳)" }, { value: "yes", label: "常に徴収" }, { value: "no", label: "徴収しない" }]} />
          </Field>
          <div className="space-y-2 self-end pb-1 sm:col-span-2 flex flex-wrap gap-x-5">
            <Checkbox label="健康保険" checked={v.health_insurance} onChange={(x) => set({ health_insurance: x })} />
            <Checkbox label="厚生年金" checked={v.pension_insurance} onChange={(x) => set({ pension_insurance: x })} />
            <Checkbox label="雇用保険" checked={v.employment_insurance} onChange={(x) => set({ employment_insurance: x })} />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold mb-3">税金</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="源泉所得税の税額表">
            <Select value={v.tax_column} onChange={(e) => set({ tax_column: e.target.value })} options={[{ value: "kou", label: "甲欄 (扶養控除等申告書あり)" }, { value: "otsu", label: "乙欄" }, { value: "none", label: "徴収しない" }]} />
          </Field>
          <Field label="扶養親族等の加算人数" hint={`扶養家族タブから自動で ${dependentsCount}人 を数えます。本人や家族が障害者・ひとり親・勤労学生に該当する場合の加算分を入力 (合計 ${dependentsCount + (Number(v.tax_dependents_adjust) || 0)}人)`}>
            <Input type="number" value={v.tax_dependents_adjust} onChange={(e) => set({ tax_dependents_adjust: e.target.value })} />
          </Field>
          <Field label="住民税 6月分">{num("resident_tax_june")}</Field>
          <Field label="住民税 7月〜翌5月 (月額)">{num("resident_tax_monthly")}</Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold mb-3">その他の控除 (毎月)</legend>
        <div className="space-y-2">
          {v.other_deductions.map((d: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="w-48" placeholder="項目名 (例: 社宅費)" value={d.name} onChange={(e) => set({ other_deductions: v.other_deductions.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input className="w-32" type="number" placeholder="金額" value={d.amount} onChange={(e) => set({ other_deductions: v.other_deductions.map((x: any, j: number) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
              <Button size="sm" variant="ghost" onClick={() => set({ other_deductions: v.other_deductions.filter((_: any, j: number) => j !== i) })} aria-label="控除を削除"><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set({ other_deductions: [...v.other_deductions, { name: "", amount: 0 }] })}><Plus className="size-3.5" />控除を追加</Button>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={save}>給与設定を保存</Button>
      </div>
    </div>
  );
}
