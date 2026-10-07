import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { WeekDay } from '../../../generated/prisma/client.js';

export class WorkHourEntryDto {
  @IsEnum(WeekDay)
  dayOfWeek!: WeekDay;

  @IsBoolean()
  isOpen!: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? null : value))
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? null : value))
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime?: string | null;
}
