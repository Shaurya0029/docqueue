# MEDORA (DocQueue)

Doctor appointments with a live queue: patients book and pay for a slot, get a QR ticket, check in at the clinic desk, and watch their place in line update in real time.

Four portals share one app:

| Portal | Who | What they do |
| --- | --- | --- |
| Patient | anyone with a phone | Search doctors, book, pay, QR ticket, live queue position |
| Doctor | clinic doctors | Today's queue, call next, slots, schedule, earnings |
| Associate | front desk | Check patients in (QR scan or typed code), run the queue board |
| Admin | clinic owner | Clinics, doctors, associates, overview, audit log |

**Stack:** Node 22, Express, TypeScript, Prisma, PostgreSQL 16, Redis 7 (backend); React, Vite, Tailwind (frontend); Vitest and Playwright (tests). All clinic times are IST.

## Setup

Prerequisites: Node 22 and Docker.

```bash
# 1. Postgres (port 5433) and Redis (port 6380)
docker compose up -d postgres redis

# 2. Backend
cd backend
cp .env.example .env          # defaults work for local development
npm install
npx prisma migrate deploy
npm run seed                  # demo data; safe to run again
npm run dev                   # API on http://localhost:4000

# 3. Frontend (second terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                   # app on http://localhost:5173
```

## Seeded test accounts

Staff log in with phone and password on the **Clinic staff** tab. Patients use the **Patient** tab with an OTP; in stub SMS mode the OTP is always `123456`.

| Role | Phone | Password | Notes |
| --- | --- | --- | --- |
| Admin | 9800000001 | password123 | Owns Peppermint Family Clinic |
| Doctor | 9800000002 | password123 | Dr. Asha Mehta, General Physician |
| Doctor | 9800000005 | password123 | Dr. Rohan Iyer, Pediatrician |
| Doctor | 9800000006 | password123 | Dr. Neha Rao, Dermatologist |
| Associate | 9800000003 | password123 | Front desk for all three doctors |
| Patient | 9800000004 | OTP 123456 | Rahul Sharma |
| Patient | 9800000007 | OTP 123456 | Priya Nair |

The seed gives every doctor 15-minute slots, Monday to Friday, 10:00 to 17:00 IST, for the next 14 days. Run `npm run seed` again to top the slots up.

## SMS and OTP

`SMS_MODE` in `backend/.env`:

- **`stub`** (default): messages are printed to the API log (`[sms:console] ...`) and the OTP is always `123456`. Refused when `NODE_ENV=production`.
- **`live`**: sends through `SMS_PROVIDER`. No provider is implemented yet: add a class implementing `SmsProvider` in `backend/src/lib/sms/` and a case in `getSmsProvider()`.

OTPs are stored hashed in Redis for 5 minutes. Limits: 5 requests per phone per hour, 100 per IP per hour, and 5 wrong guesses per code. Behind a load balancer, set `TRUST_PROXY=1` so the per-IP limit sees the patient's IP.

## Payments

`PAYMENTS_MODE` in `backend/.env`:

- **`stub`** (default): no gateway. "Pay" builds the webhook Razorpay would send, signs it with the webhook secret, and runs it through the same verification code as a real payment. Not allowed when `NODE_ENV=production`.
- **`razorpay`**: real Razorpay. With `rzp_test_` keys this is test mode and no money moves.

A booking is confirmed **only** by Razorpay's signed webhook, never by the browser. To try test mode locally:

1. In `backend/.env` set `PAYMENTS_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a `RAZORPAY_WEBHOOK_SECRET` of your choice.
2. Expose the API: `cloudflared tunnel --url http://localhost:4000` and copy the `https://…trycloudflare.com` URL.
3. In the Razorpay dashboard (test mode), add a webhook for `payment.captured` pointing at `<that URL>/payments/webhook`, with the same secret.
4. Restart the API, book a slot and pay with one of [Razorpay's test cards](https://razorpay.com/docs/payments/payments/test-card-details/).

## Waiting-room board links

Each doctor can have one TV link (`/display/<token>`, no login). The token is 256 random bits; the database keeps its SHA-256 for lookups and an AES-256-GCM-encrypted copy so staff can view the link again in Settings.

- `BOARD_LINK_KEY` in `backend/.env`: the encryption key, 32 bytes base64 (`openssl rand -base64 32`). **Required in production**: the API refuses to start without it. Locally a fixed dev key is used if it is unset.
- Changing the key makes saved links unreadable in Settings (they keep working on the TV). Regenerate them.
- Board requests are limited per link and IP (several TVs behind one clinic IP each get their own allowance), plus a per-IP cap on unknown links.

## Admin analytics

Admin portal → **Analytics**, for the admin's own clinics only: bookings by hour and weekday, no-show rate and average consult time per doctor, revenue by day, summary cards, and a CSV export of the same aggregates. No response, chart or export carries patient names, numbers, family members or appointment ids. Every view and export is audit-logged.

Definitions (also on each chart under "How is this calculated?"):

- Days and hours are IST (Asia/Kolkata); date ranges are inclusive in IST. Visits count on the IST day of their slot.
- **No-show rate** = NO_SHOW / (COMPLETED + NO_SHOW); cancelled and still-open bookings excluded; "Not enough data" under 10.
- **Average consult time** = mean of (completed − called) for completed visits, skipping anything under 1 or over 120 minutes (the wait-time rule); "Not enough data" under 5 visits.
- **Revenue** = paid payments minus refunds, by the IST date the payment was received (`Payment.paidAt`), in rupees: gross, refunded and net.
- **Peak hours** = non-cancelled bookings by slot start hour.

### Demo data for analytics

```bash
cd backend
npm run seed:demo          # ~3 months of synthetic history: "[DEMO DATA] Analytics Demo Clinic", 6 doctors, ~22,000 appointments
npm run seed:demo:remove   # deletes everything it created
```

The demo clinic belongs to the dev admin (+919800000001). Demo doctors and patients have numbers starting `+917000` and cannot log in. It refuses to run with `NODE_ENV=production`.

## Background jobs

The API runs these on a timer; each is safe to run on several instances at once.

| Job | Every | What it does |
| --- | --- | --- |
| Release expired holds | 1 min | Cancels bookings unpaid after 10 minutes and frees the slot |
| Reminders | 1 min | Texts patients whose slot starts within the hour, once |
| Close past days | 15 min | Marks bookings from earlier days that never checked in as no-show; closes the day |

## Tests

```bash
# Backend unit and API tests (Vitest), against the docqueue_test database
cd backend
DATABASE_URL=postgresql://docqueue:docqueue@localhost:5433/docqueue_test npx prisma migrate deploy   # first time only
npm test
npm run typecheck && npm run lint

# Frontend typecheck, lint, Hindi coverage and build
cd frontend
npm run lint && npm run i18n:check && npm run build

# End-to-end journey (Playwright): patient books and pays, associate checks in,
# doctor calls next, the patient's ticket must update within 2 seconds.
cd e2e
npm install
npx playwright install chromium   # first time only
npx playwright test
```

The end-to-end test starts its own API (port 4100) and frontend (port 5174) against a separate `docqueue_e2e` database, which is reset and seeded on every run, so it never touches your dev data. It needs Postgres and Redis from `docker compose`, and the dev servers can keep running.

CI (`.github/workflows/ci.yml`) runs all three on every push and pull request.

`npm run i18n:check` fails if any patient-facing string lacks Hindi. Wrap English strings shown on screen in `t("...")`, and strings kept in constants (menu labels, status names) in `msg("...")`, then add the Hindi to `frontend/src/lib/i18n.hi.ts`. `node scripts/check-i18n.mjs --all` also lists the staff portals' gaps.

## How the core flow works

1. **Book.** The patient picks a slot; it is held for 10 minutes while they pay. A background job releases unpaid holds.
2. **Pay.** Razorpay's `payment.captured` webhook (HMAC-signed) confirms the booking. Repeated or parallel deliveries confirm exactly once. A payment that arrives after the hold expired is honoured if the slot is still free, and refunded in full if not.
3. **Token.** The queue token is the slot's position in the doctor's day (10:00 = 1, 10:15 = 2, …), so tokens follow appointment time and reset daily.
4. **Check in.** The associate scans the ticket's QR or types the 8-character code printed under it. Each code works once.
5. **Walk-ins.** The associate adds a patient without the app (name, phone, spoken consent); they take the doctor's next free slot today and get their token by SMS.
6. **Live queue.** "Call next" publishes through Redis to a WebSocket per doctor. The patient's ticket updates in about a second, and falls back to polling if the socket drops.

## Patient features

- **Cancel:** full refund 2+ hours before the slot, none after. The clinic can cancel with a full refund, or refund a late cancellation anyway.
- **Reschedule:** to another free slot of the same doctor, up to 2 hours before; new token and QR.
- **Notifications by SMS** (each logged, each sent once): booking confirmed, 1-hour reminder, "you are 3rd in line", cancelled, refund issued, slots opened.
- **No slots?** "Notify me when slots open" or "Show next available doctor".
- **Verified doctors only:** patients see and book a doctor only after the clinic admin approves their medical registration (unverified or inactive doctors are hidden from search and cannot be booked, rescheduled into, or given walk-ins).
- **Hindi** throughout the patient portal (Appearance & language menu), English as fallback.
- **Your data (DPDP):** download everything held about you, or delete your account, from Profile. Deletion erases identity and keeps anonymous visit and payment records for the clinic's accounts.

## Wait-time estimate

A patient's estimated wait = patients still waiting ahead of them × the doctor's average consultation time (`backend/src/lib/waitTime.ts`).

- The average is the mean of the doctor's **last 20 real consultations**: called and then completed, lasting 1 to 120 minutes. Shorter is a mis-tap; longer is a consultation nobody closed until much later.
- With **fewer than 5** real consultations it falls back to the doctor's configured average (Settings).
- The ticket says which basis it used; the doctor's Settings page shows their measured average.

## Privacy and access rules

- Every doctor-scoped query uses the doctor allowed by the login token, never a URL parameter. Tests try every staff route as the wrong doctor, an unassigned associate, another clinic's admin and a patient.
- Staff changes to patient data are audited, and so are staff views of queues and schedules (once per staff member per 15 minutes).
- ID numbers are stored as the last 4 digits only.
- Deleted patients and deactivated staff lose access immediately.

## Project layout

```
backend/    Express API, Prisma schema and migrations, seed scripts, Vitest tests
frontend/   React app (src/features/<portal>/), shared UI, i18n (English, Hindi)
e2e/        Playwright journey test
```
