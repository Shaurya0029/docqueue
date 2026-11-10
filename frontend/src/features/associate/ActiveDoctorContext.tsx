import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAssignedDoctors } from "./hooks";

interface ActiveDoctorValue {
  doctorId: string | null;
  setDoctorId: (id: string) => void;
  doctors: { id: string; fullName: string }[];
  loading: boolean;
}

const ActiveDoctorContext = createContext<ActiveDoctorValue | null>(null);

export function ActiveDoctorProvider({ children }: { children: ReactNode }) {
  const { data: doctors, isLoading } = useAssignedDoctors();
  const [doctorId, setDoctorId] = useState<string | null>(() => localStorage.getItem("docqueue.activeDoctorId"));

  useEffect(() => {
    if (!doctorId && doctors && doctors.length > 0) {
      setDoctorId(doctors[0].id);
    }
  }, [doctors, doctorId]);

  function handleSetDoctorId(id: string) {
    setDoctorId(id);
    localStorage.setItem("docqueue.activeDoctorId", id);
  }

  return (
    <ActiveDoctorContext.Provider
      value={{ doctorId, setDoctorId: handleSetDoctorId, doctors: doctors ?? [], loading: isLoading }}
    >
      {children}
    </ActiveDoctorContext.Provider>
  );
}

export function useActiveDoctor(): ActiveDoctorValue {
  const ctx = useContext(ActiveDoctorContext);
  if (!ctx) throw new Error("useActiveDoctor must be used within ActiveDoctorProvider");
  return ctx;
}
