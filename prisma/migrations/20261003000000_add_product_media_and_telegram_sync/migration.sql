-- CreateEnum
CREATE TYPE "TelegramProductSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "imageFileId" TEXT,
ADD COLUMN "telegramChannelMessageId" INTEGER,
ADD COLUMN "telegramPublishedAt" TIMESTAMP(3),
ADD COLUMN "telegramSyncedAt" TIMESTAMP(3),
ADD COLUMN "telegramSyncStatus" "TelegramProductSyncStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Product_imageFileId_idx" ON "Product"("imageFileId");

-- CreateIndex
CREATE INDEX "Product_telegramSyncStatus_idx" ON "Product"("telegramSyncStatus");
