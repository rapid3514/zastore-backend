import { Injectable } from '@nestjs/common';
import { WeekDay } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

export type WorkHourScheduleEntry = {
  dayOfWeek: WeekDay;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

@Injectable()
export class WorkHoursRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSchedule() {
    return this.prisma.workHour.findMany({
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  createDefaultSchedule() {
    const defaultSchedule: WorkHourScheduleEntry[] = Object.values(WeekDay).map(
      (dayOfWeek) => ({
        dayOfWeek,
        isOpen: dayOfWeek !== WeekDay.SUNDAY,
        openTime: dayOfWeek === WeekDay.SUNDAY ? null : '09:00',
        closeTime: dayOfWeek === WeekDay.SUNDAY ? null : '18:00',
      }),
    );

    return this.prisma.workHour.createMany({
      data: defaultSchedule,
      skipDuplicates: true,
    });
  }

  upsertMany(entries: WorkHourScheduleEntry[]) {
    return this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.workHour.upsert({
          where: { dayOfWeek: entry.dayOfWeek },
          update: {
            isOpen: entry.isOpen,
            openTime: entry.openTime,
            closeTime: entry.closeTime,
          },
          create: {
            dayOfWeek: entry.dayOfWeek,
            isOpen: entry.isOpen,
            openTime: entry.openTime,
            closeTime: entry.closeTime,
          },
        }),
      ),
    );
  }
}
