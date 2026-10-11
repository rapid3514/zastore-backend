import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceService } from './appearance.service.js';

describe('AppearanceService', () => {
  const current = { backgroundUrl: 'https://ik.imagekit.io/shop/products/background.webp', updatedAt: new Date() };
  const prisma = {
    botAppearance: { findUnique: vi.fn(), upsert: vi.fn() },
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
});
