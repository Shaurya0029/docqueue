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

## Payments

`PAYMENTS_MODE` in `backend/.env`:

- **`stub`** (default): no gateway. "Pay" builds the webhook Razorpay would send, signs it with the webhook secret, and runs it through the same verification code as a real payment. Not allowed when `NODE_ENV=production`.
- **`razorpay`**: real Razorpay. With `rzp_test_` keys this is test mode and no money moves.

A booking is confirmed **only** by Razorpay's signed webhook, never by the browser. To try test mode locally:

1. In `backend/.env` set `PAYMENTS_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a `RAZORPAY_WEBHOOK_SECRET` of your choice.
2. Expose the API: `cloudflared tunnel --url http://localhost:4000` and copy the `https://…trycloudflare.com` URL.
3. In the Razorpay dashboard (test mode), add a webhook for `payment.captured` pointing at `<that URL>/payments/webhook`, with the same secret.
4. Restart the API, book a slot and pay with one of [Razorpay's test cards](https://razorpay.com/docs/payments/payments/test-card-details/).

## Tests

```bash
# Backend unit and API tests (Vitest), against the docqueue_test database
cd backend
DATABASE_URL=postgresql://docqueue:docqueue@localhost:5433/docqueue_test npx prisma migrate deploy   # first time only
npm test
npm run typecheck && npm run lint

# Frontend typecheck, lint and build
cd frontend
npm run lint && npm run build

# End-to-end journey (Playwright): patient books and pays, associate checks in,
# doctor calls next, the patient's ticket must update within 2 seconds.
cd e2e
npm install
npx playwright install chromium   # first time only
npx playwright test
```

The end-to-end test starts its own API (port 4100) and frontend (port 5174) against a separate `docqueue_e2e` database, which is reset and seeded on every run, so it never touches your dev data. It needs Postgres and Redis from `docker compose`, and the dev servers can keep running.

CI (`.github/workflows/ci.yml`) runs all three on every push and pull request.

## How the core flow works

1. **Book.** The patient picks a slot; it is held for 10 minutes while they pay. A background job releases unpaid holds.
2. **Pay.** Razorpay's `payment.captured` webhook (HMAC-signed) confirms the booking. Repeated or parallel deliveries confirm exactly once. A payment that arrives after the hold expired is honoured if the slot is still free, and refunded in full if not.
3. **Token.** The queue token is the slot's position in the doctor's day (10:00 = 1, 10:15 = 2, …), so tokens follow appointment time and reset daily.
4. **Check in.** The associate scans the ticket's QR or types the 8-character code printed under it. Each code works once.
5. **Live queue.** "Call next" publishes through Redis to a WebSocket per doctor. The patient's ticket updates in about a second, and falls back to polling if the socket drops.

## Project layout

```
backend/    Express API, Prisma schema and migrations, seed scripts, Vitest tests
frontend/   React app (src/features/<portal>/), shared UI, i18n (English, Hindi)
e2e/        Playwright journey test
```
