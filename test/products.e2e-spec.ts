import {
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfigService } from './helpers/config.js';
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
  Prisma,
  ProductAvailabilityStatus,
  ProductMediaType,
  TelegramProductSyncStatus,
  UserRole,
} from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { ProductTelegramPublisherService } from '../src/modules/products/product-telegram-publisher.service.js';
import { ProductsController } from '../src/modules/products/products.controller.js';
import { ProductsRepository } from '../src/modules/products/products.repository.js';
import { ProductsService } from '../src/modules/products/products.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';

const product = {
  id: productId,
  name: 'Burger',
  description: null,
  price: new Prisma.Decimal('12000.00'),
  cargoPrice: null,
  imageUrl: null,
  categoryId,
  category: { id: categoryId, name: 'Burgerlar', slug: 'burgerlar' },
  availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
  version: 0,
  createdAt: new Date('2026-09-24T00:00:00.000Z'),
  updatedAt: new Date('2026-09-24T00:00:00.000Z'),
};

describe('ProductsController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const repository = {
    findCategoryById: vi.fn(),
    countOrderItems: vi.fn(),
    list: vi.fn(),
    findPublicById: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    createWithMedia: vi.fn(),
    createInTransaction: vi.fn(),
    createWithMediaInTransaction: vi.fn(),
    update: vi.fn(),
    replaceMedia: vi.fn(),
    updateInTransaction: vi.fn(),
    replaceMediaInTransaction: vi.fn(),
    removeOrDeactivate: vi.fn(),
    delete: vi.fn(),
  };
  const mediaService = {
    verifyProductImage: vi.fn(),
    verifyProductMedia: vi.fn(),
    deleteImageIfUnreferenced: vi.fn(),
    withReservedAssets: vi.fn(),
  };
  const telegramPublisher = {
    syncAfterCreate: vi.fn(),
    syncAfterUpdate: vi.fn(),
    syncManually: vi.fn(),
    deletePostBestEffort: vi.fn(),
    deleteProductPostsBestEffort: vi.fn(),
    removeProductPostsBestEffort: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [ProductsController],
      providers: [
        ProductsService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ProductsRepository, useValue: repository },
        { provide: MediaService, useValue: mediaService },
        {
          provide: ProductTelegramPublisherService,
          useValue: telegramPublisher,
        },
        { provide: AuditService, useValue: { log: vi.fn() } },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: createConfigService() },
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
    repository.findCategoryById.mockResolvedValue({
      id: categoryId,
      isActive: true,
    });
    repository.countOrderItems.mockResolvedValue(0);
    repository.removeOrDeactivate.mockResolvedValue({ product, softDeleted: false });
    repository.list.mockResolvedValue({ data: [product], total: 1 });
    repository.findPublicById.mockResolvedValue(product);
    repository.findById.mockResolvedValue(product);
    repository.create.mockResolvedValue(product);
    repository.createInTransaction.mockImplementation(
      (_transaction: unknown, data: Record<string, unknown>) => repository.create(data),
    );
    repository.createWithMedia.mockImplementation(
      (data: Record<string, unknown>, media: Record<string, unknown>[]) =>
        Promise.resolve({
          ...product,
          ...data,
          media: media.map((item, index) => ({
            id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
            productId,
            ...item,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          telegramMessages: [],
        }),
    );
    repository.createWithMediaInTransaction.mockImplementation(
      (_transaction: unknown, data: Record<string, unknown>, media: Record<string, unknown>[]) => repository.createWithMedia(data, media),
    );
    repository.update.mockResolvedValue({
      ...product,
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });
    repository.updateInTransaction.mockImplementation(
      (_transaction: unknown, id: string, data: Record<string, unknown>, version: number) => repository.update(id, data, version),
    );
    repository.replaceMediaInTransaction.mockImplementation(
      (_transaction: unknown, id: string, data: Record<string, unknown>, media: Record<string, unknown>[], version: number) => repository.replaceMedia(id, data, media, version),
    );
    repository.delete.mockResolvedValue(product);
    mediaService.verifyProductImage.mockResolvedValue({
      fileId: 'verified-file',
      url: 'https://ik.imagekit.io/account/products/verified.jpg',
      filePath: '/products/verified.jpg',
      mime: 'image/jpeg',
      size: 100,
    });
    mediaService.verifyProductMedia.mockImplementation(
      (item: { type: ProductMediaType; fileId: string }) =>
        Promise.resolve({
          type: item.type,
          fileId: item.fileId,
          url: `https://ik.imagekit.io/account/products/${item.fileId}`,
          filePath: `/products/${item.fileId}`,
          mime:
            item.type === ProductMediaType.IMAGE ? 'image/jpeg' : 'video/mp4',
          size: 100,
          width: 1000,
          height: 800,
        }),
    );
    mediaService.deleteImageIfUnreferenced.mockResolvedValue(true);
    mediaService.withReservedAssets.mockImplementation(
      (_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({}),
    );
    telegramPublisher.syncAfterCreate.mockImplementation((value) =>
      Promise.resolve(value),
    );
    telegramPublisher.syncAfterUpdate.mockImplementation((value) =>
      Promise.resolve(value),
    );
    telegramPublisher.syncManually.mockImplementation((value) =>
      Promise.resolve(value),
    );
    telegramPublisher.deletePostBestEffort.mockResolvedValue(undefined);
    telegramPublisher.deleteProductPostsBestEffort.mockResolvedValue(undefined);
    telegramPublisher.removeProductPostsBestEffort.mockResolvedValue(undefined);
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: userId, telegramId: '123456789', role, type: 'access' },
      { secret, expiresIn: '5m', issuer: 'zastore-shop', audience: 'zastore-mini-app', algorithm: 'HS256' },
    );
  }

  const createInput = { name: 'Burger', price: 12000, categoryId };

  it('lets a guest and a customer view the public list and product', async () => {
    const guest = await request(app.getHttpServer())
      .get('/api/v1/products?page=1&limit=20')
      .expect(200);
    expect(guest.body.data[0]).toMatchObject({
      id: productId,
      price: '12000.00',
    });
    expect(guest.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(repository.list).toHaveBeenCalledWith({ page: 1, limit: 20 }, false);

    await request(app.getHttpServer())
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/products/${productId}`)
      .expect(200);
  });

  it('rejects customer create and allows ADMIN and SUPER_ADMIN create', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .send(createInput)
      .expect(403);

    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      usersService.findById.mockResolvedValue({
        id: userId,
        role,
        isBlocked: false,
      });
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token(role)}`)
        .send(createInput)
        .expect(201);
    }
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Burger',
        price: 12000,
        categoryId,
        availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
      }),
    );
  });

  it('returns 404 for an unknown category and 400 for invalid price', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    repository.findCategoryById.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send(createInput)
      .expect(404);
    expect(repository.create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, price: -1 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, price: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, name: undefined })
      .expect(400);
  });

  it('requires cargo price only for products arriving in 14 days', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    const arriving = ProductAvailabilityStatus.ARRIVING_IN_14_DAYS;

    for (const input of [
      { ...createInput, availabilityStatus: arriving },
      { ...createInput, availabilityStatus: arriving, cargoPrice: 0 },
      { ...createInput, cargoPrice: 5000 },
      {
        ...createInput,
        availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
        cargoPrice: 5000,
      },
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', authorization)
        .send(input)
        .expect(400);
    }
    expect(repository.create).not.toHaveBeenCalled();

    repository.create.mockImplementationOnce((data) =>
      Promise.resolve({
        ...product,
        ...data,
        price: new Prisma.Decimal(data.price),
        cargoPrice: new Prisma.Decimal(data.cargoPrice),
      }),
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({
        ...createInput,
        availabilityStatus: arriving,
        cargoPrice: '5000.50',
      })
      .expect(201);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        availabilityStatus: arriving,
        cargoPrice: 5000.5,
      }),
    );
    expect(response.body.cargoPrice).toBe('5000.50');
    repository.findPublicById.mockResolvedValueOnce({
      ...product,
      availabilityStatus: arriving,
      cargoPrice: new Prisma.Decimal('5000.50'),
    });
    const publicResponse = await request(app.getHttpServer())
      .get(`/api/v1/products/${productId}`)
      .expect(200);
    expect(publicResponse.body.cargoPrice).toBe('5000.50');
  });

  it('creates with verified ImageKit metadata and Telegram success', async () => {
    const pending = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
      imageFileId: 'verified-file',
      telegramChannelMessageId: null,
      telegramPublishedAt: null,
      telegramSyncedAt: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    };
    repository.create.mockResolvedValueOnce(pending);
    telegramPublisher.syncAfterCreate.mockResolvedValueOnce({
      ...pending,
      telegramChannelMessageId: 91,
      telegramPublishedAt: new Date(),
      telegramSyncedAt: new Date(),
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({
        ...createInput,
        image: {
          fileId: 'verified-file',
          url: 'https://attacker.example/not-trusted.jpg',
        },
      })
      .expect(201);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageFileId: 'verified-file',
        imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
      }),
    );
    expect(telegramPublisher.syncAfterCreate).toHaveBeenCalledOnce();
    expect(response.body).toMatchObject({
      imageFileId: 'verified-file',
      telegramChannelMessageId: 91,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    });
  });

  it('persists media[] with authoritative URLs and returns admin media', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({
        ...createInput,
        media: [
          {
            type: ProductMediaType.IMAGE,
            fileId: 'image-one',
            url: 'https://attacker.example/image.jpg',
            position: 0,
          },
          {
            type: ProductMediaType.VIDEO,
            fileId: 'video-one',
            url: 'https://attacker.example/video.mp4',
            position: 0,
          },
        ],
      })
      .expect(201);

    expect(repository.createWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://ik.imagekit.io/account/products/image-one',
      }),
      [
        expect.objectContaining({
          type: ProductMediaType.IMAGE,
          fileId: 'image-one',
          url: 'https://ik.imagekit.io/account/products/image-one',
        }),
        expect.objectContaining({
          type: ProductMediaType.VIDEO,
          fileId: 'video-one',
          url: 'https://ik.imagekit.io/account/products/video-one',
        }),
      ],
    );
    expect(response.body.media).toEqual([
      expect.objectContaining({
        type: ProductMediaType.IMAGE,
        fileId: 'image-one',
      }),
      expect.objectContaining({
        type: ProductMediaType.VIDEO,
        fileId: 'video-one',
      }),
    ]);
  });

  it('rejects duplicate, mixed legacy/new, 6-image, and 2-video requests', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    const image = (index: number) => ({
      type: ProductMediaType.IMAGE,
      fileId: `image-${index}`,
      url: `https://frontend.example/image-${index}.jpg`,
      position: index,
    });
    const video = (index: number) => ({
      type: ProductMediaType.VIDEO,
      fileId: `video-${index}`,
      url: `https://frontend.example/video-${index}.mp4`,
      position: index,
    });

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({
        ...createInput,
        media: [image(0), { ...image(1), fileId: 'image-0' }],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({
        ...createInput,
        image: { fileId: 'legacy', url: 'https://frontend.example/legacy.jpg' },
        media: [image(0)],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({
        ...createInput,
        media: Array.from({ length: 6 }, (_, index) => image(index)),
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, media: [video(0), video(1)] })
      .expect(400);
  });

  it('keeps a created product when Telegram publishing fails', async () => {
    const pending = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
      imageFileId: 'verified-file',
      telegramChannelMessageId: null,
      telegramPublishedAt: null,
      telegramSyncedAt: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    };
    repository.create.mockResolvedValueOnce(pending);
    telegramPublisher.syncAfterCreate.mockResolvedValueOnce({
      ...pending,
      telegramSyncStatus: TelegramProductSyncStatus.FAILED,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({
        ...createInput,
        image: {
          fileId: 'verified-file',
          url: 'https://ik.imagekit.io/account/products/verified.jpg',
        },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: productId,
      telegramSyncStatus: TelegramProductSyncStatus.FAILED,
    });
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it('rejects an unknown ImageKit file before DB create or Telegram publish', async () => {
    mediaService.verifyProductImage.mockRejectedValueOnce(
      new NotFoundException({ error: 'IMAGE_NOT_FOUND' }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({
        ...createInput,
        image: {
          fileId: 'missing-file',
          url: 'https://frontend.example/missing.jpg',
        },
      })
      .expect(404);
    expect(repository.create).not.toHaveBeenCalled();
    expect(telegramPublisher.syncAfterCreate).not.toHaveBeenCalled();
  });

  it('rejects client-controlled Telegram sync fields', async () => {
    const injectedFields = {
      isActive: false,
      telegramChannelMessageId: 999,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
      telegramPublishedAt: new Date().toISOString(),
      telegramSyncedAt: new Date().toISOString(),
    };
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ ...createInput, ...injectedFields })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send(injectedFields)
      .expect(400);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects create and category changes targeting an inactive category', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    repository.findCategoryById.mockResolvedValue({
      id: categoryId,
      isActive: false,
    });

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send(createInput)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .send({ categoryId })
      .expect(400);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('lets ADMIN update availability and delete a product', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .send({ availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK })
      .expect(200);
    expect(response.body.availabilityStatus).toBe(
      ProductAvailabilityStatus.OUT_OF_STOCK,
    );
    expect(repository.update).toHaveBeenCalledWith(productId, {
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    }, 0);

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .expect(204);
    expect(repository.removeOrDeactivate).toHaveBeenCalledWith(productId, 0);
  });

  it('requires cargo price on status change and clears it when leaving 14 days', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    const url = `/api/v1/products/${productId}`;
    const arriving = ProductAvailabilityStatus.ARRIVING_IN_14_DAYS;

    await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', authorization)
      .send({ availabilityStatus: arriving })
      .expect(400);
    expect(repository.update).not.toHaveBeenCalled();

    const arrivingProduct = {
      ...product,
      availabilityStatus: arriving,
      cargoPrice: new Prisma.Decimal('5000.50'),
    };
    repository.update.mockResolvedValueOnce(arrivingProduct);
    const response = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', authorization)
      .send({ availabilityStatus: arriving, cargoPrice: 5000.5 })
      .expect(200);
    expect(response.body.cargoPrice).toBe('5000.50');
    expect(repository.update).toHaveBeenCalledWith(productId, {
      availabilityStatus: arriving,
      cargoPrice: 5000.5,
    }, 0);

    repository.findById.mockResolvedValue(arrivingProduct);
    repository.update.mockResolvedValueOnce({
      ...arrivingProduct,
      name: 'Yangi nom',
    });
    const renamed = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', authorization)
      .send({ name: 'Yangi nom' })
      .expect(200);
    expect(repository.update).toHaveBeenLastCalledWith(productId, {
      name: 'Yangi nom',
    }, 0);
    expect(renamed.body.cargoPrice).toBe('5000.50');

    repository.update.mockResolvedValueOnce({
      ...product,
      availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
    });
    const inStock = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', authorization)
      .send({ availabilityStatus: ProductAvailabilityStatus.IN_STOCK })
      .expect(200);
    expect(repository.update).toHaveBeenLastCalledWith(productId, {
      availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
      cargoPrice: null,
    }, 0);
    expect(inStock.body).not.toHaveProperty('cargoPrice');
  });

  it('lets ADMIN update name, price, and category', async () => {
    const nextCategoryId = '44444444-4444-4444-8444-444444444444';
    repository.findCategoryById.mockResolvedValue({
      id: nextCategoryId,
      isActive: true,
    });
    repository.update.mockResolvedValue({
      ...product,
      name: 'Cheeseburger',
      price: new Prisma.Decimal('15000.00'),
      categoryId: nextCategoryId,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ name: 'Cheeseburger', price: 15000, categoryId: nextCategoryId })
      .expect(200);

    expect(repository.update).toHaveBeenCalledWith(productId, {
      name: 'Cheeseburger',
      price: 15000,
      categoryId: nextCategoryId,
    }, 0);
  });

  it('updates a verified image, syncs Telegram media, then cleans old media', async () => {
    const oldProduct = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/old.jpg',
      imageFileId: 'old-file',
      telegramChannelMessageId: 77,
      telegramPublishedAt: new Date(),
      telegramSyncedAt: new Date(),
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    };
    const updated = {
      ...oldProduct,
      imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
      imageFileId: 'verified-file',
    };
    repository.findById.mockResolvedValueOnce(oldProduct);
    repository.update.mockResolvedValueOnce(updated);
    telegramPublisher.syncAfterUpdate.mockResolvedValueOnce(updated);

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({
        image: {
          fileId: 'verified-file',
          url: 'https://attacker.example/not-trusted.jpg',
        },
      })
      .expect(200);

    expect(repository.update).toHaveBeenCalledWith(productId, {
      imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
      imageFileId: 'verified-file',
    }, 0);
    expect(telegramPublisher.syncAfterUpdate).toHaveBeenCalledWith(
      updated,
      true,
    );
    expect(mediaService.deleteImageIfUnreferenced).toHaveBeenCalledWith(
      'old-file',
    );
  });

  it('manually resyncs an existing product', async () => {
    const synced = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/photo.jpg',
      imageFileId: 'file-1',
      telegramChannelMessageId: 77,
      telegramPublishedAt: new Date(),
      telegramSyncedAt: new Date(),
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    };
    repository.findById.mockResolvedValueOnce(synced);
    telegramPublisher.syncManually.mockResolvedValueOnce(synced);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/telegram/sync`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ forceRepublish: false })
      .expect(200);

    expect(telegramPublisher.syncManually).toHaveBeenCalledWith(synced, false);
    expect(response.body.telegramSyncStatus).toBe(
      TelegramProductSyncStatus.SYNCED,
    );
  });

  it('soft-deletes a product referenced by historical orders', async () => {
    repository.removeOrDeactivate.mockResolvedValue({ product: { ...product, availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK }, softDeleted: true });

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(204);

    expect(repository.removeOrDeactivate).toHaveBeenCalledWith(productId, 0);
  });

  it('lets ADMIN filter products by availability through manage', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/products/manage?availabilityStatus=OUT_OF_STOCK')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    expect(repository.list).toHaveBeenCalledWith({ availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK }, true);
  });

  it('hides sync metadata publicly and returns it through manage', async () => {
    const managedProduct = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/photo.jpg',
      imageFileId: 'file-1',
      telegramChannelMessageId: 77,
      telegramPublishedAt: new Date(),
      telegramSyncedAt: new Date(),
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    };
    repository.list
      .mockResolvedValueOnce({ data: [managedProduct], total: 1 })
      .mockResolvedValueOnce({ data: [managedProduct], total: 1 });

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200);
    expect(publicResponse.body.data[0].imageUrl).toContain(`${managedProduct.imageUrl}?tr=w-480`);
    expect(publicResponse.body.data[0]).not.toHaveProperty('imageFileId');
    expect(publicResponse.body.data[0]).not.toHaveProperty(
      'telegramChannelMessageId',
    );
    expect(publicResponse.body.data[0]).not.toHaveProperty(
      'telegramSyncStatus',
    );

    const manageResponse = await request(app.getHttpServer())
      .get('/api/v1/products/manage')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    expect(manageResponse.body.data[0]).toMatchObject({
      imageFileId: 'file-1',
      telegramChannelMessageId: 77,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    });
  });

  it('returns deterministic public media and editable manage list/detail media', async () => {
    const mediaProduct = {
      ...product,
      imageUrl: 'https://ik.imagekit.io/account/products/one.jpg',
      imageFileId: 'image-one',
      media: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          productId,
          type: ProductMediaType.IMAGE,
          fileId: 'image-one',
          url: 'https://ik.imagekit.io/account/products/one.jpg',
          position: 0,
          mimeType: 'image/jpeg',
          width: 1000,
          height: 800,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      telegramMessages: [],
      telegramChannelMessageId: null,
      telegramPublishedAt: null,
      telegramSyncedAt: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    };
    repository.list.mockResolvedValue({ data: [mediaProduct], total: 1 });
    repository.findById.mockResolvedValue(mediaProduct);
    repository.findPublicById.mockResolvedValue(mediaProduct);

    const publicList = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200);
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/products/${productId}`)
      .expect(200);
    expect(publicList.body.data[0]).not.toHaveProperty('media');
    expect(publicList.body.data[0]).not.toHaveProperty('description');
    expect(publicList.body.data[0].imageVariants.card).toContain('w-480');
    for (const item of [publicDetail.body]) {
      expect(item.media[0]).toMatchObject({
        id: '55555555-5555-4555-8555-555555555555',
        type: ProductMediaType.IMAGE,
        url: 'https://ik.imagekit.io/account/products/one.jpg',
        position: 0,
      });
      expect(item.media[0]).not.toHaveProperty('fileId');
    }

    const manageList = await request(app.getHttpServer())
      .get('/api/v1/products/manage')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    const manageDetail = await request(app.getHttpServer())
      .get(`/api/v1/products/manage/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    for (const item of [manageList.body.data[0], manageDetail.body]) {
      expect(item.media[0]).toMatchObject({
        id: '55555555-5555-4555-8555-555555555555',
        type: ProductMediaType.IMAGE,
        fileId: 'image-one',
        mimeType: 'image/jpeg',
      });
    }
  });
});
