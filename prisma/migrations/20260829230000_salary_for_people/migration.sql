-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SALARY';

-- CreateTable
CREATE TABLE "TransactionPerson" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "TransactionPerson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionPerson_personId_idx" ON "TransactionPerson"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionPerson_transactionId_personId_key" ON "TransactionPerson"("transactionId", "personId");

-- AddForeignKey
ALTER TABLE "TransactionPerson" ADD CONSTRAINT "TransactionPerson_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionPerson" ADD CONSTRAINT "TransactionPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
