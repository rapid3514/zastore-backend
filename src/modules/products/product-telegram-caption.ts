const TELEGRAM_CAPTION_LIMIT = 1024;

export interface TelegramCaptionProduct {
  name: string;
  description: string | null;
  price: { toString(): string } | string | number;
  category: { name: string };
  isAvailable: boolean;
  isActive: boolean;
}

export function buildProductTelegramCaption(
  product: TelegramCaptionProduct,
): string {
  const header = [
    `🛍 <b>${escapeTelegramHtml(product.name)}</b>`,
    '',
    `💰 ${formatPrice(product.price)} so‘m`,
    `🗂 ${escapeTelegramHtml(product.category.name)}`,
  ];
  const availability =
    product.isActive && product.isAvailable
      ? '✅ Mavjud'
      : '❌ Hozir mavjud emas';
  const withoutDescription = [...header, '', availability].join('\n');
  const description = product.description?.trim();
  if (!description) return withoutDescription;

  const fixedLength = [...header, '', '', availability].join('\n').length;
  const available = TELEGRAM_CAPTION_LIMIT - fixedLength;
  const safeDescription = truncateAndEscape(description, available);
  return [...header, '', safeDescription, '', availability].join('\n');
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatPrice(
  value: { toString(): string } | string | number,
): string {
  const [integerPart, fraction = ''] = value.toString().split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const digits = sign ? integerPart.slice(1) : integerPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const meaningfulFraction = fraction.replace(/0+$/, '');
  return `${sign}${grouped}${meaningfulFraction ? `.${meaningfulFraction}` : ''}`;
}

function truncateAndEscape(value: string, maxLength: number): string {
  const characters = Array.from(value);
  const full = escapeTelegramHtml(value);
  if (full.length <= maxLength) return full;

  const ellipsis = '…';
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = escapeTelegramHtml(characters.slice(0, middle).join(''));
    if (candidate.length + ellipsis.length <= maxLength) low = middle;
    else high = middle - 1;
  }
  return `${escapeTelegramHtml(characters.slice(0, low).join(''))}${ellipsis}`;
}
