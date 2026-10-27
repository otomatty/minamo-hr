import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createAuthClient } from "better-auth/client";
import { api, setUnauthorizedHandler } from "./api";

// Better Auth (/api/auth/*) のクライアント。ログイン・ログアウトだけに使う
const authClient = createAuthClient();

/** Google のログイン画面へ移動する。ログインできなかったときは /?error=... に戻ってくる */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/" });
  if (error) throw new Error(error.message || "Google ログインを開始できませんでした");
}

/** 失敗したら例外を投げる (セッションが残ったままログアウトしたように見せない) */
export async function signOut(): Promise<void> {
  const res = await authClient.signOut().catch(() => null);
  if (!res || res.error) throw new Error("ログアウトできませんでした。通信状況を確認して、もう一度お試しください");
}

export interface Me {
  user: { userId: number; employeeId: number; role: "admin" | "manager" | "employee"; email: string; name: string };
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
      const r = await api.get<Me | { user: null }>("/session");
      setMe(r.user ? (r as Me) : null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await signOut();
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
