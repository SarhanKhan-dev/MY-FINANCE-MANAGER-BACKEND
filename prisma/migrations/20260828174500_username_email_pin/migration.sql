-- AlterTable
ALTER TABLE "AdminAuditLog" DROP COLUMN "actorEmail",
DROP COLUMN "targetEmail",
ADD COLUMN     "actorUsername" TEXT NOT NULL,
ADD COLUMN     "targetUsername" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "username" TEXT NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

