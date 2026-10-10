ALTER TABLE "Product" ADD CONSTRAINT "Product_positive_price_check" CHECK ("price" > 0) NOT VALID;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_positive_dimensions_check"
  CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)) NOT VALID;
