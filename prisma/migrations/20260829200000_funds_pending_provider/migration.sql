-- AlterEnum
ALTER TYPE "InvestmentKind" ADD VALUE 'FUND';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "Investment" ADD COLUMN     "provider" TEXT;
