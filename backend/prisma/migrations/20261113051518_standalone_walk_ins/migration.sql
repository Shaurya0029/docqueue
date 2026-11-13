-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "walkInPhone" TEXT;

-- Exactly one of: own login, managed by an account holder, or a separate
-- desk walk-in record with the number given.
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_holder_or_member_check";
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_holder_member_or_walk_in_check"
  CHECK ((("userId" IS NOT NULL)::int + ("accountHolderId" IS NOT NULL)::int + ("walkInPhone" IS NOT NULL)::int) = 1);
