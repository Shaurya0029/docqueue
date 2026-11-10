import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 0 core journey, one browser session per role:
 * patient searches, books and pays -> sees QR ticket -> associate checks the
 * patient in -> doctor calls next -> the patient's live ticket updates within
 * 2 seconds -> doctor completes the consultation.
 *
 * Data comes from backend/prisma/e2e-seed.ts: Dr. Kavya Menon has exactly one
 * slot, a few minutes from now, so this runs on today's queue at any hour.
 */
const DOCTOR = "Dr. Kavya Menon";
const PATIENT_PHONE = "9800000004";
const PATIENT_NAME = "Rahul Sharma";
const ASSOCIATE_PHONE = "9800000003";
const DOCTOR_PHONE = "9800000008";

async function patientLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(PATIENT_PHONE);
  await page.getByRole("button", { name: "Send OTP" }).click();
  await page.getByLabel("Digit 1").click();
  await page.keyboard.type("123456"); // stub SMS mode's fixed OTP
  await page.getByRole("button", { name: /Verify/ }).click();
  await expect(page).toHaveURL(/\/patient$/);
}

async function staffLogin(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Clinic staff" }).click();
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toBeVisible();
  // The patient form animates out; fill the staff form's own phone field.
  const phoneField = page.locator("form").filter({ has: password }).getByLabel("Mobile number");
  await phoneField.fill(phone);
  await password.fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
}

test("patient books and pays, associate checks in, doctor calls next, ticket updates live", async ({ browser }) => {
  const newPage = async () => (await browser.newContext()).newPage();
  const patient = await newPage();
  const associate = await newPage();
  const doctor = await newPage();

  await test.step("patient searches, books and pays", async () => {
    await patientLogin(patient);
    await patient.getByPlaceholder("Search doctor by name").fill("Kavya");
    const card = patient.locator('a[href^="/patient/doctor/"]', { hasText: DOCTOR });
    await expect(card).toBeVisible();
    await card.click();

    await patient.getByRole("button", { name: /^\d{1,2}:\d{2}/ }).first().click();
    await patient.getByRole("button", { name: /Reserve & pay/ }).click();
    await expect(patient).toHaveURL(/\/patient\/book\//);
    await patient.getByRole("button", { name: /Pay .* securely/ }).click();
    await expect(patient).toHaveURL(/\/patient\/ticket\//, { timeout: 30_000 });
  });

  const code = await test.step("patient sees the QR ticket", async () => {
    await expect(patient.getByText("Booked").first()).toBeVisible();
    await expect(patient.getByRole("img", { name: "Check-in QR code" })).toBeVisible();
    const shown = patient.getByTestId("checkin-code");
    await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    return (await shown.innerText()).trim();
  });

  await test.step("associate checks the patient in", async () => {
    await staffLogin(associate, ASSOCIATE_PHONE);
    await expect(associate).toHaveURL(/\/associate/);
    await associate.locator('select[aria-label="Doctor"]:visible').selectOption({ label: DOCTOR });
    await associate.getByLabel("Or type the check-in code").fill(code);
    await associate.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(associate.getByText("Checked in", { exact: true })).toBeVisible();
    await expect(associate.getByText(PATIENT_NAME)).toBeVisible();

    // The same code cannot be used twice.
    await associate.getByRole("button", { name: "Scan next" }).click();
    await associate.getByLabel("Or type the check-in code").fill(code);
    await associate.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(associate.getByText("QR code already used")).toBeVisible();
  });

  await test.step("doctor calls next and the patient's ticket updates within 2 seconds", async () => {
    await staffLogin(doctor, DOCTOR_PHONE);
    await expect(doctor).toHaveURL(/\/doctor/);
    const callNext = doctor.getByRole("button", { name: /Call next/ });
    await expect(callNext).toBeEnabled();
    // The ticket's live socket must be connected before we measure.
    await expect(patient.getByText("Live", { exact: true }).first()).toBeVisible();

    const started = Date.now();
    await callNext.click();
    await expect(patient.getByText("It's your turn!")).toBeVisible({ timeout: 2_000 });
    const elapsed = Date.now() - started;
    console.log(`patient ticket updated ${elapsed} ms after Call next`);
    expect(elapsed).toBeLessThan(2_000);
    await expect(patient.getByText("In consultation").first()).toBeVisible();
  });

  await test.step("doctor completes the consultation", async () => {
    await doctor.getByRole("button", { name: "Complete" }).first().click();
    await expect(patient.getByText("Completed").first()).toBeVisible({ timeout: 5_000 });
  });
});
