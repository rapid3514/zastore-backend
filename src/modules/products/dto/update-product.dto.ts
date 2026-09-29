import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

const numericPrice = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class UpdateProductDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @Transform(numericPrice)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  price?: number;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
