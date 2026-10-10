ALTER TABLE "Order" ADD COLUMN "idempotencyKey" UUID;
ALTER TABLE "Order" ADD COLUMN "requestHash" CHAR(64);
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");
CREATE INDEX "Order_status_confirmationDeadline_idx" ON "Order"("status", "confirmationDeadline");
ALTER TABLE "Order" ADD CONSTRAINT "Order_idempotency_pair_check" CHECK (("idempotencyKey" IS NULL) = ("requestHash" IS NULL)) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_idempotency_pair_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_amount_nonnegative_check" CHECK ("subtotal" >= 0 AND "total" >= 0) NOT VALID;
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_amount_nonnegative_check";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_valid_check" CHECK ("quantity" BETWEEN 1 AND 1000) NOT VALID;
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_quantity_valid_check";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amount_nonnegative_check" CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0 AND "lineTotal" = "unitPrice" * "quantity") NOT VALID;
ALTER TABLE "OrderItem" VALIDATE CONSTRAINT "OrderItem_amount_nonnegative_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonnegative_check" CHECK ("amount" >= 0) NOT VALID;
ALTER TABLE "Payment" VALIDATE CONSTRAINT "Payment_amount_nonnegative_check";
ALTER TABLE "WorkHour" ADD CONSTRAINT "WorkHour_valid_interval_check" CHECK (NOT "isOpen" OR ("openTime" IS NOT NULL AND "closeTime" IS NOT NULL AND "openTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "closeTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "openTime" < "closeTime")) NOT VALID;
ALTER TABLE "WorkHour" VALIDATE CONSTRAINT "WorkHour_valid_interval_check";

CREATE TYPE "NotificationKind" AS ENUM ('NEW_ORDER', 'ORDER_STATUS', 'ORDER_REJECTED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'UNCERTAIN');
CREATE TABLE "NotificationOutbox" (
  "id" UUID NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "eventKey" TEXT NOT NULL,
  "orderId" UUID NOT NULL,
  "recipient" BIGINT NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "orderStatus" "OrderStatus" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "claimToken" UUID,
  "deliveredAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationOutbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NotificationOutbox_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "NotificationOutbox_eventKey_key" ON "NotificationOutbox"("eventKey");
CREATE UNIQUE INDEX "NotificationOutbox_sequence_key" ON "NotificationOutbox"("sequence");
CREATE INDEX "NotificationOutbox_status_availableAt_idx" ON "NotificationOutbox"("status", "availableAt");
CREATE INDEX "NotificationOutbox_status_claimedAt_idx" ON "NotificationOutbox"("status", "claimedAt");
CREATE INDEX "NotificationOutbox_orderId_idx" ON "NotificationOutbox"("orderId");
