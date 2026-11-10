import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";

const NAV: NavItem[] = [
  { to: "/doctor", label: "Today", icon: "bolt", end: true },
  { to: "/doctor/schedule", label: "Schedule", icon: "calendar" },
  { to: "/doctor/slots", label: "Slots", icon: "clock" },
  { to: "/doctor/earnings", label: "Earnings", icon: "wallet" },
  { to: "/doctor/settings", label: "Settings", icon: "settings" },
];

export function DoctorLayout() {
  const { logout } = useAuth();
  return <AppShell variant="sidebar" roleLabel="Doctor" nav={NAV} onLogout={logout} />;
}
