-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SLOTS_AVAILABLE';

-- CreateTable
CREATE TABLE "SlotAlert" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "SlotAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlotAlert_doctorId_notifiedAt_idx" ON "SlotAlert"("doctorId", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlotAlert_patientId_doctorId_key" ON "SlotAlert"("patientId", "doctorId");

-- AddForeignKey
ALTER TABLE "SlotAlert" ADD CONSTRAINT "SlotAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotAlert" ADD CONSTRAINT "SlotAlert_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

