/** ImageKit transformation query parameters preserve the canonical asset path. */
export function imageVariants(original: string | null) {
  if (!original) return null;
  const transform = (width: number) => {
    const url = new URL(original);
    url.searchParams.set('tr', `w-${width},c-at_max,q-75,f-auto`);
    return url.toString();
  };
  return {
    thumbnail: transform(160),
    card: transform(480),
    detail: transform(1280),
    srcSet: [320, 480, 768, 1280].map((width) => `${transform(width)} ${width}w`).join(', '),
  };
}
