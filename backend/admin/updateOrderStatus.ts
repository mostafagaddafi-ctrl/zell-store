/** تغيير حالة الطلب من لوحة التحكم. */

const ALLOWED = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ALLOWED)[number]

export type UpdateOrderStatusParams = {
  orderId: number
  status: OrderStatus
}

export default async function (req: {
  params: UpdateOrderStatusParams
}): Promise<{ ok: boolean; message?: string; status?: string }> {
  const { orderId, status } = req.params
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, message: 'رقم الطلب غير صحيح' }
  if (!ALLOWED.includes(status)) return { ok: false, message: 'حالة غير معروفة' }

  const result = await supabase.query<{ id: number; status: string }>(
    'update orders set status = $1, updated_at = now() where id = $2 returning id, status',
    [status, orderId],
  )
  const row = result.data[0]
  if (!row) return { ok: false, message: 'الطلب غير موجود' }
  return { ok: true, status: row.status }
}
