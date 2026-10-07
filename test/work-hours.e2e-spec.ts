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
import { UserRole, WeekDay } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { WorkHoursController } from '../src/modules/work-hours/work-hours.controller.js';
import { WorkHoursService } from '../src/modules/work-hours/work-hours.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('WorkHoursController (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let databaseRole = UserRole.ADMIN;
  const users = {
    findById: vi.fn(() =>
      Promise.resolve({ id: userId, role: databaseRole, isBlocked: false }),
    ),
  };
  const service = {
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    getCurrentStatus: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [WorkHoursController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: UsersService, useValue: users },
        { provide: WorkHoursService, useValue: service },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      ],
    }).compile();
    jwt = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    databaseRole = UserRole.ADMIN;
    service.updateSchedule.mockResolvedValue([]);
  });

  afterAll(async () => app.close());

  function authorization(role: UserRole) {
    return `Bearer ${jwt.sign(
      { sub: userId, telegramId: '123', role },
      { secret, expiresIn: '5m' },
    )}`;
  }

  it('allows ADMIN to update a validated schedule', async () => {
    const body = [
      {
        dayOfWeek: WeekDay.MONDAY,
        isOpen: true,
        openTime: '09:00',
        closeTime: '18:00',
      },
    ];
    await request(app.getHttpServer())
      .put('/api/v1/work-hours/manage')
      .set('Authorization', authorization(UserRole.ADMIN))
      .send(body)
      .expect(200);

    expect(service.updateSchedule).toHaveBeenCalledWith(body, userId);
  });

  it.each([UserRole.CUSTOMER, UserRole.SUPER_ADMIN])(
    'denies %s according to the exact-role policy',
    async (role) => {
      databaseRole = role;
      await request(app.getHttpServer())
        .put('/api/v1/work-hours/manage')
        .set('Authorization', authorization(role))
        .send([])
        .expect(403);
    },
  );

  it.each([
    ['invalid weekday', { dayOfWeek: 'FUNDAY', isOpen: false }],
    [
      'invalid open time',
      {
        dayOfWeek: WeekDay.MONDAY,
        isOpen: true,
        openTime: '25:00',
        closeTime: '18:00',
      },
    ],
    [
      'invalid close time',
      {
        dayOfWeek: WeekDay.MONDAY,
        isOpen: true,
        openTime: '09:00',
        closeTime: '18:99',
      },
    ],
  ])('rejects %s', async (_label, entry) => {
    await request(app.getHttpServer())
      .put('/api/v1/work-hours/manage')
      .set('Authorization', authorization(UserRole.ADMIN))
      .send([entry])
      .expect(400);
    expect(service.updateSchedule).not.toHaveBeenCalled();
  });
});
