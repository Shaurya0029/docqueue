import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, Chip, Section, cx } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatDate, formatDayKey, formatTime } from "../../lib/formatters";
import { useT } from "../../lib/i18n";
import type { WaitlistEntry } from "../../types/api";
import { useClaimOffer, useDeclineOffer, useFamily, useFullDays, useJoinWaitlist, useLeaveWaitlist, useMyWaitlist } from "./hooks";

/**
 * Doctor profile: join the waitlist for a fully booked day. Different from
 * "Notify me when slots open", which only texts when new slots are added.
 */
export function WaitlistPanel({ doctorId }: { doctorId: string }) {
  const t = useT();
  const { data: days } = useFullDays(doctorId);
  const { data: family } = useFamily();
  const { data: mine } = useMyWaitlist();
  const join = useJoinWaitlist();
  const [day, setDay] = useState<string | null>(null);
  const [forId, setForId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  if (!days || days.length === 0) return null;
  const date = day && days.includes(day) ? day : days[0];
  // Already in line for this doctor, day and person (yourself = the entry without an account holder).
  const already = mine?.some((e) => e.doctor.id === doctorId && e.date === date && (forId ? e.patient.id === forId : !e.patient.accountHolderId));

  async function submit() {
    setError(null);
    try {
      await join.mutateAsync({ doctorId, date, patientId: forId ?? undefined });
      setJoined(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <Section title={t("Waitlist for a fully booked day")} icon="users">
      <div className="space-y-3" data-testid="waitlist-panel">
        <p className="text-sm text-muted">
          {t("If someone cancels on that day, the slot is held for the first person in line for 10 minutes. We text you; you claim it and pay as usual.")}
        </p>
        <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 p-2.5 text-xs text-muted ring-1 ring-slate-200">
          <Icon name="bell" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("Not the same as “Notify me when slots open”: that only texts you when the doctor adds new slots, and holds nothing for you.")}
        </p>
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{t("Fully booked days")}</p>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((d) => (
              <Chip key={d} label={formatDayKey(d, { weekday: "short", day: "numeric", month: "short" })} active={d === date} onClick={() => { setDay(d); setJoined(false); }} />
            ))}
          </div>
        </div>
        {family && family.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{t("Who is this visit for?")}</legend>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <Chip label={t("Myself")} active={!forId} onClick={() => { setForId(null); setJoined(false); }} />
              {family.map((m) => (
                <Chip key={m.id} label={m.fullName} active={forId === m.id} onClick={() => { setForId(m.id); setJoined(false); }} />
              ))}
            </div>
          </fieldset>
        )}
        {joined || already ? (
          <Alert tone="success">
            <span>
              {t("You're on the waitlist for {date}.", { date: formatDayKey(date, { weekday: "short", day: "numeric", month: "short" }) })}{" "}
              <Link to="/patient/appointments" className="font-semibold underline">
                {t("See it in Bookings")}
              </Link>
            </span>
          </Alert>
        ) : (
          <Button icon="users" className="w-full" loading={join.isPending} onClick={() => void submit()}>
            {t("Join waitlist")}
          </Button>
        )}
        <Alert>{error}</Alert>
      </div>
    </Section>
  );
}

/** Minutes and seconds left on an offer; ticks every second. */
function useCountdown(until: string): number {
  const [left, setLeft] = useState(() => new Date(until).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, left);
}

function OfferCard({ entry }: { entry: WaitlistEntry & { offer: NonNullable<WaitlistEntry["offer"]> } }) {
  const t = useT();
  const navigate = useNavigate();
  const claim = useClaimOffer();
  const decline = useDeclineOffer();
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(entry.offer.expiresAt);
  const mm = Math.floor(left / 60_000);
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const expired = left === 0;

  async function doClaim() {
    setError(null);
    try {
      const appointment = await claim.mutateAsync(entry.offer.id);
      navigate(`/patient/book/${appointment.id}`); // pay as usual
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }
  async function doDecline() {
    setError(null);
    try {
      await decline.mutateAsync(entry.offer.id);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-success-soft p-3 ring-1 ring-success/30" data-testid="waitlist-offer">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{t("A slot opened for you")}</p>
          <p className="text-sm text-ink">
            {formatDate(entry.offer.slotStartsAt)} · {formatTime(entry.offer.slotStartsAt)}
          </p>
        </div>
        <div className="shrink-0 text-right" aria-live="polite">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("Held for")}</p>
          <p className={cx("font-mono text-2xl font-extrabold tabular-nums", left < 120_000 ? "text-danger" : "text-success")} data-testid="offer-countdown">
            {mm}:{ss}
          </p>
        </div>
      </div>
      {expired ? (
        <p className="text-sm font-semibold text-muted">{t("This offer has ended. You're still on the waitlist for other slots.")}</p>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" loading={decline.isPending} onClick={() => void doDecline()}>
            {t("Decline")}
          </Button>
          <Button className="flex-1" iconRight="arrowRight" loading={claim.isPending} onClick={() => void doClaim()}>
            {t("Claim & pay")}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">{t("Claiming holds the slot while you pay, as with any booking. It is not booked until payment.")}</p>
      <Alert>{error}</Alert>
    </div>
  );
}

function EntryCard({ entry }: { entry: WaitlistEntry }) {
  const t = useT();
  const leave = useLeaveWaitlist();
  const [error, setError] = useState<string | null>(null);
  async function doLeave() {
    setError(null);
    try {
      await leave.mutateAsync(entry.id);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }
  return (
    <div data-testid="waitlist-entry">
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Icon name="users" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{entry.doctor.fullName}</p>
          <p className="text-sm text-muted">{formatDayKey(entry.date, { weekday: "short", day: "numeric", month: "short" })}</p>
          {entry.patient.accountHolderId && (
            <p className="text-sm font-semibold text-brand-700">{t("For {name}", { name: entry.patient.fullName ?? "" })}</p>
          )}
        </div>
        {!entry.offer && <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{t("#{n} in line", { n: entry.position })}</span>}
      </div>
      {entry.offer && <OfferCard entry={entry as WaitlistEntry & { offer: NonNullable<WaitlistEntry["offer"]> }} />}
      <button type="button" className="text-sm font-semibold text-danger hover:underline disabled:opacity-50" disabled={leave.isPending} onClick={() => void doLeave()}>
        {t("Leave waitlist")}
      </button>
      <Alert>{error}</Alert>
    </Card>
    </div>
  );
}

/** Bookings page: live waitlist entries, with a countdown on any offer. */
export function WaitlistSection() {
  const t = useT();
  const { data: entries } = useMyWaitlist();
  if (!entries || entries.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={t("Waitlist")}>
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
        <Icon name="users" className="h-4 w-4" /> {t("Waitlist")}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </div>
    </section>
  );
}
