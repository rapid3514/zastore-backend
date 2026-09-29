import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order-item.dto.js';

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @Matches(/^\+?[0-9\s\-()]+$/)
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @MaxLength(255)
  deliveryAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
