-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- Backfill payments received before paidAt existed (captured online, or
-- collected at the desk). The order is created moments before payment, so
-- createdAt is the closest record we have.
UPDATE "Payment" SET "paidAt" = "createdAt"
WHERE "status" IN ('PAID', 'REFUNDED') AND ("gatewayRef" IS NOT NULL OR "method" = 'DESK');
