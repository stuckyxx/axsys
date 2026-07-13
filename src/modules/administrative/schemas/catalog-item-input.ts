import { z } from "@/lib/validation/zod"

const catalogItemShape = {
  itemKind: z.enum(["service", "product"]),
  segment: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(2).max(2_000),
} as const

export const catalogItemCreateSchema = z.object(catalogItemShape).strict()

export const catalogItemUpdateSchema = z
  .object({ ...catalogItemShape, version: z.int().positive() })
  .strict()

export type CatalogItemCreateInput = z.infer<typeof catalogItemCreateSchema>
export type CatalogItemUpdateInput = z.infer<typeof catalogItemUpdateSchema>
