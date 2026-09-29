import type { UserRole } from '../../generated/prisma/client.js';

export interface AuthenticatedUser {
  sub: string;
  telegramId: string;
  role: UserRole;
}
