import {
  ConflictException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
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
import { UserRole } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { MediaController } from '../src/modules/media/media.controller.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('MediaController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const mediaService = {
    getImageKitUploadAuth: vi.fn(),
    deleteUnassignedImage: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [MediaController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: MediaService, useValue: mediaService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      ],
    }).compile();
    jwtService = moduleRef.get(JwtService);
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
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.ADMIN,
      isBlocked: false,
    });
    mediaService.getImageKitUploadAuth.mockReturnValue({
      token: 'token',
      signature: 'signature',
      expire: 123,
      publicKey: 'public_test',
      urlEndpoint: 'https://ik.imagekit.io/account',
      folder: '/products',
    });
    mediaService.deleteUnassignedImage.mockResolvedValue(undefined);
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: userId, telegramId: '123', role },
      { secret, expiresIn: '5m' },
    );
  }

  it('returns signed upload auth to ADMIN without exposing a private key', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/media/imagekit/upload-auth')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    expect(response.body).toMatchObject({
      token: 'token',
      signature: 'signature',
      expire: 123,
      publicKey: 'public_test',
    });
    expect(response.body).not.toHaveProperty('privateKey');
    expect(response.body).not.toHaveProperty('IMAGEKIT_PRIVATE_KEY');
    expect(response.body).not.toHaveProperty('TELEGRAM_BOT_TOKEN');
    expect(response.body).not.toHaveProperty('TELEGRAM_WEBHOOK_SECRET');
  });

  it('returns signed upload auth to SUPER_ADMIN', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.SUPER_ADMIN,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .get('/api/v1/media/imagekit/upload-auth')
      .set('Authorization', `Bearer ${token(UserRole.SUPER_ADMIN)}`)
      .expect(200);
  });

  it('rejects CUSTOMER upload auth', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .get('/api/v1/media/imagekit/upload-auth')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .expect(403);
  });

  it('rejects unauthenticated upload auth', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/media/imagekit/upload-auth')
      .expect(401);
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'allows %s to delete an unreferenced asset',
    async (role) => {
      usersService.findById.mockResolvedValue({
        id: userId,
        role,
        isBlocked: false,
      });
      await request(app.getHttpServer())
        .delete('/api/v1/media/imagekit/file-1')
        .set('Authorization', `Bearer ${token(role)}`)
        .expect(204);
      expect(mediaService.deleteUnassignedImage).toHaveBeenCalledWith('file-1');
    },
  );

  it('returns 409 when the asset is referenced by a product', async () => {
    mediaService.deleteUnassignedImage.mockRejectedValueOnce(
      new ConflictException({ error: 'IMAGE_IN_USE' }),
    );
    await request(app.getHttpServer())
      .delete('/api/v1/media/imagekit/file-1')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(409);
  });

  it('rejects CUSTOMER and unauthenticated media delete', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .delete('/api/v1/media/imagekit/file-1')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/media/imagekit/file-1')
      .expect(401);
    expect(mediaService.deleteUnassignedImage).not.toHaveBeenCalled();
  });
});
