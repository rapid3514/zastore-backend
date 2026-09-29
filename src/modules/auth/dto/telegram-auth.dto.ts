import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramAuthDto {
  @IsString()
  @IsNotEmpty()
  initData!: string;
}
