import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { msg } from "../../lib/i18n";

const NAV: NavItem[] = [
  { to: "/doctor", label: msg("Today"), icon: "bolt", end: true },
  { to: "/doctor/schedule", label: msg("Schedule"), icon: "calendar" },
  { to: "/doctor/slots", label: msg("Slots"), icon: "clock" },
  { to: "/doctor/earnings", label: msg("Earnings"), icon: "wallet" },
  { to: "/doctor/settings", label: msg("Settings"), icon: "settings" },
];

export function DoctorLayout() {
  const { logout } = useAuth();
  return <AppShell variant="sidebar" roleLabel={msg("Doctor")} nav={NAV} onLogout={logout} />;
}
