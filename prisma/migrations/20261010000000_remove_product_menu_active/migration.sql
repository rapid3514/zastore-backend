DROP INDEX IF EXISTS "Product_categoryId_isActive_idx";
DROP INDEX IF EXISTS "Product_isActive_createdAt_idx";

-- Preserve the non-orderable state of legacy hidden products before the
-- menu-visibility flag is removed.
UPDATE "Product"
SET "availabilityStatus" = 'OUT_OF_STOCK', "cargoPrice" = NULL
WHERE "isActive" = false;

ALTER TABLE "Product" DROP COLUMN "isActive";

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");
