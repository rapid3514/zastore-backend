-- Preserve the existing store background and allow a separate super admin row.
ALTER TABLE "BotAppearance"
    DROP CONSTRAINT "BotAppearance_singleton",
    ADD CONSTRAINT "BotAppearance_scope" CHECK ("id" IN ('bot', 'super-admin'));
