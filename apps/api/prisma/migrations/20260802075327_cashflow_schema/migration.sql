-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nextRunDate" TIMESTAMP(3),
ADD COLUMN     "templateAccountId" TEXT,
ADD COLUMN     "templateAmount" DECIMAL(18,2),
ADD COLUMN     "templateCategoryId" TEXT,
ADD COLUMN     "templateCurrency" TEXT,
ADD COLUMN     "templateId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_templateId_idx" ON "Transaction"("templateId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_templateAccountId_fkey" FOREIGN KEY ("templateAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_templateCategoryId_fkey" FOREIGN KEY ("templateCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
