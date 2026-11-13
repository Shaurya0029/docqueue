import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Avatar, Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Spinner, StatusChip, stagger } from "../../components/ui";
import { formatDate, formatTime } from "../../lib/formatters";
import type { AppointmentStatus } from "../../types/api";
import { useMyAppointments } from "./hooks";
import { useT } from "../../lib/i18n";

const ACTIVE: AppointmentStatus[] = ["PENDING_PAYMENT", "BOOKED", "CHECKED_IN", "IN_CONSULTATION"];

export function AppointmentsPage() {
  const t = useT();
  const { data: appointments, isLoading, isError, refetch } = useMyAppointments();
  const [filter, setFilter] = useState<"upcoming" | "past">("upcoming");

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorState message={t("Could not load your appointments")} onRetry={() => refetch()} />;

  const list = (appointments ?? []).filter((a) => (filter === "upcoming" ? ACTIVE.includes(a.status) : !ACTIVE.includes(a.status)));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Bookings")} title={t("My appointments")} />
      <div className="max-w-md">
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "upcoming", label: t("Upcoming"), icon: "calendarCheck" },
          { value: "past", label: t("Past"), icon: "clock" },
        ]}
      />
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={filter === "upcoming" ? t("No upcoming appointments") : t("No past appointments")}
          hint={filter === "upcoming" ? t("Find a doctor and book your first consultation.") : undefined}
          action={
            filter === "upcoming" && (
              <Link to="/patient">
                <Button size="sm" icon="search">
                  {t("Find a doctor")}
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((appointment, i) => (
            <Link
              key={appointment.id}
              className="block"
              to={appointment.status === "PENDING_PAYMENT" ? `/patient/book/${appointment.id}` : `/patient/ticket/${appointment.id}`}
            >
              <Card interactive className="group flex animate-fade-up items-center gap-4" style={stagger(i)}>
                <Avatar name={appointment.doctor?.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{appointment.doctor?.fullName ?? t("Doctor")}</p>
                  {appointment.patient?.accountHolderId && (
                    <p className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                      <Icon name="user" className="h-3.5 w-3.5" />
                      {t("For {name}", { name: appointment.patient.fullName ?? "" })}
                    </p>
                  )}
                  {appointment.slot && (
                    <p className="flex items-center gap-1 text-sm text-muted">
                      <Icon name="calendar" className="h-3.5 w-3.5" />
                      {formatDate(appointment.slot.startsAt)} · {formatTime(appointment.slot.startsAt)}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <StatusChip status={appointment.status} />
                    {appointment.queueToken !== null && <span className="text-xs font-bold text-brand-600">{t("Token #{n}", { n: appointment.queueToken })}</span>}
                  </div>
                </div>
                <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-brand-600" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
