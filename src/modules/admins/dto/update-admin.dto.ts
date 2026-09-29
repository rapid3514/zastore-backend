import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string;
}
