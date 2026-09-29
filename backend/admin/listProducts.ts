/** كل المنتجات (نشطة وغير نشطة) لإدارتها من اللوحة. */

export type AdminProduct = {
  id: number
  name_ar: string
  name_en: string | null
  brand: string | null
  description_ar: string | null
  image_url: string | null
  images: string[]
  before_image: string | null
  after_image: string | null
  price_per_meter_piastres: number
  width_cm: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  is_active: boolean
  sort_order: number
  created_at: string
}

export default async function (): Promise<AdminProduct[]> {
  const result = await supabase.query<AdminProduct>(
    `select id, name_ar, name_en, brand, description_ar, image_url,
            coalesce(images, '[]'::jsonb) as images, before_image, after_image,
            price_per_meter_piastres,
            width_cm, min_length_cm, step_cm, max_length_cm, is_active, sort_order, created_at
     from products
     order by sort_order, id`,
  )
  return result.data
}
