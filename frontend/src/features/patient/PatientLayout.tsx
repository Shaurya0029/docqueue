import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";
import { msg } from "../../lib/i18n";

const NAV: NavItem[] = [
  { to: "/patient", label: msg("Home"), icon: "home", end: true },
  { to: "/patient/appointments", label: msg("Bookings"), icon: "calendar" },
  { to: "/patient/profile", label: msg("Profile"), icon: "user" },
];

export function PatientLayout() {
  const { logout } = useAuth();
  return <AppShell variant="mobile" roleLabel={msg("Patient")} nav={NAV} onLogout={logout} />;
}
