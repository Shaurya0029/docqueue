-- DropIndex
DROP INDEX "Appointment_doctorId_queueDate_queueToken_key";

-- DropIndex
DROP INDEX "Appointment_slotId_key";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "gatewayOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_slotId_idx" ON "Appointment"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayOrderId_key" ON "Payment"("gatewayOrderId");


-- Hand-written: uniqueness only among active (not cancelled) appointments,
-- so a released slot can be booked again and keeps its slot-time token.
CREATE UNIQUE INDEX "Appointment_active_slot_key" ON "Appointment"("slotId")
  WHERE "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "Appointment_active_token_key" ON "Appointment"("doctorId", "queueDate", "queueToken")
  WHERE "status" <> 'CANCELLED' AND "queueToken" IS NOT NULL;
