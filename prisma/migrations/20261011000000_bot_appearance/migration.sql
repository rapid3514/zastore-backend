CREATE TABLE "BotAppearance" (
    "id" TEXT NOT NULL DEFAULT 'bot',
    "backgroundFileId" TEXT,
    "backgroundUrl" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotAppearance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BotAppearance_singleton" CHECK ("id" = 'bot'),
    CONSTRAINT "BotAppearance_background_pair" CHECK (
        ("backgroundFileId" IS NULL) = ("backgroundUrl" IS NULL)
    )
);

CREATE INDEX "BotAppearance_backgroundFileId_idx" ON "BotAppearance"("backgroundFileId");
