/**
 * طلبات لوحة التحكم + ملخص المبيعات.
 * الفلترة والبحث في الداتابيز، والترتيب والتقسيم على صفحات في الواجهة.
 */

export type AdminOrderItem = {
  product_name_ar: string
  product_image_url: string | null
  unit_price_piastres: number
  length_cm: number
  width_cm: number
  line_total_piastres: number
}

export type AdminOrder = {
  id: number
  order_number: string
  status: string
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  notes: string | null
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  notified_at: string | null
  notify_error: string | null
  created_at: string
  items: AdminOrderItem[]
}

export type OrdersSummary = {
  new_count: number
  total_orders: number
  today_count: number
  sales_piastres: number
  sales_month_piastres: number
}

export type GetOrdersParams = {
  status?: string
  search?: string
}

export default async function (req: { params?: GetOrdersParams }): Promise<{
  orders: AdminOrder[]
  summary: OrdersSummary
  statusCounts: Record<string, number>
}> {
  const status = (req.params?.status ?? '').trim()
  const search = (req.params?.search ?? '').trim()

  const ordersResult = await supabase.query<AdminOrder>(
    `with inp as (select $1::text as status_filter, $2::text as search)
     select o.*,
       coalesce((
         select json_agg(json_build_object(
           'product_name_ar', i.product_name_ar,
           'product_image_url', i.product_image_url,
           'unit_price_piastres', i.unit_price_piastres,
           'length_cm', i.length_cm,
           'width_cm', i.width_cm,
           'line_total_piastres', i.line_total_piastres
         ) order by i.id)
         from order_items i where i.order_id = o.id
       ), '[]'::json) as items
     from orders o, inp
     where (inp.status_filter = '' or o.status = inp.status_filter)
       and (
         inp.search = ''
         or o.order_number   ilike '%' || inp.search || '%'
         or o.customer_name  ilike '%' || inp.search || '%'
         or o.customer_phone ilike '%' || inp.search || '%'
         or o.governorate    ilike '%' || inp.search || '%'
       )
     order by o.created_at desc
     limit 500`,
    [status, search],
  )

  const summaryResult = await supabase.query<OrdersSummary>(
    `select
       count(*) filter (where status = 'new')::int as new_count,
       count(*)::int as total_orders,
       count(*) filter (where created_at >= current_date)::int as today_count,
       coalesce(sum(total_piastres) filter (where status <> 'cancelled'), 0)::int as sales_piastres,
       coalesce(sum(total_piastres) filter (
         where status <> 'cancelled' and created_at >= date_trunc('month', now())
       ), 0)::int as sales_month_piastres
     from orders`,
  )

  const countsResult = await supabase.query<{ status: string; count: number }>(
    'select status, count(*)::int as count from orders group by status',
  )

  const statusCounts: Record<string, number> = {}
  for (const row of countsResult.data) statusCounts[row.status] = row.count

  return {
    orders: ordersResult.data,
    summary:
      summaryResult.data[0] ??
      { new_count: 0, total_orders: 0, today_count: 0, sales_piastres: 0, sales_month_piastres: 0 },
    statusCounts,
  }
}
