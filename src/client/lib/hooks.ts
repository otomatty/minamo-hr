import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** GET を叩いて結果を保持する。url が null の間は何もしない */
export function useQuery<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(url);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
