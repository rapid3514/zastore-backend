import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import {
  AuditAction,
  AuditEntityType,
  UserRole,
} from '../src/generated/prisma/client.js';
import { AuditController } from '../src/modules/audit/audit.controller.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('AuditController (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let databaseRole = UserRole.SUPER_ADMIN;
  const users = {
    findById: vi.fn(() =>
      Promise.resolve({ id: userId, role: databaseRole, isBlocked: false }),
    ),
  };
  const audit = { list: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [AuditController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: UsersService, useValue: users },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      ],
    }).compile();
    jwt = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    databaseRole = UserRole.SUPER_ADMIN;
    audit.list.mockResolvedValue({ data: [], meta: { total: 0 } });
  });
  afterAll(async () => app.close());

  function authorization(role: UserRole) {
    return `Bearer ${jwt.sign(
      { sub: userId, telegramId: '123', role },
      { secret, expiresIn: '5m' },
    )}`;
  }

  it('lets SUPER_ADMIN filter and paginate audit logs', async () => {
    await request(app.getHttpServer())
      .get(
        `/api/v1/audit-logs?page=2&limit=10&action=${AuditAction.ORDER_CONFIRM}&entityType=${AuditEntityType.ORDER}`,
      )
      .set('Authorization', authorization(UserRole.SUPER_ADMIN))
      .expect(200);
    expect(audit.list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      action: AuditAction.ORDER_CONFIRM,
      entityType: AuditEntityType.ORDER,
    });
  });

  it.each([UserRole.ADMIN, UserRole.CUSTOMER])('denies %s', async (role) => {
    databaseRole = role;
    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', authorization(role))
      .expect(403);
  });
});
