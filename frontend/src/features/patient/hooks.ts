import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Appointment, DoctorProfile, DoctorSummary, QueueStatus } from "../../types/api";

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
    mutationFn: async (slotId: string) => {
      const res = await api.post<{ appointment: Appointment }>("/appointments/book", { slotId });
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
      const res = await api.get<{ appointment: Appointment }>(`/appointments/${appointmentId}`);
      return res.data.appointment;
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
      return res.data as { ok: boolean; refunded: boolean };
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({ queryKey: ["appointment", params.appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
    },
  });
}
