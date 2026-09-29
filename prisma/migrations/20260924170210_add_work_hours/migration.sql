-- CreateEnum
CREATE TYPE "WeekDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "WorkHour" (
    "id" UUID NOT NULL,
    "dayOfWeek" "WeekDay" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openTime" TEXT,
    "closeTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkHour_dayOfWeek_key" ON "WorkHour"("dayOfWeek");

-- CreateIndex
CREATE INDEX "WorkHour_dayOfWeek_idx" ON "WorkHour"("dayOfWeek");
