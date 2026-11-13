import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { authRouter, meRouter } from "./routes/auth";
import { patientRouter } from "./routes/patient";
import { doctorsRouter } from "./routes/doctors";
import { appointmentsRouter } from "./routes/appointments";
import { paymentsRouter } from "./routes/payments";
import { qrRouter } from "./routes/qr";
import { queueRouter } from "./routes/queue";
import { doctorSettingsRouter } from "./routes/doctorSettings";
import { adminRouter } from "./routes/admin";
import { waitlistRouter } from "./routes/waitlist";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();
  if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString();
      },
    })
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/me", meRouter);
  app.use("/me/patient", patientRouter);
  app.use("/doctors", doctorsRouter);
  app.use("/appointments", appointmentsRouter);
  app.use("/payments", paymentsRouter);
  app.use("/appointments/qr", qrRouter);
  app.use(doctorSettingsRouter); // /doctors/:id/slots, /slots/:id, /doctors/:id, /doctors/:id/earnings
  app.use(queueRouter); // /doctors/:id/queue, /appointments/doctor/:id/call-next, etc.
  app.use(waitlistRouter); // /waitlist/..., /doctors/:id/waitlist
  app.use(adminRouter); // /clinics, /admin/overview, /admin/audit-log

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
