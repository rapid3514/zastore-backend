export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function createCategorySlug(name: string): string {
  return normalizeCategoryName(name)
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLowerCase()
    .replace(/['’‘`ʻʼ]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
