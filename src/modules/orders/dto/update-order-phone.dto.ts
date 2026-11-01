import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const normalizeText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class UpdateOrderPhoneDto {
  @Transform(normalizeText)
  @IsString()
  @MinLength(7, {
    message: 'Telefon raqam kamida 7 ta belgidan iborat bo‘lishi kerak.',
  })
  @Matches(/^\+?[0-9\s\-()]+$/, {
    message: 'Telefon raqam noto‘g‘ri formatda.',
  })
  @MaxLength(30)
  phone!: string;
}
