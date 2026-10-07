-- CreateEnum
CREATE TYPE "ProductMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "ProductMedia" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "ProductMediaType" NOT NULL,
    "fileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTelegramMessage" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "messageId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMedia_productId_fileId_key" ON "ProductMedia"("productId", "fileId");
CREATE UNIQUE INDEX "ProductMedia_productId_type_position_key" ON "ProductMedia"("productId", "type", "position");
CREATE INDEX "ProductMedia_productId_type_position_idx" ON "ProductMedia"("productId", "type", "position");
CREATE INDEX "ProductMedia_fileId_idx" ON "ProductMedia"("fileId");
CREATE UNIQUE INDEX "ProductTelegramMessage_productId_messageId_key" ON "ProductTelegramMessage"("productId", "messageId");
CREATE UNIQUE INDEX "ProductTelegramMessage_productId_position_key" ON "ProductTelegramMessage"("productId", "position");
CREATE INDEX "ProductTelegramMessage_productId_position_idx" ON "ProductTelegramMessage"("productId", "position");

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTelegramMessage" ADD CONSTRAINT "ProductTelegramMessage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
