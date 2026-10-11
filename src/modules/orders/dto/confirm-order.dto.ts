import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class ConfirmOrderDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeText)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  deliveryAddress?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeText)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  btcPostBranchNumber?: string;
}
