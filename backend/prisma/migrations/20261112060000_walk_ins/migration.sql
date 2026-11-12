-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'DESK');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "isWalkIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "consentSource" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'ONLINE';


-- Existing patients consented in the app.
UPDATE "Patient" SET "consentSource" = 'app' WHERE "consentAt" IS NOT NULL;
