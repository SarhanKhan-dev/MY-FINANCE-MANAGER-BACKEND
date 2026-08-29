-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'BORROW';
ALTER TYPE "TransactionType" ADD VALUE 'LEND';
ALTER TYPE "TransactionType" ADD VALUE 'REPAY_IN';
ALTER TYPE "TransactionType" ADD VALUE 'REPAY_OUT';
ALTER TYPE "TransactionType" ADD VALUE 'WORK_OFFSET';
ALTER TYPE "TransactionType" ADD VALUE 'TAKEN';
ALTER TYPE "TransactionType" ADD VALUE 'WRITE_OFF';
ALTER TYPE "TransactionType" ADD VALUE 'BALANCE_OUT';

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "countLendingInCap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "countWriteOffsInCap" BOOLEAN NOT NULL DEFAULT true;

