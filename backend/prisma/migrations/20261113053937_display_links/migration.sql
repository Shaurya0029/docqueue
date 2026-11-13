-- CreateTable
CREATE TABLE "DisplayLink" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DisplayLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisplayLink_tokenHash_key" ON "DisplayLink"("tokenHash");

-- CreateIndex
CREATE INDEX "DisplayLink_doctorId_idx" ON "DisplayLink"("doctorId");

-- AddForeignKey
ALTER TABLE "DisplayLink" ADD CONSTRAINT "DisplayLink_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live (unrevoked) display link per doctor.
CREATE UNIQUE INDEX "DisplayLink_one_live_per_doctor" ON "DisplayLink"("doctorId") WHERE "revokedAt" IS NULL;
