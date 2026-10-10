import {
  NotificationKind,
  OrderStatus,
  UserRole,
  type Prisma,
} from '../../generated/prisma/client.js';

type OutboxOrder = {
  id: string;
  status: OrderStatus;
  user: { telegramId: bigint };
};

export async function enqueueOrderNotifications(
  tx: Prisma.TransactionClient,
  order: OutboxOrder,
  kind: NotificationKind,
): Promise<void> {
  const recipients =
    kind === NotificationKind.NEW_ORDER
      ? await tx.user.findMany({
          where: {
            role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
            isBlocked: false,
          },
          select: { telegramId: true },
        })
      : [{ telegramId: order.user.telegramId }];
  if (!recipients.length) return;
  await tx.notificationOutbox.createMany({
    data: recipients.map(({ telegramId }) => ({
      eventKey: `${order.id}:${kind}:${order.status}:${telegramId.toString()}`,
      orderId: order.id,
      recipient: telegramId,
      kind,
      orderStatus: order.status,
    })),
    skipDuplicates: true,
  });
}
