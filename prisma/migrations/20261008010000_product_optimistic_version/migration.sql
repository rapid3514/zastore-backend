ALTER TABLE "Product" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD CONSTRAINT "Product_version_nonnegative_check" CHECK ("version" >= 0) NOT VALID;
ALTER TABLE "Product" VALIDATE CONSTRAINT "Product_version_nonnegative_check";
