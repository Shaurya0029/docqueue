-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEAVE_NOW';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "leaveAlertOptedInAt" TIMESTAMP(3),
ADD COLUMN     "leaveAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "leaveAlertSource" TEXT,
ADD COLUMN     "leaveAlertTravelMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

