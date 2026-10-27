import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./styles.css";
import { AuthProvider, useAuth, useRole } from "./lib/auth";
import { ToastProvider } from "./components/toast";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { api } from "./lib/api";
import { LoginPage, SetupPage } from "./pages/auth";
import { HomePage } from "./pages/home";
import { MyAttendancePage } from "./pages/attendance";
import { LeavePage } from "./pages/leave";
import { RequestsPage, NewRequestPage, RequestDetailPage, ApprovalsPage, EditRequestPage } from "./pages/requests";
import { PayslipsPage, PayslipDetailPage } from "./pages/payslips";
import { OrgPage } from "./pages/org";
import { MePage } from "./pages/me";
// 管理者向けの画面は必要になった時に読み込む
const EmployeesPage = lazy(() => import("./pages/admin/employees").then((m) => ({ default: m.EmployeesPage })));
const EmployeeDetailPage = lazy(() => import("./pages/admin/employees").then((m) => ({ default: m.EmployeeDetailPage })));
const NewEmployeePage = lazy(() => import("./pages/admin/employees").then((m) => ({ default: m.NewEmployeePage })));
const AdminAttendancePage = lazy(() => import("./pages/admin/attendance").then((m) => ({ default: m.AdminAttendancePage })));
const EmployeeAttendancePage = lazy(() => import("./pages/admin/attendance").then((m) => ({ default: m.EmployeeAttendancePage })));
const AdminLeavePage = lazy(() => import("./pages/admin/leave").then((m) => ({ default: m.AdminLeavePage })));
const PayrollPage = lazy(() => import("./pages/admin/payroll").then((m) => ({ default: m.PayrollPage })));
const PayrollRunPage = lazy(() => import("./pages/admin/payroll").then((m) => ({ default: m.PayrollRunPage })));
const AdminExpensesPage = lazy(() => import("./pages/admin/expenses").then((m) => ({ default: m.AdminExpensesPage })));
const SettingsPage = lazy(() => import("./pages/admin/settings").then((m) => ({ default: m.SettingsPage })));

function Gate() {
  const { me, loading } = useAuth();
  const [setup, setSetup] = useState<{ needsSetup: boolean; appName: string; authConfigured: boolean; setupAdminConfigured: boolean; setupEmail: string | null } | null>(null);
  useEffect(() => {
    api.get("/setup/status").then(setSetup).catch(() => setSetup({ needsSetup: false, appName: "ミナモ", authConfigured: true, setupAdminConfigured: true, setupEmail: null }));
  }, []);
  useEffect(() => {
    document.title = `${me?.company?.appName ?? setup?.appName ?? "ミナモ"} HR`;
  }, [me, setup]);
  if (loading || !setup) return <Spinner />;
  if (setup.needsSetup) return <SetupPage setupEmail={setup.setupEmail} authConfigured={setup.authConfigured} setupAdminConfigured={setup.setupAdminConfigured} />;
  if (!me) return <LoginPage appName={setup.appName} authConfigured={setup.authConfigured} />;
  return <AppRoutes />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useRole();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}
function ManagerOnly({ children }: { children: React.ReactNode }) {
  const { isManager } = useRole();
  return isManager ? <>{children}</> : <Navigate to="/" replace />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="attendance" element={<MyAttendancePage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="requests/new" element={<NewRequestPage />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        <Route path="requests/:id/edit" element={<EditRequestPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="payslips" element={<PayslipsPage />} />
        <Route path="payslips/:id" element={<PayslipDetailPage />} />
        <Route path="org" element={<OrgPage />} />
        <Route path="me" element={<MePage />} />
        <Route path="employees/:id" element={<EmployeeDetailPage />} />
        <Route path="admin/employees" element={<AdminOnly><EmployeesPage /></AdminOnly>} />
        <Route path="admin/employees/new" element={<AdminOnly><NewEmployeePage /></AdminOnly>} />
        <Route path="admin/attendance" element={<ManagerOnly><AdminAttendancePage /></ManagerOnly>} />
        <Route path="admin/attendance/:employeeId" element={<ManagerOnly><EmployeeAttendancePage /></ManagerOnly>} />
        <Route path="admin/leave" element={<ManagerOnly><AdminLeavePage /></ManagerOnly>} />
        <Route path="admin/payroll" element={<AdminOnly><PayrollPage /></AdminOnly>} />
        <Route path="admin/payroll/:id" element={<AdminOnly><PayrollRunPage /></AdminOnly>} />
        <Route path="admin/expenses" element={<AdminOnly><AdminExpensesPage /></AdminOnly>} />
        <Route path="expenses/payables" element={<Navigate to="/admin/expenses" replace />} />
        <Route path="admin/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

// 日本語フォントの定義は大きいので、初回表示を妨げないよう後から読み込む (読み込むまではシステムフォント)
void import("./fonts");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
