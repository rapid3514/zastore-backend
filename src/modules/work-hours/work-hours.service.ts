import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WeekDay } from '../../generated/prisma/client.js';
import { AuditAction, AuditEntityType } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import {
  WorkHoursRepository,
  type WorkHourScheduleEntry,
} from './work-hours.repository.js';

const DEFAULT_SCHEDULE: WorkHourScheduleEntry[] = [
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

@Injectable()
export class WorkHoursService {
  private readonly timeZone: string;

  constructor(
    private readonly workHoursRepository: WorkHoursRepository,
    configService: ConfigService,
    private readonly auditService?: AuditService,
  ) {
    this.timeZone = configService.getOrThrow<string>('TZ');
  }

  async getSchedule(): Promise<WorkHourScheduleEntry[]> {
    const schedule = await this.workHoursRepository.findSchedule();
    if (!schedule.length) {
      await this.workHoursRepository.createDefaultSchedule();
      return this.getSchedule();
    }

    return Object.values(WeekDay).map((day) => {
      const entry = schedule.find((item) => item.dayOfWeek === day);
      const fallback = DEFAULT_SCHEDULE.find((item) => item.dayOfWeek === day);
      return {
        dayOfWeek: day,
        isOpen: entry?.isOpen ?? fallback?.isOpen ?? false,
        openTime: entry?.openTime ?? fallback?.openTime ?? null,
        closeTime: entry?.closeTime ?? fallback?.closeTime ?? null,
      };
    });
  }

  async updateSchedule(
    entries: Array<{
      dayOfWeek: WeekDay;
      isOpen: boolean;
      openTime?: string | null;
      closeTime?: string | null;
    }>,
    actorUserId?: string,
  ): Promise<WorkHourScheduleEntry[]> {
    const normalized = entries.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      isOpen: entry.isOpen,
      openTime: entry.isOpen ? (entry.openTime ?? '09:00') : null,
      closeTime: entry.isOpen ? (entry.closeTime ?? '18:00') : null,
    }));

    for (const entry of normalized) {
      if (
        entry.isOpen &&
        entry.openTime &&
        entry.closeTime &&
        this.toMinutesFromClock(entry.openTime) >=
          this.toMinutesFromClock(entry.closeTime)
      ) {
        throw new BadRequestException({
          error: 'INVALID_WORK_HOURS',
          message: "openTime closeTime dan oldin bo'lishi kerak",
        });
      }
    }

    await this.workHoursRepository.upsertMany(normalized);
    if (actorUserId) {
      await this.auditService?.log({
        actorUserId,
        action: AuditAction.WORK_HOURS_UPDATE,
        entityType: AuditEntityType.WORK_HOURS,
        entityId: 'schedule',
        metadata: { days: normalized.map((entry) => entry.dayOfWeek) },
      });
    }
    return this.getSchedule();
  }

  async getCurrentStatus(referenceDate = new Date()) {
    const schedule = await this.getSchedule();
    const currentDay = this.resolveDay(referenceDate);
    const slot = schedule.find((entry) => entry.dayOfWeek === currentDay);
    const nowMinutes = this.toMinutesInBusinessTimeZone(referenceDate);

    if (!slot || !slot.isOpen || !slot.openTime || !slot.closeTime) {
      return {
        dayOfWeek: currentDay,
        isOpen: false,
        today: slot ?? null,
        timeZone: this.timeZone,
        nextOpenAt: await this.getNextOpenAt(referenceDate),
      };
    }

    const openMinutes = this.toMinutesFromClock(slot.openTime);
    const closeMinutes = this.toMinutesFromClock(slot.closeTime);
    const isOpen = nowMinutes >= openMinutes && nowMinutes < closeMinutes;

    return {
      dayOfWeek: currentDay,
      isOpen,
      today: slot,
      timeZone: this.timeZone,
      nextOpenAt: isOpen ? null : await this.getNextOpenAt(referenceDate),
    };
  }

  async isOpenAt(date: Date): Promise<boolean> {
    const schedule = await this.getSchedule();
    const day = this.resolveDay(date);
    const slot = schedule.find((entry) => entry.dayOfWeek === day);

    if (!slot || !slot.isOpen || !slot.openTime || !slot.closeTime) {
      return false;
    }

    const minutes = this.toMinutesInBusinessTimeZone(date);
    const openMinutes = this.toMinutesFromClock(slot.openTime);
    const closeMinutes = this.toMinutesFromClock(slot.closeTime);
    return minutes >= openMinutes && minutes < closeMinutes;
  }

  async getNextOpenAt(date: Date): Promise<Date | null> {
    const schedule = await this.getSchedule();
    const days = Object.values(WeekDay);
    const startIndex = days.indexOf(this.resolveDay(date));
    const localDate = this.getBusinessDateParts(date);

    for (let offset = 0; offset <= days.length; offset += 1) {
      const day = days[(startIndex + offset) % days.length];
      const slot = schedule.find((entry) => entry.dayOfWeek === day);
      if (!slot || !slot.isOpen || !slot.openTime || !slot.closeTime) {
        continue;
      }

      const openMinutes = this.toMinutesFromClock(slot.openTime);
      const calendarDate = new Date(
        Date.UTC(localDate.year, localDate.month - 1, localDate.day + offset),
      );
      const nextDate = this.dateFromBusinessLocalParts({
        year: calendarDate.getUTCFullYear(),
        month: calendarDate.getUTCMonth() + 1,
        day: calendarDate.getUTCDate(),
        hours: Math.floor(openMinutes / 60),
        minutes: openMinutes % 60,
      });

      if (nextDate <= date) {
        continue;
      }

      return nextDate;
    }

    return null;
  }

  async calculateBusinessDeadline(
    startDate: Date,
    durationMinutes: number,
  ): Promise<Date> {
    const schedule = await this.getSchedule();
    let remaining = Math.max(0, durationMinutes);
    let current = this.getBusinessDateParts(startDate);

    while (remaining > 0) {
      const day = this.resolveDayFromLocalParts(current);
      const slot = schedule.find((entry) => entry.dayOfWeek === day);

      if (!slot || !slot.isOpen || !slot.openTime || !slot.closeTime) {
        this.advanceBusinessDate(current);
        continue;
      }

      const openMinutes = this.toMinutesFromClock(slot.openTime);
      const closeMinutes = this.toMinutesFromClock(slot.closeTime);
      const currentMinutes = current.hours * 60 + current.minutes;

      if (currentMinutes < openMinutes) {
        current.hours = Math.floor(openMinutes / 60);
        current.minutes = openMinutes % 60;
        continue;
      }

      if (currentMinutes >= closeMinutes) {
        this.advanceBusinessDate(current);
        continue;
      }

      const availableMinutes = closeMinutes - currentMinutes;
      if (remaining <= availableMinutes) {
        const totalMinutes = currentMinutes + remaining;
        current.hours = Math.floor(totalMinutes / 60);
        current.minutes = totalMinutes % 60;
        return this.dateFromBusinessLocalParts(current);
      }

      remaining -= availableMinutes;
      this.advanceBusinessDate(current);
    }

    return this.dateFromBusinessLocalParts(current);
  }

  private resolveDay(date: Date): WeekDay {
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      weekday: 'long',
    }).format(date);

    const map: Record<string, WeekDay> = {
      Monday: WeekDay.MONDAY,
      Tuesday: WeekDay.TUESDAY,
      Wednesday: WeekDay.WEDNESDAY,
      Thursday: WeekDay.THURSDAY,
      Friday: WeekDay.FRIDAY,
      Saturday: WeekDay.SATURDAY,
      Sunday: WeekDay.SUNDAY,
    };

    return map[dayName] ?? WeekDay.MONDAY;
  }

  private toMinutesInBusinessTimeZone(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const hour = Number(
      parts.find((part) => part.type === 'hour')?.value ?? '0',
    );
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? '0',
    );
    return hour * 60 + minute;
  }

  private getBusinessDateParts(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const year = Number(
      parts.find((part) => part.type === 'year')?.value ?? '0',
    );
    const month = Number(
      parts.find((part) => part.type === 'month')?.value ?? '1',
    );
    const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');
    const hour = Number(
      parts.find((part) => part.type === 'hour')?.value ?? '0',
    );
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? '0',
    );

    return { year, month, day, hours: hour, minutes: minute };
  }

  private resolveDayFromLocalParts(parts: {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
  }): WeekDay {
    const days = [
      WeekDay.SUNDAY,
      WeekDay.MONDAY,
      WeekDay.TUESDAY,
      WeekDay.WEDNESDAY,
      WeekDay.THURSDAY,
      WeekDay.FRIDAY,
      WeekDay.SATURDAY,
    ];
    return days[
      new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
    ];
  }

  private advanceBusinessDate(parts: {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
  }) {
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    parts.year = next.getUTCFullYear();
    parts.month = next.getUTCMonth() + 1;
    parts.day = next.getUTCDate();
    parts.hours = 0;
    parts.minutes = 0;
  }

  private dateFromBusinessLocalParts(parts: {
    year: number;
    month: number;
    day: number;
    hours: number;
    minutes: number;
  }): Date {
    const desiredTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hours,
      parts.minutes,
    );
    let result = new Date(desiredTime);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rendered = this.getBusinessDateParts(result);
      const renderedTime = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hours,
        rendered.minutes,
      );
      const adjustment = desiredTime - renderedTime;
      if (adjustment === 0) break;
      result = new Date(result.getTime() + adjustment);
    }

    return result;
  }

  private toMinutesFromClock(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
