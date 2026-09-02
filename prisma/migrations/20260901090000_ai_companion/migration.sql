-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "provider" TEXT NOT NULL DEFAULT 'glm',
    "model" TEXT NOT NULL DEFAULT 'glm-4.6',
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "webSearch" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMemoryNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMemoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlySnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "cycleEnd" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "report" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChat_userId_updatedAt_idx" ON "AiChat"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_chatId_createdAt_idx" ON "AiMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMemoryNote_userId_idx" ON "AiMemoryNote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_userId_dateKey_key" ON "AiUsage"("userId", "dateKey");

-- CreateIndex
CREATE INDEX "MonthlySnapshot_userId_cycleKey_idx" ON "MonthlySnapshot"("userId", "cycleKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySnapshot_userId_cycleKey_key" ON "MonthlySnapshot"("userId", "cycleKey");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

