-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'COMMITTEE_PAY';
ALTER TYPE "TransactionType" ADD VALUE 'COMMITTEE_PAYOUT';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "committeeId" TEXT,
ADD COLUMN     "committeeMonth" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "countCommitteesInCap" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Committee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "installmentPkr" DECIMAL(14,2) NOT NULL,
    "totalMembers" INTEGER NOT NULL,
    "potPkr" DECIMAL(14,2) NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "myTurn" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Committee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Committee_userId_idx" ON "Committee"("userId");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

