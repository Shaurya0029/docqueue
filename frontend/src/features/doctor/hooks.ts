import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Appointment, DoctorProfile, DoctorQueue, Slot, MyDoctorRecord } from "../../types/api";

// The JWT's profileId (the Doctor.id) never reaches the frontend directly;
// /me returns it as profile.id, and every doctor-scoped URL below needs it
// (the backend ignores anything else in the URL and re-derives scope from
// the JWT anyway, but the frontend still has to address the right doctor).
export function useMyDoctorProfile() {
  return useQuery({
    queryKey: ["my-doctor-profile"],
    queryFn: async () => (await api.get<{ profile: MyDoctorRecord }>("/me")).data.profile,
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

export function useDoctorAppointments(doctorId: string | null, date: string) {
  return useQuery({
    queryKey: ["doctor-appointments", doctorId, date],
    queryFn: async () =>
      (await api.get<{ date: string; appointments: Appointment[] }>(`/doctors/${doctorId}/appointments`, { params: { date } })).data
        .appointments,
    enabled: !!doctorId,
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

export function useDoctorSlots(doctorId: string | null) {
  return useQuery({
    queryKey: ["doctor-slots", doctorId],
    queryFn: async () => (await api.get<{ slots: Slot[] }>(`/doctors/${doctorId}/slots`)).data.slots,
    enabled: !!doctorId,
  });
}

export function useCreateSlot(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { startsAt: string; endsAt: string }) =>
      (await api.post(`/doctors/${doctorId}/slots`, params)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-slots", doctorId] }),
  });
}

export function useCreateBulkSlots(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      pattern: { weekday: number; startTime: string; endTime: string; slotMinutes: number }[];
      fromDate: string;
      toDate: string;
    }) => (await api.post(`/doctors/${doctorId}/slots`, params)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-slots", doctorId] }),
  });
}

export function useDeleteSlot(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => api.delete(`/slots/${slotId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-slots", doctorId] }),
  });
}

export function useUpdateDoctorSettings(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      consultationFee?: number;
      avgConsultMinutes?: number;
      bio?: string;
      registrationNumber?: string;
      registrationCouncil?: string;
    }) => (await api.patch(`/doctors/${doctorId}`, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-profile-full", doctorId] });
      queryClient.invalidateQueries({ queryKey: ["my-doctor-profile"] });
    },
  });
}

export function useConsultAverage(doctorId: string | null) {
  return useQuery({
    queryKey: ["consult-average", doctorId],
    queryFn: async () =>
      (await api.get<{ minutes: number; basis: "history" | "configured"; sampleSize: number }>(`/doctors/${doctorId}/consult-average`)).data,
    enabled: !!doctorId,
  });
}

export function useDoctorProfileFull(doctorId: string | null) {
  return useQuery({
    queryKey: ["doctor-profile-full", doctorId],
    queryFn: async () => (await api.get<DoctorProfile>(`/doctors/${doctorId}`)).data,
    enabled: !!doctorId,
  });
}

export function useDoctorEarnings(doctorId: string | null) {
  return useQuery({
    queryKey: ["doctor-earnings", doctorId],
    queryFn: async () =>
      (await api.get<{ totalPaid: number; byDay: Record<string, number>; byMonth: Record<string, number> }>(
        `/doctors/${doctorId}/earnings`
      )).data,
    enabled: !!doctorId,
  });
}

/** Doctor cancels a booking; the patient is always refunded in full. */
export function useCancelByClinic(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { appointmentId: string; reason?: string }) =>
      (await api.post<{ refund: string }>(`/appointments/${params.appointmentId}/cancel-by-clinic`, { reason: params.reason })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-appointments", doctorId] }),
  });
}

/** Doctor override: refund a late cancellation, or retry a failed refund. */
export function useRefundOverride(doctorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appointmentId: string) =>
      (await api.post<{ refund: string }>(`/appointments/${appointmentId}/refund-override`, {})).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-appointments", doctorId] }),
  });
}
