/** إضافة أو تعديل منتج من لوحة التحكم. */

export type SaveProductParams = {
  id?: number | null
  name_ar: string
  name_en?: string
  brand?: string
  description_ar?: string
  image_url?: string
  images?: string[]
  before_image?: string
  after_image?: string
  price_per_meter_piastres: number
  width_cm: number
  min_length_cm: number
  step_cm: number
  max_length_cm: number
  is_active: boolean
  sort_order: number
}

export default async function (req: {
  params: SaveProductParams
}): Promise<{ ok: boolean; message?: string; id?: number }> {
  const p = req.params
  const nameAr = (p.name_ar ?? '').trim()
  if (nameAr.length < 2) return { ok: false, message: 'اكتب اسم المنتج' }
  const ints = [p.price_per_meter_piastres, p.width_cm, p.min_length_cm, p.step_cm, p.max_length_cm, p.sort_order]
  if (ints.some((v) => !Number.isInteger(v))) return { ok: false, message: 'كل الأرقام لازم تكون صحيحة (بدون كسور)' }
  if (p.price_per_meter_piastres <= 0) return { ok: false, message: 'سعر المتر لازم يكون أكبر من صفر' }
  if (p.width_cm <= 0 || p.min_length_cm <= 0 || p.step_cm <= 0) {
    return { ok: false, message: 'العرض والحد الأدنى والخطوة لازم يكونوا أكبر من صفر' }
  }
  if (p.max_length_cm < p.min_length_cm) return { ok: false, message: 'أقصى طول لازم يكون أكبر من الحد الأدنى' }

  const images = (p.images ?? []).map((url) => url.trim()).filter((url) => url !== '')

  const values = [
    nameAr,
    (p.name_en ?? '').trim(),
    (p.brand ?? '').trim(),
    (p.description_ar ?? '').trim(),
    (p.image_url ?? '').trim(),
    JSON.stringify(images),
    (p.before_image ?? '').trim(),
    (p.after_image ?? '').trim(),
    p.price_per_meter_piastres,
    p.width_cm,
    p.min_length_cm,
    p.step_cm,
    p.max_length_cm,
    p.is_active,
    p.sort_order,
  ]

  if (p.id && Number.isInteger(p.id)) {
    const result = await supabase.query<{ id: number }>(
      `update products set
         name_ar = $1,
         name_en = nullif($2, ''),
         brand = nullif($3, ''),
         description_ar = nullif($4, ''),
         image_url = nullif($5, ''),
         images = $6::jsonb,
         before_image = nullif($7, ''),
         after_image = nullif($8, ''),
         price_per_meter_piastres = $9,
         width_cm = $10,
         min_length_cm = $11,
         step_cm = $12,
         max_length_cm = $13,
         is_active = $14,
         sort_order = $15,
         updated_at = now()
       where id = $16
       returning id`,
      [...values, p.id],
    )
    const row = result.data[0]
    if (!row) return { ok: false, message: 'المنتج غير موجود' }
    return { ok: true, id: row.id }
  }

  const result = await supabase.query<{ id: number }>(
    `insert into products (
       name_ar, name_en, brand, description_ar, image_url, images, before_image, after_image,
       price_per_meter_piastres, width_cm, min_length_cm, step_cm, max_length_cm, is_active, sort_order
     )
     values ($1, nullif($2, ''), nullif($3, ''), nullif($4, ''), nullif($5, ''), $6::jsonb,
             nullif($7, ''), nullif($8, ''), $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    values,
  )
  const row = result.data[0]
  return row ? { ok: true, id: row.id } : { ok: false, message: 'تعذّر حفظ المنتج' }
}
