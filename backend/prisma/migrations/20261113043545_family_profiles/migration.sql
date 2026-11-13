-- CreateEnum
CREATE TYPE "FamilyRelationship" AS ENUM ('PARENT', 'CHILD', 'SPOUSE', 'OTHER');

-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_userId_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "patientId" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "accountHolderId" TEXT,
ADD COLUMN     "ageRecordedOn" TEXT,
ADD COLUMN     "ageYears" INTEGER,
ADD COLUMN     "dateOfBirth" TEXT,
ADD COLUMN     "relationship" "FamilyRelationship",
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Patient_accountHolderId_idx" ON "Patient"("accountHolderId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_accountHolderId_fkey" FOREIGN KEY ("accountHolderId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every patient is either an account holder (has a login) or a family
-- member (managed by an account holder), never both and never neither.
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_holder_or_member_check"
  CHECK (("userId" IS NULL) <> ("accountHolderId" IS NULL));
