import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";

const NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: "grid", end: true },
  { to: "/admin/clinics", label: "Clinics", icon: "building" },
  { to: "/admin/doctors", label: "Doctors", icon: "stethoscope" },
  { to: "/admin/associates", label: "Associates", icon: "users" },
  { to: "/admin/audit-log", label: "Audit log", icon: "shield" },
];

export function AdminLayout() {
  const { logout } = useAuth();
  return <AppShell variant="sidebar" roleLabel="Admin" nav={NAV} onLogout={logout} />;
}
