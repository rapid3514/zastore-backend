-- Unify customers and administrators in the User table without losing
-- existing users, admins, or refresh sessions.
CREATE TYPE "UserRole" AS ENUM ('GUEST', 'CUSTOMER', 'ADMIN', 'SUPER_ADMIN');

ALTER TABLE "User"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'GUEST',
ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET
  "role" = CASE
    WHEN "phone" IS NULL THEN 'GUEST'::"UserRole"
    ELSE 'CUSTOMER'::"UserRole"
  END,
  "isBlocked" = ("status" = 'BLOCKED'::"UserStatus");

INSERT INTO "User" (
  "id",
  "telegramId",
  "firstName",
  "lastName",
  "username",
  "role",
  "isBlocked",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "telegramId",
  "firstName",
  "lastName",
  "username",
  "role"::text::"UserRole",
  NOT "isActive",
  "createdAt",
  "updatedAt"
FROM "Admin"
ON CONFLICT ("telegramId") DO UPDATE SET
  "role" = EXCLUDED."role",
  "isBlocked" = EXCLUDED."isBlocked";

UPDATE "RefreshSession" AS session
SET "userId" = app_user."id"
FROM "Admin" AS admin
JOIN "User" AS app_user
  ON app_user."telegramId" = admin."telegramId"
WHERE session."adminId" = admin."id";

DELETE FROM "RefreshSession" WHERE "userId" IS NULL;

ALTER TABLE "RefreshSession"
DROP CONSTRAINT "RefreshSession_adminId_fkey";

DROP INDEX "RefreshSession_adminId_idx";

ALTER TABLE "RefreshSession"
DROP COLUMN "adminId",
ALTER COLUMN "userId" SET NOT NULL;

DROP TABLE "Admin";

ALTER TABLE "User" DROP COLUMN "status";

DROP TYPE "AdminRole";
DROP TYPE "UserStatus";
