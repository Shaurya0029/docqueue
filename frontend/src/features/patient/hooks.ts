import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Appointment, DoctorProfile, DoctorSummary, FamilyMember, FamilyMemberInput, LeaveAlertState, QueueStatus, Slot } from "../../types/api";

export function useDoctorSearch(params: { name?: string; specialization?: string; city?: string }) {
  return useQuery({
    queryKey: ["doctor-search", params],
    queryFn: async () => {
      const res = await api.get<{ doctors: DoctorSummary[] }>("/doctors/search", { params });
      return res.data.doctors;
    },
  });
}

export function useDoctorProfile(doctorId: string | undefined) {
  return useQuery({
    queryKey: ["doctor-profile", doctorId],
    queryFn: async () => {
      const res = await api.get<DoctorProfile>(`/doctors/${doctorId}`);
      return res.data;
    },
    enabled: !!doctorId,
  });
}

export function useBookSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    /** `patientId`: a family member's id, or undefined to book for yourself. */
    mutationFn: async ({ slotId, patientId }: { slotId: string; patientId?: string }) => {
      const res = await api.post<{ appointment: Appointment }>("/appointments/book", { slotId, patientId });
      return res.data.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}

export interface PaymentOrder {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
  mode: "stub" | "razorpay";
}

export function useCreateOrder() {
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const res = await api.post<{ order: PaymentOrder }>("/payments/create-order", { appointmentId });
      return res.data.order;
    },
  });
}

/**
 * Local development without Razorpay keys (PAYMENTS_MODE=stub): asks the
 * server to build and sign the webhook Razorpay would send, which then runs
 * through the same verification and confirmation code as a real payment.
 * The endpoint does not exist in production.
 */
export function useSimulatePayment() {
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const res = await api.post("/payments/dev/simulate", { appointmentId });
      return res.data as { ok: boolean; outcome: string };
    },
  });
}

export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { appointmentId: string; slotId: string }) =>
      (await api.post<{ ok: boolean; token: number }>(`/appointments/${params.appointmentId}/reschedule`, { slotId: params.slotId })).data,
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ["appointment", params.appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-profile"] });
    },
  });
}

export function useMyAppointments() {
  return useQuery({
    queryKey: ["my-appointments"],
    queryFn: async () => {
      const res = await api.get<{ appointments: Appointment[] }>("/appointments/mine");
      return res.data.appointments;
    },
  });
}

export function useAppointment(appointmentId: string | undefined) {
  return useQuery({
    queryKey: ["appointment", appointmentId],
    queryFn: async () => {
      const res = await api.get<{ appointment: Appointment; leaveAlert: LeaveAlertState }>(`/appointments/${appointmentId}`);
      return { ...res.data.appointment, leaveAlert: res.data.leaveAlert };
    },
    enabled: !!appointmentId,
  });
}

export function useQueueStatus(appointmentId: string | undefined, pollMs = 4000) {
  return useQuery({
    queryKey: ["queue-status", appointmentId],
    queryFn: async () => {
      const res = await api.get<QueueStatus>(`/appointments/${appointmentId}/queue-status`);
      return res.data;
    },
    enabled: !!appointmentId,
    refetchInterval: pollMs,
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { appointmentId: string; reason?: string }) => {
      const res = await api.post(`/appointments/${params.appointmentId}/cancel`, { reason: params.reason });
      return res.data as { ok: boolean; refund: "PROCESSED" | "FAILED" | "NOT_ELIGIBLE" | "NOT_PAID" };
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ["appointment", params.appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}

export interface AlternativeDoctor {
  id: string;
  fullName: string;
  specialization: string;
  consultationFee: number;
  isVerified: boolean;
  clinic: { id: string; name: string; address: string | null };
  nextSlot: Slot;
}

export function useAlternativeDoctors(doctorId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["doctor-alternatives", doctorId],
    queryFn: async () => (await api.get<{ doctors: AlternativeDoctor[] }>(`/doctors/${doctorId}/alternatives`)).data.doctors,
    enabled: !!doctorId && enabled,
  });
}

export function useSlotAlert(doctorId: string | undefined) {
  return useQuery({
    queryKey: ["slot-alert", doctorId],
    queryFn: async () => (await api.get<{ subscribed: boolean }>(`/doctors/${doctorId}/slot-alert`)).data.subscribed,
    enabled: !!doctorId,
  });
}

export function useSetSlotAlert(doctorId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subscribe: boolean) =>
      (await (subscribe ? api.put : api.delete)<{ subscribed: boolean }>(`/doctors/${doctorId}/slot-alert`)).data.subscribed,
    onSuccess: (subscribed) => queryClient.setQueryData(["slot-alert", doctorId], subscribed),
  });
}

/** Turn on or adjust "Leave now" alerts: a one-time location, or minutes the patient typed. */
export function useSetLeaveAlert(appointmentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { latitude: number; longitude: number } | { travelMinutes: number }) =>
      (await api.put<{ leaveAlert: LeaveAlertState }>(`/appointments/${appointmentId}/leave-alert`, body)).data.leaveAlert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointment", appointmentId] }),
  });
}

export function useDisableLeaveAlert(appointmentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.delete<{ leaveAlert: LeaveAlertState }>(`/appointments/${appointmentId}/leave-alert`)).data.leaveAlert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["appointment", appointmentId] }),
  });
}

/** The family members this account books for. */
export function useFamily() {
  return useQuery({
    queryKey: ["family"],
    queryFn: async () => (await api.get<{ members: FamilyMember[] }>("/me/patient/family")).data.members,
  });
}

export function useSaveFamilyMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: FamilyMemberInput & { id?: string }) =>
      (id
        ? await api.put<{ member: FamilyMember }>(`/me/patient/family/${id}`, body)
        : await api.post<{ member: FamilyMember }>("/me/patient/family", body)
      ).data.member,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["family"] }),
  });
}

/** Erases one family member's data (DPDP); their upcoming bookings are cancelled. */
export function useDeleteFamilyMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ cancelledBookings: number }>(`/me/patient/family/${id}/delete`, { confirm: "DELETE" })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family"] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}
