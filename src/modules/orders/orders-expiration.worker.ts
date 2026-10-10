import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConfiguration } from '../../config/configuration.js';
import { OrdersService } from './orders.service.js';

@Injectable()
export class OrdersExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersExpirationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = getConfiguration(this.config).orders.expirationIntervalMs;
    this.timer = setInterval(() => void this.run(), interval);
    this.timer.unref();
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.orders.expirePendingOrders();
    } catch {
      this.logger.error({ event: 'order_expiration_failed' });
    } finally {
      this.running = false;
    }
  }
}
