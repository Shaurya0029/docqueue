import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Card, Logo, Reveal } from "../../components/ui";
import { useT } from "../../lib/i18n";
import { msg } from "../../lib/i18n";

type Doc = { title: string; intro: string; sections: { heading: string; body: string }[] };

// NOTE: plain-language summaries of how the app handles data today. Have these reviewed before going live.
const DOCS: Record<"privacy" | "terms", Doc> = {
  privacy: {
    title: msg("Privacy policy"),
    intro: msg("How MEDORA collects, uses and protects your information."),
    sections: [
      {
        heading: msg("What we collect"),
        body: msg("Your mobile number (used to sign you in with a one-time code), your name and address if you add them, and the appointments you book — doctor, time slot, queue token and payment status."),
      },
      {
        heading: msg("How we use it"),
        body: msg("To book and manage your appointments, issue queue tokens, send booking, reminder, queue and refund notifications by SMS, and process payments and refunds through our payment partner."),
      },
      {
        heading: msg("Location"),
        body: msg("If you choose “Use my current location”, your device's coordinates are sent once to a location lookup service to find your city. Only the city name is kept, on your device."),
      },
      {
        heading: msg("Leave-now alerts"),
        body: msg("Only if you turn them on for a booking. Your device's location is read once and sent to us to estimate your travel time to the clinic (if the clinic uses a route-planning service, it is also passed to that service once for the same purpose); we keep only the number of minutes, never the location itself, and it is not written to any log. You can type or correct the minutes yourself, turn the alert off at any time, and the minutes are included in your data download and erased if you delete your account."),
      },
      {
        heading: msg("Family members"),
        body: msg("You can add family members and book for them. For each one we keep their name, how they are related to you, their age or date of birth if you give it, your consent and their bookings. Their reminders come to your phone and name them. The clinic sees the family member as the patient and gets only your phone number to reach you. Family members are in your data download; you can remove any of them at any time, which erases their data, and deleting your account removes them all."),
      },
      {
        heading: msg("Children under 18"),
        body: msg("For a family member under 18 you act as their parent or legal guardian and give consent on their behalf; we record that you did and when. We collect no tracking or behavioural data about children: a child's visit never uses location (leave-now alerts take only the travel time you type), and their data is never used for profiling or advertising."),
      },
      {
        heading: msg("Who can see it"),
        body: msg("Only the clinic staff (doctors, front-desk associates and clinic admins) of the clinic you book with. Every staff action on patient data is recorded in an audit log."),
      },
      {
        heading: msg("ID documents"),
        body: msg("If you add an ID number (such as Aadhaar), only its last four digits are stored. The full number is never saved."),
      },
      {
        heading: msg("Your rights"),
        body: msg("Under India's Digital Personal Data Protection (DPDP) Act you can download all your data or delete your account at any time from your Profile. Deleting erases your name, phone number, address and messages; clinics keep visit and payment records without your name, as accounting law requires."),
      },
    ],
  },
  terms: {
    title: msg("Terms of service"),
    intro: msg("The rules for booking and attending appointments through MEDORA."),
    sections: [
      {
        heading: msg("Bookings"),
        body: msg("A slot is held for you for 10 minutes while you complete payment. If payment isn't completed in that time the slot is released for other patients."),
      },
      {
        heading: msg("Cancellations & refunds"),
        body: msg("Cancel 2 or more hours before your slot for a full refund to your original payment method. Cancellations made later than that are not refunded. If the clinic cancels, you are always refunded in full."),
      },
      {
        heading: msg("Rescheduling"),
        body: msg("You can move a booking to another free slot with the same doctor up to 2 hours before it. Your payment carries over and you get a new token and QR code."),
      },
      {
        heading: msg("Queue tokens"),
        body: msg("Your token is issued once payment succeeds and follows your appointment time. Waiting-time estimates are based on recent consultations and may change; please check in at the front desk with your QR ticket."),
      },
      {
        heading: msg("No-shows"),
        body: msg("If you are not present when your token is called, the clinic may mark the appointment as a no-show."),
      },
      {
        heading: msg("Medical advice"),
        body: msg("MEDORA helps you find and book doctors. Medical advice is provided by the doctors and clinics you consult, not by MEDORA."),
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
