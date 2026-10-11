import { Type } from 'class-transformer';
import { IsDefined, ValidateIf, ValidateNested } from 'class-validator';
import { ProductImageDto } from '../../media/dto/product-image.dto.js';

export class UpdateAppearanceDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => ProductImageDto)
  background!: ProductImageDto | null;
}
