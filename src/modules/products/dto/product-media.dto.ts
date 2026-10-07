import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  IsOptional,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProductMediaType } from '../../../generated/prisma/client.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProductMediaDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsEnum(ProductMediaType)
  type!: ProductMediaType;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileId!: string;

  // Client URL is syntactically validated, then replaced by ImageKit metadata.
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  url!: string;

  @IsInt()
  @Min(0)
  @Max(4)
  position!: number;
}
