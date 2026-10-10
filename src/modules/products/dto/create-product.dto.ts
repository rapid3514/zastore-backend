import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  ArrayMaxSize,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductAvailabilityStatus } from '../../../generated/prisma/client.js';
import { ProductImageDto } from '../../media/dto/product-image.dto.js';
import { ProductMediaDto } from './product-media.dto.js';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

const numericPrice = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class CreateProductDto {
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @Transform(numericPrice)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  price!: number;

  @IsOptional()
  @Transform(numericPrice)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  cargoPrice?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductImageDto)
  image?: ProductImageDto;

  @IsOptional()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ProductMediaDto)
  media?: ProductMediaDto[];

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsEnum(ProductAvailabilityStatus)
  availabilityStatus?: ProductAvailabilityStatus;

}
