import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileText,
  Home,
  LogOut,
  Menu,
  Network,
  Receipt,
  Settings,
  Users,
  Wallet,
  X,
  Palmtree,
  BarChart3,
  UserRound,
} from "lucide-react";
import { useAuth, useRole } from "../lib/auth";
import { api } from "../lib/api";
import { useQuery } from "../lib/hooks";
import { dateTimeJa, ROLE_JA } from "../lib/format";
import { Avatar } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  end?: boolean;
}

function Logo({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 h-14">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#2f7f8f" />
        <path d="M6 13c3-3 6-3 10 0s7 3 10 0" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M6 20c3-3 6-3 10 0s7 3 10 0" stroke="#ddeff2" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".7" />
      </svg>
      <span className="text-white font-semibold text-[15px] tracking-wide">{name}</span>
    </div>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const { isAdmin, isManager } = useRole();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const counts = useQuery<{ approvals: number }>(`/requests/counts?_=${loc.pathname}`);

  useEffect(() => setOpen(false), [loc.pathname]);
  // 承認待ち件数・未読通知は他の人の操作でも変わるので定期的に取り直す
  const { refresh } = useAuth();
  useEffect(() => {
    const onChange = () => {
      counts.reload();
      refresh();
    };
    window.addEventListener("minamo:changed", onChange);
    const t = setInterval(onChange, 60000);
    return () => {
      window.removeEventListener("minamo:changed", onChange);
      clearInterval(t);
    };
  }, [counts.reload, refresh]);

  const personal: NavItem[] = [
    { to: "/", label: "ホーム", icon: <Home className="size-4" />, end: true },
    { to: "/attendance", label: "勤怠", icon: <Clock className="size-4" /> },
    { to: "/leave", label: "休暇", icon: <Palmtree className="size-4" /> },
    { to: "/requests", label: "申請", icon: <FileText className="size-4" /> },
    { to: "/approvals", label: "承認", icon: <ClipboardCheck className="size-4" />, badge: counts.data?.approvals },
    { to: "/payslips", label: "給与明細", icon: <Wallet className="size-4" /> },
    { to: "/org", label: "組織・社員名簿", icon: <Network className="size-4" /> },
  ];
  const admin: NavItem[] = [
    ...(isAdmin ? [{ to: "/admin/employees", label: "従業員", icon: <Users className="size-4" /> }] : []),
    ...(isManager ? [{ to: "/admin/attendance", label: "勤怠管理", icon: <BarChart3 className="size-4" /> }] : []),
    ...(isManager ? [{ to: "/admin/leave", label: "休暇管理", icon: <CalendarDays className="size-4" /> }] : []),
    ...(isAdmin ? [{ to: "/admin/payroll", label: "給与計算", icon: <Wallet className="size-4" /> }] : []),
    ...(isAdmin ? [{ to: "/admin/expenses", label: "経費精算", icon: <Receipt className="size-4" /> }] : []),
    ...(isAdmin ? [{ to: "/admin/settings", label: "設定", icon: <Settings className="size-4" /> }] : []),
  ];

  const nav = (
    <nav className="flex flex-col h-full bg-ai-900 text-ai-100">
      <Logo name={me?.company?.appName ?? "ミナモ"} />
      <div className="px-4 pb-3 text-[11px] text-ai-200/70 truncate">{me?.company?.name}</div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <NavGroup items={personal} />
        {admin.length > 0 && (
          <>
            <div className="px-3 pt-5 pb-1.5 text-[11px] text-ai-200/60">管理</div>
            <NavGroup items={admin} />
          </>
        )}
      </div>
      <div className="border-t border-white/10 p-2">
        <NavLink to="/me" className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/5">
          <Avatar name={me?.user.name ?? ""} size={28} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-white truncate">{me?.user.name}</div>
            <div className="text-[11px] text-ai-200/70">{ROLE_JA[me?.user.role ?? "employee"]}</div>
          </div>
          <UserRound className="size-4 text-ai-200/60" />
        </NavLink>
        <button type="button" onClick={logout} className="mt-1 w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-ai-200 hover:bg-white/5 hover:text-white">
          <LogOut className="size-4" />
          ログアウト
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden lg:block bg-ai-900 no-print">
        <div className="sticky top-0 h-dvh">{nav}</div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <div className="absolute inset-0 bg-ai-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[260px]">{nav}</div>
          <button type="button" className="absolute top-3 left-[270px] text-white" onClick={() => setOpen(false)} aria-label="メニューを閉じる">
            <X className="size-6" />
          </button>
        </div>
      )}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur border-b border-line flex items-center gap-3 px-4 lg:px-8 no-print">
          <button type="button" className="lg:hidden btn btn-ghost px-2" onClick={() => setOpen(true)} aria-label="メニューを開く">
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <Notifications />
        </header>
        <main className="flex-1 px-4 lg:px-8 py-6 max-w-[1280px] w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((it) => (
        <li key={it.to}>
          <NavLink
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] ${isActive ? "bg-white/10 text-white font-medium shadow-[inset_3px_0_0_#6fb3bf]" : "text-ai-200 hover:bg-white/5 hover:text-white"}`
            }
          >
            {it.icon}
            <span className="flex-1">{it.label}</span>
            {!!it.badge && <span className="pill bg-asagi-600 text-white num">{it.badge}</span>}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Notifications() {
  const { me, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const list = useQuery<any[]>(open ? "/notifications" : null);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const unread = me?.unreadNotifications ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-ghost px-2 relative" onClick={() => setOpen((o) => !o)} aria-label={`お知らせ${unread ? ` (未読 ${unread}件)` : ""}`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-ng" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] panel shadow-xl z-50">
          <div className="panel-head">
            <span className="panel-title">通知</span>
            {unread > 0 && (
              <button
                type="button"
                className="link text-xs"
                onClick={async () => {
                  await api.post("/notifications/read");
                  await refresh();
                  list.reload();
                }}
              >
                すべて既読にする
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {list.data?.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-ink-3">通知はありません</li>}
            {list.data?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`w-full text-left px-4 py-2.5 border-b border-line-2 hover:bg-ai-50 ${n.read_at ? "" : "bg-asagi-100/40"}`}
                  onClick={async () => {
                    await api.post("/notifications/read", { id: n.id });
                    refresh();
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <div className="text-[13px] font-medium">{n.title}</div>
                  {n.body && <div className="text-xs text-ink-3 truncate">{n.body}</div>}
                  <div className="text-[11px] text-ink-3 mt-0.5">{dateTimeJa(n.created_at)}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
