import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfigService } from '../../../test/helpers/config.js';
import { OrdersExpirationWorker } from './orders-expiration.worker.js';

describe('OrdersExpirationWorker', () => {
  afterEach(() => vi.useRealTimers());

  it('processes overdue orders immediately after restart and on the configured interval', async () => {
    vi.useFakeTimers();
    const orders = {
      expirePendingOrders: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new OrdersExpirationWorker(
      orders as never,
      createConfigService({ ORDER_EXPIRATION_INTERVAL_MS: 1000 }),
    );
    worker.onModuleInit();
    expect(orders.expirePendingOrders).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(orders.expirePendingOrders).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(orders.expirePendingOrders).toHaveBeenCalledTimes(2);
  });

  it('contains failures and prevents overlapping jobs', async () => {
    let finish: (() => void) | undefined;
    const orders = {
      expirePendingOrders: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const worker = new OrdersExpirationWorker(
      orders as never,
      createConfigService(),
    );
    const running = worker.run();
    await worker.run();
    expect(orders.expirePendingOrders).toHaveBeenCalledOnce();
    finish?.();
    await running;
    orders.expirePendingOrders.mockRejectedValueOnce(
      new Error('DB unavailable'),
    );
    await expect(worker.run()).resolves.toBeUndefined();
    const recovered = worker.run();
    finish?.();
    await recovered;
  });
});
