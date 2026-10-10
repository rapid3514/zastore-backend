-- Each existing session becomes the root of its own rotation family.
ALTER TABLE "RefreshSession" ADD COLUMN "familyId" UUID;
UPDATE "RefreshSession" SET "familyId" = "id";
ALTER TABLE "RefreshSession" ALTER COLUMN "familyId" SET NOT NULL;
ALTER TABLE "RefreshSession" ADD COLUMN "parentId" UUID;
CREATE UNIQUE INDEX "RefreshSession_parentId_key" ON "RefreshSession"("parentId");
CREATE INDEX "RefreshSession_familyId_revokedAt_idx" ON "RefreshSession"("familyId", "revokedAt");
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RefreshSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
