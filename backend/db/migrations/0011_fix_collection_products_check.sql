-- =====================================================================
-- 0011 — تصحيح فحص وجود المنتج في zell_set_collection_products
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الترتيب: 0008 ← 0008a ← 0009 ← 0010 ← 0011
--
--  ⚠️ **العطل: اسم عمود غامض بيخلّي الفحص no-op صامت.**
--
--     النسخة المنفّذة في 0010 فيها:
--
--       if exists (
--         select 1 from pg_catalog.unnest(v_ids) id
--         where not exists (select 1 from public.products p where p.id = id)
--       ) then raise exception 'ZELL_INVALID_COLLECTION_PRODUCTS'; end if;
--
--     الـ `id` المجرّد في الاستعلام الداخلي **مابيشاورش** على عمود
--     unnest. الاستعلام الداخلي FROM بتاعه public.products p، وde
--     فيه عمود اسمه id كمان — والنطاق الأقرب هو اللي بيفوز. فالشرط
--     بقى عمليًا `p.id = p.id` = true دايمًا، فالـ not exists بيبقى
--     false، والـ IF مابيولعش أبدًا.
--
--     متحقَّق على production بقراءة محضة:
--       select exists (select 1 from pg_catalog.unnest(array[999999]::integer[]) id
--                      where not exists (select 1 from public.products p where p.id = id));
--       -> false   (المفروض true: 999999 مش موجود)
--     ونفس الاستعلام بعمود مسمّى صريح -> true.
--
--     الأثر: معرّف منتج غير موجود مابيترفضش برسالة واضحة، وبيوصل
--     للـ FK فيرجّع خطأ مبهم للأدمن بدل ZELL_INVALID_COLLECTION_PRODUCTS.
--
--  ✅ idempotent: create or replace على نفس التوقيع — المالك والـACL
--     والـOID بيتحفظوا، ومفيش drop.
--  ⚠️ لازم تتنفّذ بدور postgres.
-- =====================================================================

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0011_WRONG_ROLE: current_user=%', current_user;
  end if;
end
$guard$;

create or replace function public.zell_set_collection_products(
  p_collection_id bigint,
  p_product_ids   integer[]
) returns integer
language plpgsql
set search_path to ''
as $function$
declare
  v_ids   integer[] := coalesce(p_product_ids, '{}'::integer[]);
  v_len   integer   := coalesce(pg_catalog.array_length(v_ids, 1), 0);
  v_count integer;
begin
  if p_collection_id is null then
    raise exception 'ZELL_INVALID_COLLECTION';
  end if;

  -- القفل بالمجموعة نفسها مش بصفوفها — مجموعة لسه مالهاش روابط مفيش
  -- فيها صفوف يقفلها FOR UPDATE (نفس درس 0009).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zell_set_collection_products:' || p_collection_id::text, 0)
  );

  if not exists (select 1 from public.collections where id = p_collection_id) then
    return null;
  end if;

  -- تكرار في القائمة. العمود مسمّى صريح برضه عشان نفس سبب اللي تحت.
  if (select pg_catalog.count(distinct w.pid) from pg_catalog.unnest(v_ids) w(pid)) <> v_len then
    raise exception 'ZELL_INVALID_COLLECTION_PRODUCTS';
  end if;

  -- ⚠️ `w(pid)` بالاسم الصريح **ضروري**: لو سمّينا العمود id، الـ id
  --    المجرّد جوه الاستعلام الداخلي بيتربط بـ products.id (النطاق
  --    الأقرب) فالشرط بيبقى p.id = p.id والفحص بيبقى بلا معنى.
  if exists (
    select 1 from pg_catalog.unnest(v_ids) w(pid)
    where not exists (select 1 from public.products p where p.id = w.pid)
  ) then
    raise exception 'ZELL_INVALID_COLLECTION_PRODUCTS';
  end if;

  delete from public.product_collections pc
  where pc.collection_id = p_collection_id
    and not (pc.product_id = any(v_ids));

  insert into public.product_collections (collection_id, product_id, sort_order)
  select p_collection_id, o.pid, o.ord
  from pg_catalog.unnest(v_ids) with ordinality o(pid, ord)
  on conflict (collection_id, product_id)
    do update set sort_order = excluded.sort_order;

  select pg_catalog.count(*) into v_count
  from public.product_collections where collection_id = p_collection_id;

  update public.collections set updated_at = now() where id = p_collection_id;

  return v_count;
end;
$function$;

-- drop شال الصلاحيات؟ لا — create or replace مابيلمسهاش. بنأكد بس.
do $verify$
declare
  v_sig text := 'public.zell_set_collection_products(bigint, integer[])';
  v_owner text;
  v_config text[];
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.proconfig into v_owner, v_config
  from pg_catalog.pg_proc p where p.oid = v_sig::regprocedure;

  if v_owner <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0011_OWNER: %', v_owner;
  end if;
  if v_config is null or not ('search_path=""' = any(v_config)) then
    raise exception 'ZELL_MIGRATION_0011_SEARCH_PATH: %', v_config;
  end if;
  if pg_catalog.has_function_privilege('anon', v_sig, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'ZELL_MIGRATION_0011_ANON_EXECUTE';
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'ZELL_MIGRATION_0011_MISSING_EXECUTE';
  end if;

  -- الفحص المصلّح لازم يكشف معرّف غير موجود فعلًا
  if not exists (
    select 1 from pg_catalog.unnest(array[999999]::integer[]) w(pid)
    where not exists (select 1 from public.products p where p.id = w.pid)
  ) then
    raise exception 'ZELL_MIGRATION_0011_CHECK_STILL_BROKEN';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;
