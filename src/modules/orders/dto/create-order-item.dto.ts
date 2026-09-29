import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';

export class CreateOrderItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
