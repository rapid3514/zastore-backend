import { describe, expect, it } from 'vitest';
import { ProductAvailabilityStatus } from '../../generated/prisma/client.js';
import {
  buildProductTelegramCaption,
  formatPrice,
} from './product-telegram-caption.js';

describe('product Telegram caption', () => {
  it('formats product data, escapes markup, and shows availability', () => {
    const caption = buildProductTelegramCaption({
      name: '<Qora & ko‘ylak>',
      description: 'Yangi <model>',
      price: '180000.00',
      category: { name: 'Kiyim & aksessuar' },
      availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
    });

    expect(caption).toContain('&lt;Qora &amp; ko‘ylak&gt;');
    expect(caption).toContain('180 000 so‘m');
    expect(caption).toContain('Kiyim &amp; aksessuar');
    expect(caption).toContain('Yangi &lt;model&gt;');
    expect(caption).toContain('✅ Sotuvda bor');
  });

  it('marks unavailable products and stays inside Telegram caption limit', () => {
    const caption = buildProductTelegramCaption({
      name: 'Mahsulot',
      description: '<'.repeat(2_000),
      price: 12500.5,
      category: { name: 'Kategoriya' },
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });

    expect(caption).toContain('❌ Sotuvda yo‘q');
    expect(caption).toContain('Mahsulot');
    expect(caption).toContain('12 500.5');
    expect(caption).toContain('Kategoriya');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).not.toMatch(/&(?!lt;|gt;|amp;|quot;|#39;)/);
  });

  it('shows the 14-day arrival status', () => {
    const caption = buildProductTelegramCaption({
      name: 'Oldindan buyurtma mahsuloti',
      description: null,
      price: 50000,
      cargoPrice: 5000.5,
      category: { name: 'Kategoriya' },
      availabilityStatus: ProductAvailabilityStatus.ARRIVING_IN_14_DAYS,
    });

    expect(caption).toContain('🚚 14 kunda keladi');
    expect(caption).toContain('🚚 Kargo: 5 000.5 so‘m');
  });

  it('escapes script and Telegram HTML tags from user-controlled fields', () => {
    const caption = buildProductTelegramCaption({
      name: '<script>alert(1)</script>',
      description: '<b>test</b> & <i>x</i>',
      price: 1000,
      category: { name: '<u>category</u>' },
      availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
    });
    expect(caption).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(caption).toContain(
      '&lt;b&gt;test&lt;/b&gt; &amp; &lt;i&gt;x&lt;/i&gt;',
    );
    expect(caption).toContain('&lt;u&gt;category&lt;/u&gt;');
    expect(caption).not.toContain('<script>');
  });

  it('formats decimal values without floating-point conversion', () => {
    expect(formatPrice({ toString: () => '99999999.90' })).toBe('99 999 999.9');
  });
});
