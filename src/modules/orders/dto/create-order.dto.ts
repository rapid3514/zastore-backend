import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order-item.dto.js';
import { MAX_ORDER_ITEMS } from '../constants/order-limits.js';

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsOptional()
  @Transform(normalizeText)
  @IsString()
  @Matches(/^\+?[0-9\s\-()]+$/)
  @MaxLength(30)
  phone?: string;

  @Transform(normalizeText)
  @IsString()
  @MinLength(1, { message: 'Yetkazib berish manzilini kiriting.' })
  @MaxLength(255)
  deliveryAddress!: string;

  @Transform(normalizeText)
  @IsString()
  @MinLength(1, { message: 'BTC pochta filial raqamini kiriting.' })
  @MaxLength(50)
  btcPostBranchNumber!: string;

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
