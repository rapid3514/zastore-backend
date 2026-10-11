CREATE TABLE "BotAppearanceChange" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotAppearanceChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BotAppearanceChange_scope" CHECK ("scope" IN ('bot', 'super-admin'))
);

CREATE INDEX "BotAppearanceChange_actorId_changedAt_idx" ON "BotAppearanceChange"("actorId", "changedAt");
