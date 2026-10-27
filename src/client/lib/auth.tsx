import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";

export interface Me {
  user: { userId: number; employeeId: number; role: "admin" | "manager" | "employee"; email: string; name: string; mustChangePassword: boolean };
  company: { name: string; appName: string; closingDay: number } | null;
  unreadNotifications: number;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<Me | { user: null }>("/auth/me");
      setMe(r.user ? (r as Me) : null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setMe(null);
  }, []);
  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setMe(null));
  }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function useRole() {
  const { me } = useAuth();
  const role = me?.user.role ?? "employee";
  return { role, isAdmin: role === "admin", isManager: role === "manager" || role === "admin", employeeId: me?.user.employeeId ?? 0 };
}
