import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IconName } from "../../components/icons";
import { MedicalIllustration } from "../../components/MedicalIllustration";
import { AppearanceButton } from "../../components/AppearancePanel";
import {
  Alert,
  Button,
  Field,
  Input,
  Logo,
  OtpInput,
  PhoneInput,
  Reveal,
  Segmented,
  isValidIndianMobile,
  toE164India,
} from "../../components/ui";
import { api, apiErrorCode, apiErrorMessage } from "../../lib/api";
import { useAuth } from "./AuthContext";
import { useT } from "../../lib/i18n";
import { msg } from "../../lib/i18n";

type Tab = "patient" | "staff";

const EASE = [0.22, 1, 0.36, 1] as const;
const PHONE_ERROR = msg("Enter a valid 10-digit Indian mobile number");

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "search", title: msg("Discover the right doctor"), text: msg("Browse trusted doctors by speciality, see fees and the next free slot at a glance.") },
  { icon: "calendarCheck", title: msg("Book & pay in minutes"), text: msg("Pick a time that suits you and pay securely. Your queue token is issued instantly.") },
  { icon: "ticket", title: msg("Track your token live"), text: msg("See who's being served and your estimated wait, so you arrive just in time.") },
];

const CLINIC_FEATURES: { icon: IconName; text: string }[] = [
  { icon: "qr", text: msg("QR check-in at the front desk") },
  { icon: "queue", text: msg("Live queue board with one-tap “Call next”") },
  { icon: "clock", text: msg("Flexible weekly slot templates") },
  { icon: "wallet", text: msg("Earnings and clinic-wide analytics") },
];

export function LoginPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("patient");
  const cardRef = useRef<HTMLDivElement>(null);

  function openLogin(next: Tab) {
    setTab(next);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden rounded-b-[2.5rem] bg-hero-gradient bg-[length:200%_200%] pb-40 text-white animate-gradient-x sm:pb-52">
        <HeroDecor />

        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <Logo light />
          <nav aria-label="Primary" className="hidden items-center gap-8 text-sm font-semibold text-white/85 md:flex">
            <a href="#how-it-works" className="transition hover:text-white">{t("How it works")}</a>
            <a href="#for-clinics" className="transition hover:text-white">{t("For clinics")}</a>
            <Link to="/privacy" className="transition hover:text-white">{t("Privacy")}</Link>
          </nav>
          <div className="flex items-center gap-2">
          <AppearanceButton tone="onGradient" />
          <Button variant="white" size="sm" icon="lock" onClick={() => openLogin(tab)}>
            {t("Sign in")}
          </Button>
          </div>
        </header>

        <div className="relative z-10 mx-auto max-w-3xl px-5 pt-8 text-center sm:pt-16">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/25 backdrop-blur">
              <Icon name="verified" className="h-4 w-4" />
              {t("Verified doctors · Live queue tracking")}
            </span>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-5 text-[2.1rem] font-extrabold leading-[1.1] tracking-tight text-white sm:mt-6 sm:text-5xl lg:text-6xl">
              {t("Better care starts with the")} <span className="text-sky-200">{t("right doctor.")}</span>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-4 max-w-xl text-[15px] text-white/85 sm:mt-5 sm:text-lg">
              {t("Discover trusted doctors, book appointments and manage your healthcare journey in one place.")}
            </p>
          </Reveal>
          <Reveal delay={0.24} className="mt-7 flex flex-col justify-center gap-3 sm:mt-8 sm:flex-row">
            <Button variant="white" size="lg" icon="search" onClick={() => openLogin("patient")}>
              {t("Find a doctor")}
            </Button>
            <Button
              variant="outline"
              size="lg"
              icon="stethoscope"
              className="!text-white !ring-white/50 hover:!bg-white/10"
              onClick={() => openLogin("staff")}
            >
              {t("I'm clinic staff")}
            </Button>
          </Reveal>
        </div>
      </section>

      {/* ───────── Illustration + floating login card ───────── */}
      <section className="relative z-10 mx-auto -mt-32 grid max-w-6xl items-center gap-10 px-4 sm:-mt-40 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.25 }}
          className="order-2 hidden sm:block lg:order-1"
        >
          <MedicalIllustration />
        </motion.div>

        <motion.div
          ref={cardRef}
          id="login"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
          className="order-1 scroll-mt-6 lg:order-2"
        >
          <LoginCard tab={tab} onTabChange={setTab} />
        </motion.div>
      </section>

      {/* ───────── How it works ───────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-10 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">{t("How it works")}</p>
          <h2 className="mt-2 text-2xl font-extrabold sm:text-4xl">{t("From search to consultation, without the wait")}</h2>
        </div>
        <div className="mt-8 grid gap-4 sm:mt-12 sm:gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, ease: EASE, delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              className="group relative rounded-3xl border border-slate-200/70 bg-surface p-6 shadow-soft transition-shadow hover:shadow-lift"
            >
              <span className="absolute right-6 top-6 text-5xl font-extrabold text-brand-50 transition group-hover:text-brand-100">
                {i + 1}
              </span>
              <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                <Icon name={step.icon} />
              </span>
              <h3 className="relative mt-5 text-lg font-bold">{t(step.title)}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-muted">{t(step.text)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ───────── For clinics ───────── */}
      <section id="for-clinics" className="mx-auto max-w-6xl scroll-mt-10 px-4 pb-14 sm:px-6 sm:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="relative grid gap-8 overflow-hidden rounded-3xl bg-lavender p-6 sm:rounded-[2rem] sm:p-12 md:grid-cols-2 md:items-center"
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-surface/60 blur-2xl" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-700">{t("For clinics")}</p>
            <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">{t("Run a calmer waiting room")}</h2>
            <p className="mt-3 text-muted">
              {t("Doctors, front-desk associates and admins each get a focused workspace — check patients in, call the next token and keep an eye on revenue.")}
            </p>
            <Button className="mt-6" size="lg" icon="stethoscope" onClick={() => openLogin("staff")}>
              {t("Clinic staff login")}
            </Button>
          </div>
          <ul className="relative grid gap-3">
            {CLINIC_FEATURES.map((f) => (
              <li key={f.text} className="flex items-center gap-3 rounded-2xl bg-surface/80 p-4 font-semibold text-ink shadow-soft backdrop-blur">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon name={f.icon} />
                </span>
                {t(f.text)}
              </li>
            ))}
          </ul>
        </motion.div>
      </section>

      <footer className="border-t border-slate-200/80 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="hidden sm:inline">{t("Better care starts with the right doctor.")}</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link to="/privacy" className="font-semibold hover:text-brand-600">{t("Privacy policy")}</Link>
            <Link to="/terms" className="font-semibold hover:text-brand-600">{t("Terms of service")}</Link>
            <span>© {new Date().getFullYear()} MEDORA</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────── Login card ───────────────────────── */

function LoginCard({ tab, onTabChange }: { tab: Tab; onTabChange: (t: Tab) => void }) {
  const t = useT();
  return (
    <div className="relative mx-auto w-full max-w-md rounded-3xl border border-surface bg-surface p-5 shadow-float sm:rounded-[2rem] sm:p-8">
      <div className="mb-6">
        <h2 className="text-xl font-extrabold sm:text-2xl">{t("Welcome to MEDORA")}</h2>
        <p className="mt-1 text-sm text-muted">{t("Sign in to book, track or manage appointments.")}</p>
      </div>

      <Segmented
        value={tab}
        onChange={onTabChange}
        options={[
          { value: "patient", label: t("Patient"), icon: "user" },
          { value: "staff", label: t("Clinic staff"), icon: "stethoscope" },
        ]}
      />

      <div className="mt-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: tab === "patient" ? -24 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === "patient" ? 24 : -24 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {tab === "patient" ? <PatientOtpLogin /> : <StaffLogin />}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted">
        {t("By continuing you agree to MEDORA's")}{" "}
        <Link to="/terms" className="font-semibold text-brand-600 hover:underline">{t("Terms of service")}</Link> {t("and")}{" "}
        <Link to="/privacy" className="font-semibold text-brand-600 hover:underline">{t("Privacy policy")}</Link>.
      </p>
    </div>
  );
}

const RESEND_SECONDS = 30;

function PatientOtpLogin() {
  const t = useT();
  const { loginWithOtp } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const phoneInvalid = phoneTouched && !isValidIndianMobile(phone);
  const nameInvalid = fullName.trim().length > 0 && fullName.trim().length < 2;

  async function requestOtp(e?: FormEvent) {
    e?.preventDefault();
    setPhoneTouched(true);
    if (!isValidIndianMobile(phone)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.post("/auth/otp/request", { phoneNumber: toE164India(phone) });
      setDevOtp(res.data.devOtp ?? null);
      setCode("");
      setStep("otp");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || nameInvalid) return;
    setError(null);
    setBusy(true);
    try {
      await loginWithOtp(toE164India(phone), code, fullName.trim() || undefined, consentNeeded && consent);
      navigate("/");
    } catch (err) {
      if (apiErrorCode(err) === "CONSENT_REQUIRED") {
        // New account: the server kept the code valid; ask for consent and retry.
        setConsentNeeded(true);
        setError(consentNeeded ? t("Please tick the box to agree before continuing.") : null);
        return;
      }
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {step === "phone" ? (
        <motion.form
          key="phone"
          noValidate
          onSubmit={requestOtp}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-4"
        >
          <Field label={t("Mobile number")} error={phoneInvalid ? t(PHONE_ERROR) : null} hint={t("We'll text you a 6-digit verification code.")}>
            <PhoneInput
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (v.length === 10) setPhoneTouched(true);
              }}
              invalid={phoneInvalid}
            />
          </Field>
          <Alert>{error}</Alert>
          <Button type="submit" size="lg" iconRight="arrowRight" className="w-full" loading={busy}>
            {t("Send OTP")}
          </Button>
        </motion.form>
      ) : (
        <motion.form
          key="otp"
          noValidate
          onSubmit={verifyOtp}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm">
            <span className="text-muted">
              {t("Code sent to")} <span className="font-bold text-ink">+91 {phone.slice(0, 5)} {phone.slice(5)}</span>
            </span>
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setStep("phone")}>
              {t("Change")}
            </button>
          </div>
          {devOtp && (
            <Alert tone="warning">
              {t("Dev mode OTP:")} <span className="font-mono font-bold tracking-widest">{devOtp}</span>
            </Alert>
          )}
          <div>
            <span className="label">{t("Verification code")}</span>
            <OtpInput value={code} onChange={setCode} />
          </div>
          <Field label={t("Your name")} hint={t("Only needed the first time you sign in.")} error={nameInvalid ? t("Name must be at least 2 characters") : null}>
            <Input icon="user" placeholder={t("Full name")} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          {consentNeeded && (
            <label className="flex items-start gap-3 rounded-2xl bg-brand-50 p-3 text-sm text-ink ring-1 ring-brand-100">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {t("I agree that MEDORA may store my name, phone number and appointment details to book and manage my visits, as described in the")}{" "}
                <Link to="/privacy" className="font-semibold text-brand-600 underline">{t("Privacy policy")}</Link>.{" "}
                {t("I can download or delete my data at any time from my profile.")}
              </span>
            </label>
          )}
          <Alert>{error}</Alert>
          <Button type="submit" size="lg" icon="shield" className="w-full" disabled={code.length !== 6 || nameInvalid || (consentNeeded && !consent)} loading={busy}>
            {t("Verify & continue")}
          </Button>
          <p className="text-center text-sm text-muted">
            {t("Didn't get it?")}{" "}
            {resendIn > 0 ? (
              <span className="font-semibold tabular-nums">{t("Resend in {s}s", { s: resendIn })}</span>
            ) : (
              <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => requestOtp()} disabled={busy}>
                {t("Resend code")}
              </button>
            )}
          </p>
        </motion.form>
      )}
    </AnimatePresence>
  );
}

function StaffLogin() {
  const t = useT();
  const { loginStaff } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneInvalid = submitted && !isValidIndianMobile(phone);
  const passwordInvalid = submitted && password.length < 6;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!isValidIndianMobile(phone) || password.length < 6) return;
    setError(null);
    setBusy(true);
    try {
      await loginStaff(toE164India(phone), password);
      navigate("/");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <Field label={t("Mobile number")} error={phoneInvalid ? t(PHONE_ERROR) : null}>
        <PhoneInput value={phone} onChange={setPhone} invalid={phoneInvalid} />
      </Field>
      <Field label={t("Password")} error={passwordInvalid ? t("Password must be at least 6 characters") : null}>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            icon="lock"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={passwordInvalid || undefined}
            className="pr-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            aria-label={showPassword ? t("Hide password") : t("Show password")}
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink"
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} className="h-[18px] w-[18px]" />
          </button>
        </div>
      </Field>
      <Alert>{error}</Alert>
      <Button type="submit" size="lg" iconRight="arrowRight" className="w-full" loading={busy}>
        {t("Log in")}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <Icon name="shield" className="h-3.5 w-3.5" />
        {t("For doctors, front-desk associates and clinic admins")}
      </p>
    </form>
  );
}

/* ───────────────────────── Hero decoration ───────────────────────── */

function HeroDecor() {
  const crosses = [
    { cls: "left-[6%] top-[28%] h-10 w-10 hidden md:block", d: 0 },
    { cls: "right-[8%] top-[20%] h-14 w-14 hidden md:block", d: 1.2 },
    { cls: "left-[14%] bottom-[34%] h-7 w-7 hidden md:block", d: 2.1 },
    { cls: "right-[18%] bottom-[40%] h-8 w-8 hidden md:block", d: 0.6 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* large soft shapes like the reference's curved panel */}
      <svg className="absolute -right-40 -top-32 h-[42rem] w-[42rem] text-white/[0.07]" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="100" fill="currentColor" />
      </svg>
      <svg className="absolute -bottom-40 -left-32 h-[30rem] w-[30rem] text-sky-200/10" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="100" fill="currentColor" />
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      {crosses.map((c, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 24 24"
          className={`absolute text-white/25 ${c.cls}`}
          animate={{ y: [0, -14, 0], rotate: [0, 8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: c.d }}
        >
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" />
        </motion.svg>
      ))}
    </div>
  );
}
