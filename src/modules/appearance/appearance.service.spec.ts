import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceService } from './appearance.service.js';

describe('AppearanceService', () => {
  const current = { backgroundUrl: 'https://ik.imagekit.io/shop/products/background.webp', updatedAt: new Date() };
  const prisma = {
    botAppearance: { findUnique: vi.fn(), upsert: vi.fn() },
    botAppearanceChange: { findMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const media = {
    verifyProductImage: vi.fn(),
    withReservedAssets: vi.fn(),
    deleteImageIfUnreferenced: vi.fn(),
  };
  let service: AppearanceService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.botAppearance.findUnique.mockResolvedValue({ backgroundFileId: 'old-background' });
    prisma.botAppearance.upsert.mockResolvedValue(current);
    prisma.botAppearanceChange.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((operation) => operation(prisma));
    media.verifyProductImage.mockResolvedValue({ fileId: 'new-background', url: current.backgroundUrl });
    media.withReservedAssets.mockImplementation((_assets, operation) => operation(prisma));
    media.deleteImageIfUnreferenced.mockResolvedValue(true);
    service = new AppearanceService(prisma as never, media as never);
  });

  it('returns the default before any background has been set', async () => {
    prisma.botAppearance.findUnique.mockResolvedValueOnce(null);
    expect(await service.findPublic()).toEqual({ backgroundUrl: null, updatedAt: null });
    expect(prisma.botAppearance.findUnique).toHaveBeenCalledWith({
      where: { id: 'bot' }, select: { backgroundUrl: true, updatedAt: true },
    });
  });

  it('saves the provider URL under media reservation, then cleans the old file', async () => {
    const input = { background: { fileId: 'new-background', url: 'https://untrusted.example/image.png' } };
    expect(await service.update(input, 'admin-id')).toEqual(current);
    expect(media.verifyProductImage).toHaveBeenCalledWith(input.background);
    expect(media.withReservedAssets).toHaveBeenCalledWith(
      [{ fileId: 'new-background', url: current.backgroundUrl }], expect.any(Function),
    );
    expect(prisma.botAppearance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { backgroundFileId: 'new-background', backgroundUrl: current.backgroundUrl, updatedById: 'admin-id' },
    }));
    expect(media.deleteImageIfUnreferenced).toHaveBeenCalledWith('old-background');
    expect(prisma.botAppearance.upsert.mock.invocationCallOrder[0]).toBeLessThan(media.deleteImageIfUnreferenced.mock.invocationCallOrder[0]);
  });

  it('resets in a transaction and removes the old image only after saving', async () => {
    await service.update({ background: null }, 'admin-id');
    expect(media.verifyProductImage).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.botAppearance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { backgroundFileId: null, backgroundUrl: null, updatedById: 'admin-id' },
    }));
    expect(media.deleteImageIfUnreferenced).toHaveBeenCalledWith('old-background');
  });

  it('does not remove the saved file when reapplying the same image', async () => {
    prisma.botAppearance.findUnique.mockResolvedValueOnce({ backgroundFileId: 'new-background' });
    await service.update({ background: { fileId: 'new-background', url: current.backgroundUrl } }, 'admin-id');
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('leaves the current background intact when provider validation fails', async () => {
    media.verifyProductImage.mockRejectedValueOnce(new Error('Invalid image'));
    await expect(service.update({ background: { fileId: 'bad-file', url: current.backgroundUrl } }, 'admin-id')).rejects.toThrow('Invalid image');
    expect(prisma.botAppearance.upsert).not.toHaveBeenCalled();
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('leaves the old image intact when the database save fails', async () => {
    prisma.botAppearance.upsert.mockRejectedValueOnce(new Error('Database failure'));
    await expect(service.update({ background: { fileId: 'new-background', url: current.backgroundUrl } }, 'admin-id')).rejects.toThrow('Database failure');
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('reads only the super admin background without falling back to the store background', async () => {
    prisma.botAppearance.findUnique.mockResolvedValueOnce(null);
    expect(await service.findSuperAdmin()).toEqual({ backgroundUrl: null, updatedAt: null });
    expect(prisma.botAppearance.findUnique).toHaveBeenCalledWith({
      where: { id: 'super-admin' }, select: { backgroundUrl: true, updatedAt: true },
    });
  });

  it.each([false, true])('saves or resets only the super admin row (reset: %s)', async (reset) => {
    const input = { background: reset ? null : { fileId: 'new-background', url: current.backgroundUrl } };
    await service.update(input, 'super-admin-id', 'super-admin');
    expect(prisma.botAppearance.findUnique).toHaveBeenCalledWith({ where: { id: 'super-admin' } });
    expect(prisma.botAppearance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'super-admin' },
      create: expect.objectContaining({ id: 'super-admin', updatedById: 'super-admin-id' }),
    }));
  });

  it('records successful changes after saving, within the same transaction', async () => {
    await service.update({ background: { fileId: 'new-background', url: current.backgroundUrl } }, 'admin-id');
    expect(prisma.botAppearanceChange.create).toHaveBeenCalledWith({
      data: { actorId: 'admin-id', scope: 'bot', changedAt: expect.any(Date) },
    });
    expect(prisma.botAppearance.upsert.mock.invocationCallOrder[0]).toBeLessThan(prisma.botAppearanceChange.create.mock.invocationCallOrder[0]);
  });

  it.each(['bot', 'super-admin'] as const)('rejects the sixth change in 30 days for %s without changing or deleting images', async (scope) => {
    prisma.botAppearanceChange.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ changedAt: new Date() })));
    await expect(service.update({ background: null }, 'admin-id', scope)).rejects.toMatchObject({
      status: 429, response: { error: 'BACKGROUND_CHANGE_LIMIT', limit: { remaining: 0, used: 5 } },
    });
    expect(prisma.botAppearance.upsert).not.toHaveBeenCalled();
    expect(prisma.botAppearanceChange.create).not.toHaveBeenCalled();
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('allows the fifth change and counts restoring the default as a change', async () => {
    prisma.botAppearanceChange.findMany.mockResolvedValue(Array.from({ length: 4 }, () => ({ changedAt: new Date() })));
    await service.update({ background: null }, 'admin-id');
    expect(prisma.botAppearance.upsert).toHaveBeenCalled();
    expect(prisma.botAppearanceChange.create).toHaveBeenCalledOnce();
  });

  it('does not charge a no-op or a failed database save', async () => {
    prisma.botAppearance.findUnique.mockResolvedValueOnce({ backgroundFileId: 'new-background', ...current });
    prisma.botAppearanceChange.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ changedAt: new Date() })));
    await service.update({ background: { fileId: 'new-background', url: current.backgroundUrl } }, 'admin-id');
    expect(prisma.botAppearance.upsert).not.toHaveBeenCalled();
    expect(prisma.botAppearanceChange.create).not.toHaveBeenCalled();
    prisma.botAppearanceChange.findMany.mockResolvedValue([]);
    prisma.botAppearance.upsert.mockRejectedValueOnce(new Error('Database failure'));
    await expect(service.update({ background: null }, 'admin-id')).rejects.toThrow('Database failure');
    expect(prisma.botAppearanceChange.create).not.toHaveBeenCalled();
  });

  it('uses a rolling 30-day window for the current account and reports the next available slot', async () => {
    const now = new Date('2026-11-11T10:00:00Z');
    const oldest = new Date('2026-10-13T12:00:00Z');
    prisma.botAppearanceChange.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ changedAt: oldest })));
    const limit = await service.getLimit('admin-id', prisma as never, now);
    expect(prisma.botAppearanceChange.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { actorId: 'admin-id', changedAt: { gt: new Date('2026-10-12T10:00:00Z') } },
    }));
    expect(limit).toMatchObject({ used: 5, remaining: 0, nextAvailableAt: new Date('2026-11-12T12:00:00Z') });
    prisma.botAppearanceChange.findMany.mockResolvedValue([]);
    expect(await service.getLimit('other-admin-id')).toMatchObject({ used: 0, remaining: 5, nextAvailableAt: null });
  });
});
