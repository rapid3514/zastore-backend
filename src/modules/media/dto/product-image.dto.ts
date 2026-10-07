import { Transform } from 'class-transformer';
import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProductImageDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileId!: string;

  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  url!: string;
}
