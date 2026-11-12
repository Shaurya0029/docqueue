import { useEffect, useState } from "react";
import { Alert, Avatar, Button, Card, EmptyState, Field, Input, ClinicPicker, ListHeader, PageHeader, PhoneInput, Section, isValidIndianMobile, stagger, toE164India } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatRupees } from "../../lib/formatters";
import { useClinics, useCreateDoctor, useDeactivateUser, useDoctorsForClinic, useVerifyDoctor, type AdminDoctorRow } from "./hooks";
import { useT } from "../../lib/i18n";

const VERIFICATION_STYLE = {
  APPROVED: "bg-success-soft text-success",
  PENDING: "bg-amber-50 text-amber-700",
  REJECTED: "bg-danger-soft text-danger",
} as const;

/** Registration details plus approve / reject, for one doctor card. */
function VerificationPanel({ doctor, clinicId }: { doctor: AdminDoctorRow; clinicId: string }) {
  const t = useT();
  const verify = useVerifyDoctor(clinicId || undefined);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = { APPROVED: t("Verified"), PENDING: t("Pending verification"), REJECTED: t("Rejected") }[doctor.verificationStatus];

  async function decide(params: { decision: "APPROVE" } | { decision: "REJECT"; reason: string }) {
    setError(null);
    try {
      await verify.mutateAsync({ doctorId: doctor.id, ...params });
      setRejecting(false);
      setReason("");
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="w-full space-y-2 rounded-2xl bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted">
          {doctor.registrationNumber
            ? t("Reg. no. {number}, {council}", { number: doctor.registrationNumber, council: doctor.registrationCouncil ?? "–" })
            : t("No registration number yet")}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${VERIFICATION_STYLE[doctor.verificationStatus]}`}>{label}</span>
      </div>
      {doctor.verificationStatus === "REJECTED" && doctor.rejectionReason && (
        <p className="text-xs text-danger">{t("Reason: {reason}", { reason: doctor.rejectionReason })}</p>
      )}
      {doctor.verificationStatus !== "APPROVED" && doctor.registrationNumber && !rejecting && (
        <div className="flex gap-2">
          <Button size="sm" icon="check" className="flex-1" loading={verify.isPending} onClick={() => void decide({ decision: "APPROVE" })}>
            {t("Approve")}
          </Button>
          {doctor.verificationStatus === "PENDING" && (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setRejecting(true)}>
              {t("Reject")}
            </Button>
          )}
        </div>
      )}
      {rejecting && (
        <div className="space-y-2">
          <Input placeholder={t("Why? e.g. not found on the NMC register")} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Reason for rejecting")} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>
              {t("Back")}
            </Button>
            <Button size="sm" variant="danger" className="flex-1" disabled={reason.trim().length < 3} loading={verify.isPending} onClick={() => void decide({ decision: "REJECT", reason: reason.trim() })}>
              {t("Reject")}
            </Button>
          </div>
        </div>
      )}
      <Alert>{error}</Alert>
    </div>
  );
}

export function DoctorsPage() {
  const t = useT();
  const { data: clinics } = useClinics();
  const [clinicId, setClinicId] = useState<string>("");
  const { data: doctors, refetch } = useDoctorsForClinic(clinicId || undefined);
  const createDoctor = useCreateDoctor();
  const deactivate = useDeactivateUser(clinicId || undefined);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [fee, setFee] = useState(500);
  const [avgMinutes, setAvgMinutes] = useState(15);
  const [regNumber, setRegNumber] = useState("");
  const [regCouncil, setRegCouncil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [credentials, setCredentials] = useState<{ phone: string; password: string } | null>(null);

  useEffect(() => {
    if (clinics && clinics.length > 0 && !clinicId) setClinicId(clinics[0].id);
  }, [clinics, clinicId]);

  async function submit() {
    if (!clinicId) return;
    setError(null);
    try {
      const res = await createDoctor.mutateAsync({
        clinicId,
        phoneNumber: toE164India(phoneNumber),
        fullName,
        specialization,
        consultationFee: fee,
        avgConsultMinutes: avgMinutes,
        ...(regNumber.trim() ? { registrationNumber: regNumber.trim() } : {}),
        ...(regCouncil.trim() ? { registrationCouncil: regCouncil.trim() } : {}),
      });
      setCredentials({ phone: res.loginPhone, password: res.tempPassword });
      setPhoneNumber("");
      setFullName("");
      setSpecialization("");
      setRegNumber("");
      setRegCouncil("");
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const phoneInvalid = submitted && !isValidIndianMobile(phoneNumber);
  const nameInvalid = submitted && fullName.trim().length < 2;
  const specInvalid = submitted && specialization.trim().length < 2;
  const feeInvalid = !Number.isFinite(fee) || fee < 0;
  const minutesInvalid = !Number.isFinite(avgMinutes) || avgMinutes < 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Admin")}
        title={t("Doctors")}
        subtitle={t("Add doctors and manage who can take bookings.")}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Section title={t("Add a doctor")} icon="stethoscope" className="h-fit">
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (isValidIndianMobile(phoneNumber) && fullName.trim().length >= 2 && specialization.trim().length >= 2 && !feeInvalid && !minutesInvalid)
                void submit().then(() => setSubmitted(false));
            }}
          >
            <Field label={t("Mobile number")} error={phoneInvalid ? t("Enter a valid 10-digit mobile number") : null}>
              <PhoneInput value={phoneNumber} onChange={setPhoneNumber} invalid={phoneInvalid} />
            </Field>
            <Field label={t("Full name")} error={nameInvalid ? t("At least 2 characters") : null}>
              <Input placeholder="Dr. Ananya Sharma" value={fullName} aria-invalid={nameInvalid || undefined} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label={t("Specialization")} error={specInvalid ? t("At least 2 characters") : null}>
              <Input placeholder="Cardiologist" value={specialization} aria-invalid={specInvalid || undefined} onChange={(e) => setSpecialization(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Fee (₹)")} error={feeInvalid ? t("Invalid amount") : null}>
                <Input type="number" min={0} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
              </Field>
              <Field label={t("Avg minutes")} error={minutesInvalid ? t("At least 1") : null}>
                <Input type="number" min={1} value={avgMinutes} onChange={(e) => setAvgMinutes(Number(e.target.value))} />
              </Field>
            </div>
            <Field label={t("Registration number")} hint={t("Optional now; needed before you can verify the doctor.")}>
              <Input placeholder="KMC-12345" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
            </Field>
            <Field label={t("Medical council")}>
              <Input placeholder={t("e.g. Karnataka Medical Council")} value={regCouncil} onChange={(e) => setRegCouncil(e.target.value)} />
            </Field>
            <Alert>{error}</Alert>
            <Alert tone="success">
              {credentials && (
                <>
                  {t("Created. Login")} <span className="font-mono">{credentials.phone}</span> · {t("temp password")}{" "}
                  <span className="font-mono font-bold">{credentials.password}</span>
                </>
              )}
            </Alert>
            <Button type="submit" icon="check" className="w-full" disabled={!clinicId} loading={createDoctor.isPending}>
              {t("Create doctor")}
            </Button>
          </form>
        </Section>

        <div className="min-w-0 space-y-3">
          <ListHeader title={t("Doctors")} count={doctors?.length}>
            <ClinicPicker clinics={clinics ?? []} value={clinicId} onChange={setClinicId} />
          </ListHeader>
          {doctors?.length === 0 && <EmptyState icon="stethoscope" title={t("No doctors in this clinic yet")} />}
          {doctors?.map((doctor, i) => (
            <Card key={doctor.id} className="flex animate-fade-up flex-wrap items-center gap-x-4 gap-y-3" style={stagger(i)}>
              <Avatar name={doctor.fullName} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{doctor.fullName}</p>
                <p className="text-sm text-muted">
                  {doctor.specialization} · {formatRupees(doctor.consultationFee)}
                </p>
              </div>
              <VerificationPanel doctor={doctor} clinicId={clinicId} />
              <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${doctor.isActive ? "bg-success-soft text-success" : "bg-slate-100 text-slate-500"}`}
              >
                {doctor.isActive ? t("Active") : t("Inactive")}
              </span>
              {doctor.isActive && (
                <Button variant="ghost" size="sm" className="!text-danger hover:!bg-danger-soft" onClick={() => deactivate.mutate(doctor.userId, { onSuccess: () => refetch() })}>
                  {t("Deactivate")}
                </Button>
              )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
