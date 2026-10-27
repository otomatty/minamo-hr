import { useEffect, useState } from "react";
import { api } from "./api";

export interface Lookups {
  departments: Array<{ id: number; name: string; parent_id: number | null; head_employee_id: number | null }>;
  positions: Array<{ id: number; name: string; rank: number }>;
  workPatterns: Array<{ id: number; name: string; start_time: string; end_time: string; break_minutes: number; scheduled_minutes: number; is_default: number }>;
  leaveTypes: Array<{ id: number; name: string; code: string; is_paid: number; uses_annual_leave: number; allow_half_day: number }>;
  employees: Array<{ id: number; code: string; last_name: string; first_name: string; department_id: number | null; status: string }>;
  forms: Array<{ id: number; kind: string; name: string; description: string }>;
  categories: Array<{ id: number; name: string; account_code: string; tax_rate: number; requires_receipt: number; is_transport: number }>;
  routes: Array<{ id: number; name: string }>;
}

let cache: Lookups | null = null;
let inflight: Promise<Lookups> | null = null;
const listeners = new Set<(l: Lookups) => void>();

export function invalidateLookups() {
  cache = null;
  inflight = null;
  load();
}

function load() {
  if (!inflight) {
    inflight = api.get<Lookups>("/lookups").then((l) => {
      cache = l;
      listeners.forEach((fn) => fn(l));
      return l;
    });
  }
  return inflight;
}

export function useLookups(): Lookups | null {
  const [l, setL] = useState<Lookups | null>(cache);
  useEffect(() => {
    listeners.add(setL);
    if (!cache) load().catch(() => undefined);
    return () => {
      listeners.delete(setL);
    };
  }, []);
  return l;
}

export function formIdOf(l: Lookups | null, kind: string): number | undefined {
  return l?.forms.find((f) => f.kind === kind)?.id;
}
