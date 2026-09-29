import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class UpdateCategoryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
