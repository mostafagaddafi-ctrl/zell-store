/**
 * عبارة إنشاء الطلب (سلة بأكتر من صنف) — عبارة SQL واحدة ذرّية.
 * - الأسعار وقواعد الطول والشحن كلها بتتقرا من الداتابيز، وأي رقم جاي من الواجهة بيتجاهل.
 * - لقطة كل صنف (الاسم/الصورة/سعر المتر/العرض) بتتجمّد على \`order_items\`.
 * - لو أي صنف مرفوض (منتج مقفول أو طول مخالف) مايتعملش طلب أصلاً — صفر صفوف راجعة.
 *
 * كل placeholder بيظهر مرة واحدة بس (المدخلات كلها في CTE اسمه inp).
 *  $1 items(jsonb)  $2 governorate  $3 order_number
 *  $4 customer_name $5 customer_phone $6 address $7 notes
 */
export const CREATE_ORDER_SQL = `
with inp as (
  select
    $1::jsonb as items,
    $2::text  as governorate,
    $3::text  as order_number,
    $4::text  as customer_name,
    $5::text  as customer_phone,
    $6::text  as address,
    $7::text  as notes
),
req as (
  select (e ->> 'productId')::int as product_id, (e ->> 'lengthCm')::int as length_cm
  from inp, lateral jsonb_array_elements(inp.items) e
),
priced as (
  select p.id as product_id, p.name_ar, p.image_url, p.price_per_meter_piastres, p.width_cm,
         r.length_cm,
         round((p.price_per_meter_piastres * r.length_cm) / 100.0)::int as line_total
  from req r
  join products p
    on p.id = r.product_id
   and p.is_active = true
   and r.length_cm >= p.min_length_cm
   and r.length_cm <= p.max_length_cm
   and ((r.length_cm - p.min_length_cm) % p.step_cm) = 0
),
totals as (
  select coalesce(sum(line_total), 0)::int as subtotal, count(*)::int as ok_count from priced
),
ship as (
  select
    coalesce(
      (select (s.value ->> inp.governorate)::int from settings s where s.key = 'shipping_rates'),
      (select (s.value #>> '{}')::int from settings s where s.key = 'shipping_default_piastres'),
      0
    ) as base_piastres,
    coalesce(
      (select (s.value #>> '{}')::int from settings s where s.key = 'free_shipping_threshold_piastres'),
      0
    ) as free_threshold_piastres
  from inp
),
new_order as (
  insert into orders (
    order_number, customer_name, customer_phone, governorate, address, notes,
    subtotal_piastres, shipping_piastres, total_piastres
  )
  select
    inp.order_number, inp.customer_name, inp.customer_phone, inp.governorate, inp.address,
    nullif(btrim(inp.notes), ''),
    t.subtotal,
    case when sh.free_threshold_piastres > 0 and t.subtotal >= sh.free_threshold_piastres
         then 0 else sh.base_piastres end,
    t.subtotal + case when sh.free_threshold_piastres > 0 and t.subtotal >= sh.free_threshold_piastres
         then 0 else sh.base_piastres end
  from inp, totals t, ship sh
  where t.ok_count > 0 and t.ok_count = (select count(*) from req)
  returning id, order_number, status, subtotal_piastres, shipping_piastres, total_piastres,
            customer_name, customer_phone, governorate, address, created_at
),
items_ins as (
  insert into order_items (
    order_id, product_id, product_name_ar, product_image_url,
    unit_price_piastres, length_cm, width_cm, line_total_piastres
  )
  select o.id, pr.product_id, pr.name_ar, pr.image_url, pr.price_per_meter_piastres,
         pr.length_cm, pr.width_cm, pr.line_total
  from new_order o cross join priced pr
  returning order_id, product_name_ar, product_image_url, unit_price_piastres,
            length_cm, width_cm, line_total_piastres
)
select
  o.id, o.order_number, o.status, o.subtotal_piastres, o.shipping_piastres, o.total_piastres,
  o.customer_name, o.customer_phone, o.governorate, o.address, o.created_at,
  (select coalesce(json_agg(json_build_object(
     'product_name_ar', i.product_name_ar,
     'product_image_url', i.product_image_url,
     'unit_price_piastres', i.unit_price_piastres,
     'length_cm', i.length_cm,
     'width_cm', i.width_cm,
     'line_total_piastres', i.line_total_piastres
   )), '[]'::json) from items_ins i) as items
from new_order o
`

export type CreatedOrderItem = {
  product_name_ar: string
  product_image_url: string | null
  unit_price_piastres: number
  length_cm: number
  width_cm: number
  line_total_piastres: number
}

export type CreatedOrderRow = {
  id: number
  order_number: string
  status: string
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  created_at: string
  items: CreatedOrderItem[]
}
