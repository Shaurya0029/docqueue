import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { msg } from "../../lib/i18n";

const NAV: NavItem[] = [
  { to: "/admin", label: msg("Overview"), icon: "grid", end: true },
  { to: "/admin/clinics", label: msg("Clinics"), icon: "building" },
  { to: "/admin/doctors", label: msg("Doctors"), icon: "stethoscope" },
  { to: "/admin/associates", label: msg("Associates"), icon: "users" },
  { to: "/admin/audit-log", label: msg("Audit log"), icon: "shield" },
];

export function AdminLayout() {
  const { logout } = useAuth();
  return <AppShell variant="sidebar" roleLabel={msg("Admin")} nav={NAV} onLogout={logout} />;
}
