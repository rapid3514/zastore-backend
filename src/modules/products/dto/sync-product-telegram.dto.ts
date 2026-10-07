import { IsBoolean, IsOptional } from 'class-validator';

export class SyncProductTelegramDto {
  @IsOptional()
  @IsBoolean()
  forceRepublish?: boolean;
}
