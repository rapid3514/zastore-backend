export interface CreateCategoryData {
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

export interface UpdateCategoryData {
  name?: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
}
