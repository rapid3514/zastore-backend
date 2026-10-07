import { describe, expect, it } from 'vitest';
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
      isAvailable: true,
      isActive: true,
    });

    expect(caption).toContain('&lt;Qora &amp; ko‘ylak&gt;');
    expect(caption).toContain('180 000 so‘m');
    expect(caption).toContain('Kiyim &amp; aksessuar');
    expect(caption).toContain('Yangi &lt;model&gt;');
    expect(caption).toContain('✅ Mavjud');
  });

  it('marks unavailable products and stays inside Telegram caption limit', () => {
    const caption = buildProductTelegramCaption({
      name: 'Mahsulot',
      description: '<'.repeat(2_000),
      price: 12500.5,
      category: { name: 'Kategoriya' },
      isAvailable: false,
      isActive: true,
    });

    expect(caption).toContain('❌ Hozir mavjud emas');
    expect(caption).toContain('Mahsulot');
    expect(caption).toContain('12 500.5');
    expect(caption).toContain('Kategoriya');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).not.toMatch(/&(?!lt;|gt;|amp;|quot;|#39;)/);
  });

  it('escapes script and Telegram HTML tags from user-controlled fields', () => {
    const caption = buildProductTelegramCaption({
      name: '<script>alert(1)</script>',
      description: '<b>test</b> & <i>x</i>',
      price: 1000,
      category: { name: '<u>category</u>' },
      isAvailable: true,
      isActive: true,
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
