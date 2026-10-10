import { describe, expect, it } from 'vitest';
import { imageVariants } from './image-variants.js';

describe('responsive image variants', () => {
  it('bounds card/detail widths without losing the authoritative asset path', () => {
    const variants = imageVariants('https://ik.imagekit.io/account/products/photo.jpg');
    expect(variants?.thumbnail).toContain('w-160');
    expect(variants?.card).toContain('w-480');
    expect(variants?.detail).toContain('w-1280');
    expect(variants?.srcSet).toContain('320w');
    expect(new URL(variants!.card).pathname).toBe('/account/products/photo.jpg');
  });
  it('does not invent an image for products without a cover', () => {
    expect(imageVariants(null)).toBeNull();
  });
});
