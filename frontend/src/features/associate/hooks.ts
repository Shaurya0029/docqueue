import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { DoctorBasic, DoctorQueue } from "../../types/api";

export function useAssignedDoctors() {
  return useQuery({
    queryKey: ["assigned-doctors"],
    queryFn: async () => (await api.get<{ doctors: DoctorBasic[] }>("/associates/me/doctors")).data.doctors,
  });
}

export function useDoctorQueue(doctorId: string | null) {
  return useQuery({
    queryKey: ["doctor-queue", doctorId],
    queryFn: async () => (await api.get<DoctorQueue>(`/doctors/${doctorId}/queue`)).data,
    enabled: !!doctorId,
    refetchInterval: 6000,
  });
}

export function useScanQr() {
  return useMutation({
    /** Either the scanned QR value or the short code typed at the desk. */
    mutationFn: async (input: { token: string } | { code: string }) =>
      (await api.post<{ name: string | null; queueToken: number | null; paymentStatus: string }>("/appointments/qr/scan", input)).data,
  });
}

export function useCallNext(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/appointments/doctor/${doctorId}/call-next`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-queue", doctorId] }),
  });
}

export function useMarkComplete(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appointmentId: string) => (await api.post(`/appointments/${appointmentId}/complete`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-queue", doctorId] }),
  });
}

export function useMarkNoShow(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appointmentId: string) => (await api.post(`/appointments/${appointmentId}/no-show`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-queue", doctorId] }),
  });
}

export function usePauseQueue(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: "OPEN" | "PAUSED" | "CLOSED") =>
      (await api.post(`/doctors/${doctorId}/queue/pause`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-queue", doctorId] }),
  });
}

export interface WalkInResult {
  appointmentId: string;
  token: number;
  slotStartsAt: string;
  patientName: string;
}

export function useAddWalkIn(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { fullName: string; phoneNumber: string; feeCollected: boolean; consent: true }) =>
      (await api.post<WalkInResult>(`/doctors/${doctorId}/walk-ins`, body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-queue", doctorId] }),
  });
}
