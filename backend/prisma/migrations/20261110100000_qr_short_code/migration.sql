-- AlterTable
ALTER TABLE "QrToken" ADD COLUMN     "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QrToken_shortCode_key" ON "QrToken"("shortCode");

