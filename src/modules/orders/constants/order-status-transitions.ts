import { OrderStatus } from '../../../generated/prisma/client.js';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_CONFIRMATION]: [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.EXPIRED]: [],
};
