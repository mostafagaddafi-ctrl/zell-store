/** حفظ الإعدادات (واتساب، عروض، شحن، إشعارات) — مفاتيح معروفة فقط. */

const STRING_KEYS = [
  'store_name',
  'logo_url',
  'offer_text',
  'whatsapp_number',
  'whatsapp_message',
  'notify_email',
  'telegram_bot_token',
  'telegram_chat_id',
] as const

const NUMBER_KEYS = ['shipping_default_piastres', 'free_shipping_threshold_piastres'] as const

export type SaveSettingsParams = {
  store_name?: string
  logo_url?: string
  offer_text?: string
  whatsapp_number?: string
  whatsapp_message?: string
  notify_email?: string
  telegram_bot_token?: string
  telegram_chat_id?: string
  shipping_default_piastres?: number
  free_shipping_threshold_piastres?: number
  shipping_rates?: Record<string, number>
  testimonials?: Array<{ name?: string; area?: string; text?: string }>
  gallery?: Array<{ before?: string; after?: string; caption?: string }>
  materials?: Array<{ image?: string; caption?: string }>
}

export default async function (req: {
  params: SaveSettingsParams
}): Promise<{ ok: boolean; message?: string; saved: string[] }> {
  const p = req.params
  const updates: Array<[string, unknown]> = []

  for (const key of STRING_KEYS) {
    const value = p[key]
    if (typeof value === 'string') updates.push([key, value.trim()])
  }

  for (const key of NUMBER_KEYS) {
    const value = p[key]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, message: 'قيم الشحن لازم تكون أرقام صحيحة بالقرش', saved: [] }
    }
    updates.push([key, value])
  }

  if (p.shipping_rates) {
    const rates: Record<string, number> = {}
    for (const [gov, value] of Object.entries(p.shipping_rates)) {
      const name = gov.trim()
      if (!name) continue
      if (!Number.isInteger(value) || value < 0) {
        return { ok: false, message: `قيمة الشحن لمحافظة ${name} لازم تكون رقم صحيح بالقرش`, saved: [] }
      }
      rates[name] = value
    }
    if (Object.keys(rates).length === 0) {
      return { ok: false, message: 'لازم تفضل محافظة واحدة على الأقل في جدول الشحن', saved: [] }
    }
    updates.push(['shipping_rates', rates])
  }

  if (p.testimonials) {
    const rows = p.testimonials
      .map((row) => ({
        name: (row.name ?? '').trim(),
        area: (row.area ?? '').trim(),
        text: (row.text ?? '').trim(),
      }))
      .filter((row) => row.name !== '' && row.text !== '')
    updates.push(['testimonials', rows])
  }

  if (p.gallery) {
    const rows = p.gallery
      .map((row) => ({
        before: (row.before ?? '').trim(),
        after: (row.after ?? '').trim(),
        caption: (row.caption ?? '').trim(),
      }))
      .filter((row) => row.after !== '')
    updates.push(['gallery', rows])
  }

  if (p.materials) {
    const rows = p.materials
      .map((row) => ({ image: (row.image ?? '').trim(), caption: (row.caption ?? '').trim() }))
      .filter((row) => row.image !== '')
    updates.push(['materials', rows])
  }

  const saved: string[] = []
  for (const [key, value] of updates) {
    await supabase.query(
      `insert into settings (key, value)
       values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    )
    saved.push(key)
  }

  return { ok: true, saved }
}
