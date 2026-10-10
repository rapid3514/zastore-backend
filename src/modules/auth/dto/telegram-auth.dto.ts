import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TelegramAuthDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_384)
  initData!: string;
}
