import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RateLimitStorage } from '../../common/security/rate-limit.storage.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimitStorage: RateLimitStorage,
  ) {}

  async check() {
    const [databaseProbe, redisProbe] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.rateLimitStorage.ping(),
    ]);
    const database = databaseProbe.status === 'fulfilled' ? 'up' : 'down';
    const redis = redisProbe.status === 'fulfilled' ? 'up' : 'down';
    const timestamp = new Date().toISOString();
    if (database === 'down' || redis === 'down') {
      this.logger.error('Dependency health check failed');
      throw new ServiceUnavailableException({
        status: 'error',
        database,
        redis,
        timestamp,
      });
    }
    return {
      status: 'ok' as const,
      database,
      redis,
      timestamp,
      version: 'v3-order-sizes',
    };
  }
}
