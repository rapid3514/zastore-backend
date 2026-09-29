export interface PublicCategoryResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AdminCategoryResponseDto extends PublicCategoryResponseDto {
  createdAt: Date;
  updatedAt: Date;
}
