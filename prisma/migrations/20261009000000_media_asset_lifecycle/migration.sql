CREATE TYPE "MediaAssetStatus" AS ENUM ('ACTIVE', 'DELETE_PENDING', 'DELETED');

CREATE TABLE "MediaAsset" (
  "fileId" TEXT NOT NULL,
  "status" "MediaAssetStatus" NOT NULL DEFAULT 'ACTIVE',
  "deleteRequestedAt" TIMESTAMP(3),
  "deleteLeaseExpiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("fileId")
);

CREATE INDEX "MediaAsset_status_deleteRequestedAt_idx"
  ON "MediaAsset"("status", "deleteRequestedAt");

-- Preserve the lifecycle of every media asset already referenced by catalog
-- records before the application begins enforcing deletion leases.
INSERT INTO "MediaAsset" ("fileId", "status")
SELECT DISTINCT "imageFileId", 'ACTIVE'::"MediaAssetStatus"
FROM "Product"
WHERE "imageFileId" IS NOT NULL
ON CONFLICT ("fileId") DO NOTHING;

INSERT INTO "MediaAsset" ("fileId", "status")
SELECT DISTINCT "fileId", 'ACTIVE'::"MediaAssetStatus"
FROM "ProductMedia"
ON CONFLICT ("fileId") DO NOTHING;
