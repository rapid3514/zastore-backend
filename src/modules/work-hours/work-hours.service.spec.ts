import { describe, expect, it, vi } from 'vitest';
import { WeekDay } from '../../generated/prisma/client.js';
import type { WorkHourScheduleEntry } from './work-hours.repository.js';
import { WorkHoursService } from './work-hours.service.js';

const schedule: WorkHourScheduleEntry[] = [
  {
    dayOfWeek: WeekDay.MONDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  {
    dayOfWeek: WeekDay.TUESDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  {
    dayOfWeek: WeekDay.WEDNESDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  {
    dayOfWeek: WeekDay.THURSDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  {
    dayOfWeek: WeekDay.FRIDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  {
    dayOfWeek: WeekDay.SATURDAY,
    isOpen: true,
    openTime: '09:00',
    closeTime: '18:00',
  },
  { dayOfWeek: WeekDay.SUNDAY, isOpen: false, openTime: null, closeTime: null },
];

function serviceWithSchedule(
  customSchedule = schedule,
  timeZone = 'Asia/Tashkent',
) {
  const repo = {
    findSchedule: vi.fn().mockResolvedValue(customSchedule),
    createDefaultSchedule: vi.fn().mockResolvedValue([]),
    upsertMany: vi.fn(),
  };

  const config = {
    getOrThrow: vi.fn().mockReturnValue(timeZone),
  };

  return new WorkHoursService(repo as any, config as any);
}

describe('WorkHoursService', () => {
  it('calculates a deadline using business hours only', async () => {
    const service = serviceWithSchedule();
    const deadline = await service.calculateBusinessDeadline(
      new Date('2026-09-24T17:30:00+05:00'),
      240,
    );

    expect(deadline.toISOString()).toBe('2026-09-25T07:30:00.000Z');
  });

  it('returns the next opening in Tashkent time', async () => {
    const service = serviceWithSchedule();

    const nextOpenAt = await service.getNextOpenAt(
      new Date('2026-09-27T12:00:00+05:00'),
    );

    expect(nextOpenAt?.toISOString()).toBe('2026-09-28T04:00:00.000Z');
  });

  it('returns today opening when it is still upcoming in Tashkent', async () => {
    const service = serviceWithSchedule();

    const nextOpenAt = await service.getNextOpenAt(
      new Date('2026-09-28T08:00:00+05:00'),
    );

    expect(nextOpenAt?.toISOString()).toBe('2026-09-28T04:00:00.000Z');
  });

  it('checks the same weekday next week after today opening has passed', async () => {
    const mondayOnly = schedule.map((entry) => ({
      ...entry,
      isOpen: entry.dayOfWeek === WeekDay.MONDAY,
      openTime: entry.dayOfWeek === WeekDay.MONDAY ? '09:00' : null,
      closeTime: entry.dayOfWeek === WeekDay.MONDAY ? '18:00' : null,
    }));
    const service = serviceWithSchedule(mondayOnly);

    const nextOpenAt = await service.getNextOpenAt(
      new Date('2026-09-28T19:00:00+05:00'),
    );

    expect(nextOpenAt?.toISOString()).toBe('2026-10-05T04:00:00.000Z');
  });

  it('checks open status in the configured business time zone', async () => {
    const sundayUntilNoon = schedule.map((entry) =>
      entry.dayOfWeek === WeekDay.SUNDAY
        ? { ...entry, isOpen: true, openTime: '09:00', closeTime: '12:03' }
        : entry,
    );
    const service = serviceWithSchedule(
      sundayUntilNoon,
      'America/Los_Angeles',
    );

    const status = await service.getCurrentStatus(
      new Date('2026-09-27T10:05:00-07:00'),
    );

    expect(status.isOpen).toBe(true);
    expect(status.timeZone).toBe('America/Los_Angeles');
  });
});
