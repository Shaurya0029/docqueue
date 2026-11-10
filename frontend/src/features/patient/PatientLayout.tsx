import { AppShell, type NavItem } from "../../components/AppShell";
import { useAuth } from "../auth/AuthContext";

const NAV: NavItem[] = [
  { to: "/patient", label: "Home", icon: "home", end: true },
  { to: "/patient/appointments", label: "Bookings", icon: "calendar" },
  { to: "/patient/profile", label: "Profile", icon: "user" },
];

export function PatientLayout() {
  const { logout } = useAuth();
  return <AppShell variant="mobile" roleLabel="Patient" nav={NAV} onLogout={logout} />;
}
