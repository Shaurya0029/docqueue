import { clinicHour } from "../../lib/formatters";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Avatar, Button, Card, Chip, EmptyState, ErrorState, HeroCard, Input, Reveal, Skeleton, StatusChip, stagger } from "../../components/ui";
import { formatDate, formatRupees, formatTime } from "../../lib/formatters";
import { useDoctorSearch, useMyAppointments } from "./hooks";
import { LocationChip, LocationPicker } from "../../components/LocationPicker";
import { cityOf, detectLocation, hasLocationPermission, usePatientLocation } from "../../lib/location";
import { useT } from "../../lib/i18n";

const SPECIALIZATIONS = ["General Physician", "Dermatologist", "Pediatrician", "Cardiologist", "Dentist"];

function greeting() {
  const h = clinicHour(new Date().toISOString());
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function HomePage() {
  const t = useT();
  const [specialization, setSpecialization] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const { location, setLocation } = usePatientLocation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const city = cityOf(location);
  const { data: doctors, isLoading, isError, refetch } = useDoctorSearch({ specialization, name: name || undefined, city });

  // First visit: if the browser already allows location access, detect the city silently.
  // (Without permission we don't prompt on page load — the user taps "Use my current location".)
  useEffect(() => {
    if (location) return;
    let cancelled = false;
    void hasLocationPermission().then(async (granted) => {
      if (!granted || cancelled) return;
      setAutoDetecting(true);
      try {
        const found = await detectLocation();
        if (!cancelled) setLocation({ source: "auto", ...found });
      } catch {
        /* stay on "Choose location" */
      } finally {
        if (!cancelled) setAutoDetecting(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [location, setLocation]);
  const { data: appointments } = useMyAppointments();

  const upcoming = appointments?.find((a) => a.status === "BOOKED" || a.status === "CHECKED_IN" || a.status === "IN_CONSULTATION");

  return (
    <div className="space-y-6">
      <Reveal>
        <HeroCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white/80">{t(greeting())} 👋</p>
            <LocationChip location={location} detecting={autoDetecting} onClick={() => setPickerOpen(true)} />
          </div>
          <h1 className="mt-1 text-2xl font-extrabold leading-tight text-white sm:text-3xl">{t("Better care starts with the right doctor.")}</h1>
          <div className="mt-5 max-w-2xl">
            <Input
              icon="search"
              aria-label={t("Search doctor by name")}
              placeholder={t("Search doctor by name")}
              className="!ring-white/0 shadow-lift"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </HeroCard>
      </Reveal>

      {upcoming && (
        <Reveal delay={0.08}>
          <Link to={`/patient/ticket/${upcoming.id}`} className="block">
            <Card interactive className="flex items-center gap-4 !border-brand-200 p-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-xl font-extrabold text-white shadow-glow">
                {upcoming.queueToken ?? "–"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t("Upcoming appointment")}</p>
                <p className="truncate font-bold text-ink">{upcoming.doctor?.fullName ?? t("Your doctor")}</p>
                {upcoming.slot && (
                  <p className="text-sm text-muted">
                    {formatDate(upcoming.slot.startsAt)} · {formatTime(upcoming.slot.startsAt)}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusChip status={upcoming.status} />
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                  {t("Live ticket")} <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </span>
              </div>
            </Card>
          </Link>
        </Reveal>
      )}

      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-extrabold">{t("Find a doctor")}</h2>
            <button type="button" onClick={() => setPickerOpen(true)} className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-brand-600">
              <Icon name="pin" className="h-3.5 w-3.5" />
              {city ? t("Near {city}", { city }) : t("All locations")}
            </button>
          </div>
          {doctors && <span className="text-xs font-semibold text-muted">{t("{n} available", { n: doctors.length })}</span>}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip label={t("All")} active={!specialization} onClick={() => setSpecialization(undefined)} />
          {SPECIALIZATIONS.map((s) => (
            <Chip key={s} label={t(s)} active={specialization === s} onClick={() => setSpecialization(s)} />
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}
      {isError && <ErrorState message={t("Could not load doctors")} onRetry={() => refetch()} />}
      {!isLoading && !isError && doctors?.length === 0 && (
        city ? (
          <EmptyState
            icon="pin"
            title={t("No doctors found near {city}", { city })}
            hint={t("Try another location, or see doctors in all locations.")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" icon="pin" onClick={() => setPickerOpen(true)}>
                  {t("Change location")}
                </Button>
                <Button size="sm" icon="grid" onClick={() => setLocation({ source: "all" })}>
                  {t("Show all locations")}
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState icon="search" title={t("No doctors found")} hint={t("Try a different speciality or name")} />
        )
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {doctors?.map((doctor, i) => (
          <Link key={doctor.id} to={`/patient/doctor/${doctor.id}`} className="block h-full">
            <Card interactive className="group h-full animate-fade-up p-4" style={stagger(i + 2)}>
              <div className="flex items-start gap-4">
                <Avatar name={doctor.fullName} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate font-bold text-ink">
                        {doctor.fullName}
                        {doctor.isVerified && <Icon name="verified" className="h-4 w-4 shrink-0 text-brand-500" aria-label={t("Verified")} />}
                      </p>
                      <p className="text-sm font-semibold text-brand-600">{doctor.specialization}</p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="block text-lg font-extrabold text-ink">{formatRupees(doctor.consultationFee)}</span>
                      <span className="text-[11px] text-muted">{t("per visit")}</span>
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                      <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
                      {doctor.clinic.name}
                    </p>
                    {doctor.nextSlot ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-bold text-success">
                        <Icon name="clock" className="h-3 w-3" />
                        {t("Next {time}", { time: formatTime(doctor.nextSlot.startsAt) })}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] font-semibold text-slate-400">{t("No open slots")}</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} current={location} onChange={setLocation} />
    </div>
  );
}
