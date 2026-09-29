import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service.js';

describe('UsersService Telegram contact registration', () => {
  const repository = {
    findByTelegramId: vi.fn(),
    findById: vi.fn(),
    findByPhone: vi.fn(),
    upsertFromTelegramContact: vi.fn(),
    promoteGuestToCustomer: vi.fn(),
  };
  let service: UsersService;

  const input = {
    telegramId: 123n,
    firstName: 'Ali',
    lastName: 'Valiyev',
    username: 'ali',
    phone: '+998 90 123-45-67',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findByPhone.mockResolvedValue(null);
    service = new UsersService(repository as never);
  });

  it('promotes GUEST to CUSTOMER and verifies the phone', async () => {
    repository.findByTelegramId.mockResolvedValue({
      id: 'user-id',
      role: UserRole.GUEST,
      isBlocked: false,
    });
    repository.upsertFromTelegramContact.mockResolvedValue({
      id: 'user-id',
      role: UserRole.GUEST,
    });
    repository.promoteGuestToCustomer.mockResolvedValue({
      id: 'user-id',
      role: UserRole.CUSTOMER,
    });

    await expect(
      service.registerFromTelegramContact(input),
    ).resolves.toMatchObject({ role: UserRole.CUSTOMER });
    expect(repository.upsertFromTelegramContact).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+998901234567',
        phoneVerifiedAt: expect.any(Date),
      }),
    );
    expect(repository.promoteGuestToCustomer).toHaveBeenCalledWith('user-id');
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CUSTOMER])(
    'preserves the %s role',
    async (role) => {
      repository.findByTelegramId.mockResolvedValue({
        id: 'user-id',
        role,
        isBlocked: false,
      });
      repository.upsertFromTelegramContact.mockResolvedValue({
        id: 'user-id',
        role,
      });

      await expect(
        service.registerFromTelegramContact(input),
      ).resolves.toMatchObject({ role });
      expect(repository.promoteGuestToCustomer).not.toHaveBeenCalled();
    },
  );

  it('creates a new registration as CUSTOMER with a verified phone', async () => {
    repository.findByTelegramId.mockResolvedValue(null);
    repository.upsertFromTelegramContact.mockResolvedValue({
      id: 'user-id',
      role: UserRole.CUSTOMER,
    });

    await service.registerFromTelegramContact(input);

    expect(repository.upsertFromTelegramContact).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+998901234567',
        phoneVerifiedAt: expect.any(Date),
      }),
    );
  });

  it('does not unblock or update a blocked user', async () => {
    repository.findByTelegramId.mockResolvedValue({
      id: 'user-id',
      role: UserRole.ADMIN,
      isBlocked: true,
    });

    await expect(
      service.registerFromTelegramContact(input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.upsertFromTelegramContact).not.toHaveBeenCalled();
  });

  it('rejects a phone owned by another Telegram user', async () => {
    repository.findByTelegramId.mockResolvedValue(null);
    repository.findByPhone.mockResolvedValue({ telegramId: 999n });

    await expect(
      service.registerFromTelegramContact(input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.upsertFromTelegramContact).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-phone collision to ConflictException', async () => {
    repository.findByTelegramId.mockResolvedValue(null);
    repository.upsertFromTelegramContact.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.registerFromTelegramContact(input),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
