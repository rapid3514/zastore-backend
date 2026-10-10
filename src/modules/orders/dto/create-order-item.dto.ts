import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsUUID, Max, Min } from 'class-validator';
import { MAX_ORDER_QUANTITY } from '../constants/order-limits.js';

export class CreateOrderItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ORDER_QUANTITY)
  quantity!: number;
}
