CREATE TYPE "ProductAvailabilityStatus" AS ENUM (
  'IN_STOCK',
  'ARRIVING_IN_14_DAYS',
  'OUT_OF_STOCK'
);

ALTER TABLE "Product"
ADD COLUMN "availabilityStatus" "ProductAvailabilityStatus" NOT NULL DEFAULT 'IN_STOCK';

UPDATE "Product"
SET "availabilityStatus" = CASE
  WHEN "isAvailable" THEN 'IN_STOCK'::"ProductAvailabilityStatus"
  ELSE 'OUT_OF_STOCK'::"ProductAvailabilityStatus"
END;

ALTER TABLE "Product" DROP COLUMN "isAvailable";

CREATE INDEX "Product_availabilityStatus_idx" ON "Product"("availabilityStatus");
