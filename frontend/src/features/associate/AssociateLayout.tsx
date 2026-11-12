import { AppShell, type NavItem } from "../../components/AppShell";
import { Select } from "../../components/ui";
import { useAuth } from "../auth/AuthContext";
import { ActiveDoctorProvider, useActiveDoctor } from "./ActiveDoctorContext";
import { msg } from "../../lib/i18n";

const NAV: NavItem[] = [
  { to: "/associate", label: msg("Scanner"), icon: "scan", end: true },
  { to: "/associate/walk-in", label: msg("Walk-in"), icon: "user" },
  { to: "/associate/queue", label: msg("Queue board"), icon: "queue" },
];

function DoctorSwitcher() {
  const { doctorId, setDoctorId, doctors } = useActiveDoctor();
  if (doctors.length <= 1) return null;
  return (
    <Select aria-label="Doctor" className="w-full min-w-0 max-w-[12rem] text-sm lg:max-w-none" value={doctorId ?? ""} onChange={(e) => setDoctorId(e.target.value)}>
      {doctors.map((d) => (
        <option key={d.id} value={d.id}>
          {d.fullName}
        </option>
      ))}
    </Select>
  );
}

export function AssociateLayout() {
  const { logout } = useAuth();
  return (
    <ActiveDoctorProvider>
      <AppShell variant="mobile" roleLabel={msg("Front desk")} nav={NAV} onLogout={logout} headerExtra={<DoctorSwitcher />} />
    </ActiveDoctorProvider>
  );
}
