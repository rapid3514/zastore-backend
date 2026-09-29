import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class OrderReasonDto {
  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
