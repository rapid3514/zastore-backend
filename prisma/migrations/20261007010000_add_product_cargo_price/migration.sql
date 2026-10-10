ALTER TABLE "Product" ADD COLUMN "cargoPrice" DECIMAL(10,2);

ALTER TABLE "Product" ADD CONSTRAINT "Product_cargoPrice_only_for_arriving_check"
CHECK (
  "cargoPrice" IS NULL OR
  (
    "availabilityStatus" = 'ARRIVING_IN_14_DAYS'::"ProductAvailabilityStatus" AND
    "cargoPrice" > 0
  )
);

-- Existing 14-day products may need their cargo price filled by an admin.
-- NOT VALID keeps those records while enforcing the rule on new writes.
ALTER TABLE "Product" ADD CONSTRAINT "Product_arriving_cargo_price_required_check"
CHECK (
  "availabilityStatus" <> 'ARRIVING_IN_14_DAYS'::"ProductAvailabilityStatus" OR
  "cargoPrice" IS NOT NULL
) NOT VALID;
