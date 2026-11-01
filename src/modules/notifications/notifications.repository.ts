import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  NotificationDeliveryStatus,
  UserRole,
} from '../../generated/prisma/client.js';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findNotificationAdmins() {
    return this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        isBlocked: false,
      },
      select: { telegramId: true },
    });
  }

  async claimNext(now: Date, claimToken: string) {
    return this.prisma.$transaction(async (tx) => {
      // A crashed sender may have delivered before losing its lease. Quarantine it.
      await tx.notificationOutbox.updateMany({
        where: {
          status: NotificationDeliveryStatus.PROCESSING,
          claimedAt: { lt: new Date(now.getTime() - 120_000) },
        },
        data: {
          status: NotificationDeliveryStatus.UNCERTAIN,
          lastErrorCode: 'WORKER_DELIVERY_INTERRUPTED',
        },
      });
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT n."id" FROM "NotificationOutbox" n WHERE n."status" = 'PENDING'::"NotificationDeliveryStatus" AND n."availableAt" <= ${now}
        AND NOT EXISTS (SELECT 1 FROM "NotificationOutbox" earlier WHERE earlier."orderId" = n."orderId" AND earlier."recipient" = n."recipient" AND earlier."sequence" < n."sequence" AND earlier."status" IN ('PENDING'::"NotificationDeliveryStatus", 'PROCESSING'::"NotificationDeliveryStatus"))
        ORDER BY n."sequence" LIMIT 1 FOR UPDATE OF n SKIP LOCKED`;
      const row = rows[0];
      if (!row) return null;
      return tx.notificationOutbox.update({
        where: { id: row.id, status: NotificationDeliveryStatus.PENDING },
        data: {
          status: NotificationDeliveryStatus.PROCESSING,
          attempts: { increment: 1 },
          claimedAt: now,
          claimToken,
        },
        include: {
          order: {
            include: {
              user: {
                select: {
                  telegramId: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
              items: {
                orderBy: { createdAt: 'asc' },
                include: {
                  product: {
                    select: {
                      imageUrl: true,
                      imageFileId: true,
                      media: {
                        where: { type: 'IMAGE' },
                        orderBy: { position: 'asc' },
                        take: 1,
                        select: { url: true, fileId: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });
  }

  markDelivered(id: string, claimToken: string, now: Date) {
    return this.prisma.notificationOutbox.updateMany({
      where: { id, claimToken, status: NotificationDeliveryStatus.PROCESSING },
      data: {
        status: NotificationDeliveryStatus.SENT,
        deliveredAt: now,
        lastErrorCode: null,
      },
    });
  }

  markFailed(
    id: string,
    claimToken: string,
    status: NotificationDeliveryStatus,
    code: string,
    availableAt: Date,
  ) {
    return this.prisma.notificationOutbox.updateMany({
      where: { id, claimToken, status: NotificationDeliveryStatus.PROCESSING },
      data: { status, lastErrorCode: code, availableAt },
    });
  }
}
