CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Product_name_search_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_description_search_idx" ON "Product" USING GIN ("description" gin_trgm_ops);
