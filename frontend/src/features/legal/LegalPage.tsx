import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Card, Logo, Reveal } from "../../components/ui";
import { useT } from "../../lib/i18n";

type Doc = { title: string; intro: string; sections: { heading: string; body: string }[] };

// NOTE: plain-language summaries of how the app handles data today. Have these reviewed before going live.
const DOCS: Record<"privacy" | "terms", Doc> = {
  privacy: {
    title: "Privacy policy",
    intro: "How MEDORA collects, uses and protects your information.",
    sections: [
      {
        heading: "What we collect",
        body: "Your mobile number (used to sign you in with a one-time code), your name and address if you add them, and the appointments you book — doctor, time slot, queue token and payment status.",
      },
      {
        heading: "How we use it",
        body: "To book and manage your appointments, issue queue tokens, send booking, reminder, queue and refund notifications by SMS, and process payments and refunds through our payment partner.",
      },
      {
        heading: "Location",
        body: "If you choose “Use my current location”, your device's coordinates are sent once to a location lookup service to find your city. Only the city name is kept, on your device.",
      },
      {
        heading: "Who can see it",
        body: "Only the clinic staff (doctors, front-desk associates and clinic admins) of the clinic you book with. Every staff action on patient data is recorded in an audit log.",
      },
      {
        heading: "ID documents",
        body: "If you add an ID document it is stored encrypted and only the last four digits are ever shown.",
      },
      {
        heading: "Your rights",
        body: "Under India's Digital Personal Data Protection (DPDP) Act you have the right to request a copy of your data or its deletion.",
      },
    ],
  },
  terms: {
    title: "Terms of service",
    intro: "The rules for booking and attending appointments through MEDORA.",
    sections: [
      {
        heading: "Bookings",
        body: "A slot is held for you for 10 minutes while you complete payment. If payment isn't completed in that time the slot is released for other patients.",
      },
      {
        heading: "Cancellations & refunds",
        body: "Cancel 2 or more hours before your slot for a full refund to your original payment method. Cancellations made later than that are not refunded.",
      },
      {
        heading: "Queue tokens",
        body: "Your token is issued once payment succeeds. Waiting-time estimates are based on recent consultations and may change; please check in at the front desk with your QR ticket.",
      },
      {
        heading: "No-shows",
        body: "If you are not present when your token is called, the clinic may mark the appointment as a no-show.",
      },
      {
        heading: "Medical advice",
        body: "MEDORA helps you find and book doctors. Medical advice is provided by the doctors and clinics you consult, not by MEDORA.",
      },
    ],
  },
};

export function LegalPage({ doc }: { doc: keyof typeof DOCS }) {
  const t = useT();
  const { title, intro, sections } = DOCS[doc];
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200/70 bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/login" aria-label="MEDORA home">
            <Logo />
          </Link>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            <Icon name="chevronLeft" className="h-4 w-4" /> {t("Back to sign in")}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">{t("Legal")}</p>
          <h1 className="mt-2 text-4xl font-extrabold">{t(title)}</h1>
          <p className="mt-3 text-muted">{t(intro)}</p>
        </Reveal>
        <div className="mt-10 space-y-4">
          {sections.map((s, i) => (
            <Reveal key={s.heading} delay={0.05 * i}>
              <Card className="p-6">
                <h2 className="text-lg font-bold">{t(s.heading)}</h2>
                <p className="mt-2 leading-relaxed text-slate-600">{t(s.body)}</p>
              </Card>
            </Reveal>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted">
          {t("See also:")}{" "}
          <Link to={doc === "privacy" ? "/terms" : "/privacy"} className="font-semibold text-brand-600 hover:underline">
            {doc === "privacy" ? t("Terms of service") : t("Privacy policy")}
          </Link>
        </p>
      </main>
    </div>
  );
}
