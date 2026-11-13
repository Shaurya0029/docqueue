import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { PreferencesProvider } from "./lib/preferences";
import { LoginPage } from "./features/auth/LoginPage";
import { LegalPage } from "./features/legal/LegalPage";
import { RequireRole } from "./app/RequireRole";
import { homePathForRole } from "./app/homePathForRole";

import { PatientLayout } from "./features/patient/PatientLayout";
import { HomePage } from "./features/patient/HomePage";
import { DoctorProfilePage } from "./features/patient/DoctorProfilePage";
import { BookingPaymentPage } from "./features/patient/BookingPaymentPage";
import { TicketPage } from "./features/patient/TicketPage";
import { ReschedulePage } from "./features/patient/ReschedulePage";
import { WalkInPage } from "./features/associate/WalkInPage";
import { AppointmentsPage } from "./features/patient/AppointmentsPage";
import { ProfilePage } from "./features/patient/ProfilePage";
import { FamilyPage } from "./features/patient/FamilyPage";
import { DisplayBoardPage } from "./features/display/DisplayBoardPage";
import { AnalyticsPage } from "./features/admin/analytics/AnalyticsPage";

import { AssociateLayout } from "./features/associate/AssociateLayout";
import { ScannerPage } from "./features/associate/ScannerPage";
import { QueueBoardPage } from "./features/associate/QueueBoardPage";

import { DoctorLayout } from "./features/doctor/DoctorLayout";
import { TodayPage } from "./features/doctor/TodayPage";
import { SchedulePage } from "./features/doctor/SchedulePage";
import { SlotsPage } from "./features/doctor/SlotsPage";
import { SettingsPage } from "./features/doctor/SettingsPage";
import { EarningsPage } from "./features/doctor/EarningsPage";

import { AdminLayout } from "./features/admin/AdminLayout";
import { OverviewPage } from "./features/admin/OverviewPage";
import { ClinicsPage } from "./features/admin/ClinicsPage";
import { DoctorsPage } from "./features/admin/DoctorsPage";
import { AssociatesPage } from "./features/admin/AssociatesPage";
import { AuditLogPage } from "./features/admin/AuditLogPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: 1 } },
});

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathForRole(user.role)} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<LegalPage doc="privacy" />} />
      {/* Waiting-room TV: public, no login, the link token is the only key. */}
      <Route path="/display/:token" element={<DisplayBoardPage />} />
      <Route path="/terms" element={<LegalPage doc="terms" />} />
      <Route path="/" element={<RootRedirect />} />

      <Route
        path="/patient"
        element={
          <RequireRole role="PATIENT">
            <PatientLayout />
          </RequireRole>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="doctor/:doctorId" element={<DoctorProfilePage />} />
        <Route path="book/:appointmentId" element={<BookingPaymentPage />} />
        <Route path="ticket/:appointmentId" element={<TicketPage />} />
        <Route path="reschedule/:appointmentId" element={<ReschedulePage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="family" element={<FamilyPage />} />
      </Route>

      <Route
        path="/associate"
        element={
          <RequireRole role="ASSOCIATE">
            <AssociateLayout />
          </RequireRole>
        }
      >
        <Route index element={<ScannerPage />} />
        <Route path="queue" element={<QueueBoardPage />} />
        <Route path="walk-in" element={<WalkInPage />} />
      </Route>

      <Route
        path="/doctor"
        element={
          <RequireRole role="DOCTOR">
            <DoctorLayout />
          </RequireRole>
        }
      >
        <Route index element={<TodayPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="slots" element={<SlotsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="earnings" element={<EarningsPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireRole role="ADMIN">
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="clinics" element={<ClinicsPage />} />
        <Route path="doctors" element={<DoctorsPage />} />
        <Route path="associates" element={<AssociatesPage />} />
        <Route path="audit-log" element={<AuditLogPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
