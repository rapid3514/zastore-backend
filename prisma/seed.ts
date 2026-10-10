import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';
import configuration from '../src/config/configuration.js';

const { runtime } = configuration();
const telegramId = runtime.telegram.superAdminTelegramId;

if (!telegramId?.trim()) {
  console.warn(
    'SUPER_ADMIN_TELEGRAM_ID is not set; skipping super admin seed.',
  );
} else if (!/^\d+$/.test(telegramId)) {
  console.warn(
    'SUPER_ADMIN_TELEGRAM_ID must be a numeric Telegram user ID; skipping super admin seed.',
  );
} else {
  const adapter = new PrismaPg({ connectionString: runtime.database.url });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { role: UserRole.SUPER_ADMIN, isBlocked: false },
      create: {
        telegramId: BigInt(telegramId),
        firstName: 'Super Admin',
        role: UserRole.SUPER_ADMIN,
        isBlocked: false,
      },
    });
    console.log('Super admin seed completed.');
  } finally {
    await prisma.$disconnect();
  }
}
