import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  type Prisma,
} from '../../generated/prisma/client.js';
import { AuditRepository } from './audit.repository.js';
import type { AuditLogsQueryDto } from './dto/audit-logs-query.dto.js';

export interface AuditInput {
  actorUserId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

const sensitiveKey =
  /password|token|jwt|secret|authorization|signature|private[_-]?key/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly auditRepository: AuditRepository) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.auditRepository.create({
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata
          ? (this.sanitize(input.metadata) as Prisma.InputJsonValue)
          : undefined,
      });
    } catch {
      this.logger.error(
        `Audit log write failed for ${input.action} on ${input.entityType}:${input.entityId}`,
      );
    }
  }

  async list(query: AuditLogsQueryDto) {
    if (
      query.dateFrom &&
      query.dateTo &&
      new Date(query.dateFrom) > new Date(query.dateTo)
    ) {
      throw new BadRequestException({
        error: 'INVALID_DATE_RANGE',
        message: "dateFrom dateTo dan keyin bo'lishi mumkin emas",
      });
    }
    const result = await this.auditRepository.list(query);
    return {
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !sensitiveKey.test(key))
          .map(([key, item]) => [key, this.sanitize(item)]),
      );
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'bigint') return value.toString();
    return null;
  }
}
