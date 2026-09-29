ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "User_role_lastSeenAt_idx" ON "User"("role", "lastSeenAt");
