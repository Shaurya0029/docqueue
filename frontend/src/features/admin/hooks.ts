import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AdminOverviewRow, AuditLogEntry, Clinic, DoctorBasic } from "../../types/api";

interface AdminDoctorRow extends DoctorBasic {
  userId: string;
  clinicId: string;
}

interface AdminAssociateRow {
  id: string;
  userId: string;
  clinicId: string;
  assignedDoctors: { doctor: DoctorBasic }[];
}

export function useClinics() {
  return useQuery({
    queryKey: ["admin-clinics"],
    queryFn: async () => (await api.get<{ clinics: Clinic[] }>("/clinics")).data.clinics,
  });
}

export function useCreateClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; address?: string }) => (await api.post("/clinics", data)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-clinics"] }),
  });
}

export function useUpdateClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; name?: string; address?: string }) =>
      (await api.patch(`/clinics/${params.id}`, { name: params.name, address: params.address })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-clinics"] }),
  });
}

export function useCreateDoctor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      clinicId: string;
      phoneNumber: string;
      fullName: string;
      specialization: string;
      consultationFee: number;
      avgConsultMinutes: number;
    }) =>
      (
        await api.post<{ doctor: DoctorBasic; loginPhone: string; tempPassword: string }>(
          `/clinics/${params.clinicId}/doctors`,
          params
        )
      ).data,
    onSuccess: (_data, params) => queryClient.invalidateQueries({ queryKey: ["admin-clinic-doctors", params.clinicId] }),
  });
}

export function useCreateAssociate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { clinicId: string; phoneNumber: string; fullName: string; doctorIds: string[] }) =>
      (
        await api.post<{ associate: { id: string }; loginPhone: string; tempPassword: string }>(
          `/clinics/${params.clinicId}/associates`,
          params
        )
      ).data,
    onSuccess: (_data, params) => queryClient.invalidateQueries({ queryKey: ["admin-clinic-associates", params.clinicId] }),
  });
}

export function useDeactivateUser(clinicId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => api.patch(`/users/${userId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-clinic-doctors", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["admin-clinic-associates", clinicId] });
    },
  });
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => (await api.get<{ overview: AdminOverviewRow[] }>("/admin/overview")).data.overview,
  });
}

export function useDoctorsForClinic(clinicId: string | undefined) {
  return useQuery({
    queryKey: ["admin-clinic-doctors", clinicId],
    queryFn: async () => (await api.get<{ doctors: AdminDoctorRow[] }>(`/clinics/${clinicId}/doctors`)).data.doctors,
    enabled: !!clinicId,
  });
}

export function useAssociatesForClinic(clinicId: string | undefined) {
  return useQuery({
    queryKey: ["admin-clinic-associates", clinicId],
    queryFn: async () => (await api.get<{ associates: AdminAssociateRow[] }>(`/clinics/${clinicId}/associates`)).data.associates,
    enabled: !!clinicId,
  });
}

export function useAuditLog(filters: { action?: string }) {
  return useQuery({
    queryKey: ["admin-audit-log", filters],
    queryFn: async () => (await api.get<{ logs: AuditLogEntry[] }>("/admin/audit-log", { params: filters })).data.logs,
  });
}
