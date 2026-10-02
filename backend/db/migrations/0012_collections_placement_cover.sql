-- =====================================================================
-- 0012 — الأقسام: ظهور منفصل + صورة غلاف + القسم الجديد أولًا
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الترتيب: 0010 ← 0011 ← 0012
--
--  بتعمل:
--    (1) show_on_home و show_in_nav — قيمتهم الأولى من is_visible، فمفيش
--        قسم بيتغيّر ظهوره لحظة التنفيذ.
--    (2) أعمدة صورة الغلاف (bucket · object_path · الأبعاد) — اختيارية.
--    (3) سبب 'removed' في storage_orphans (شيل غلاف، أو حذف قسم بغلاف).
--    (4) zell_create_collection     — إنشاء ذرّي في **أول** الترتيب.
--    (5) zell_reorder_collections   — نفس الدالة + نفس قفل الترتيب.
--    (6) zell_set_collection_cover  — تبديل/شيل الغلاف ذرّيًا.
--    (7) zell_delete_collection     — حذف بتزامن تفاؤلي + تسجيل الغلاف للتنظيف.
--
--  ⚠️ **إضافة بس.** is_visible باقي عشان نسخة المتجر المنشورة دلوقتي
--     بتقراه لحد ما الكود الجديد ينزل. اللوحة الجديدة بتكتبه
--     = show_on_home or show_in_nav، فالنسختين متسقين طول فترة الانتقال.
--     شيله في migration لاحقة بعد ما النسخة الجديدة تستقر.
--
--  ⚠️ ترتيب النشر: الـ migration دي **قبل** دمج كود الأقسام. الكود
--     الجديد بيقرا الأعمدة الجديدة، والقديم مابيتأثرش بيها.
--
--  ⚠️ idempotent: add column if not exists، والقيود drop if exists ثم
--     add، والدوال create or replace، والـ backfill للقيم الفاضية بس.
--
--  ⚠️ لازم تتنفّذ بدور postgres — زي 0010.
--
--  ⚠️ قفل الترتيب: advisory lock واحد ('zell_collections_order') بين
--     الإنشاء والترتيب والحذف. الإنشاء بيزحزح كل الأقسام خانة، فلو
--     اتنفّذ جنب ترتيب في نفس اللحظة كان واحد منهم هيكتب على التاني.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (0) حارس الدور
-- ---------------------------------------------------------------------
do $guard$
begin
  if current_user <> 'postgres' then
    raise exception
      'ZELL_MIGRATION_0012_WRONG_ROLE: current_user=% — لازم postgres عشان الملكية ماتتغيّرش',
      current_user;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- (1) الظهور المنفصل
-- ---------------------------------------------------------------------
alter table public.collections
  add column if not exists show_on_home boolean,
  add column if not exists show_in_nav  boolean;

-- القيم الفاضية بس — إعادة التنفيذ مابتلمسش اختيارات الأدمن
update public.collections set show_on_home = is_visible where show_on_home is null;
update public.collections set show_in_nav  = is_visible where show_in_nav  is null;

alter table public.collections
  alter column show_on_home set default true,
  alter column show_on_home set not null,
  alter column show_in_nav  set default true,
  alter column show_in_nav  set not null;

-- ---------------------------------------------------------------------
-- (2) صورة الغلاف — المسار بس، الرابط بيتركّب في packages/core
-- ---------------------------------------------------------------------
alter table public.collections
  add column if not exists cover_bucket      text,
  add column if not exists cover_object_path text,
  add column if not exists cover_width_px    integer,
  add column if not exists cover_height_px   integer;

-- الأربع أعمدة يا كلهم فاضيين يا كلهم موجودين — مفيش غلاف نصّه ناقص
alter table public.collections drop constraint if exists collections_cover_complete;
alter table public.collections add constraint collections_cover_complete check (
  (cover_object_path is null and cover_bucket is null
     and cover_width_px is null and cover_height_px is null)
  or
  (cover_object_path is not null and cover_bucket is not null
     and cover_width_px > 0 and cover_height_px > 0)
);

-- المسار بيتبنى في السيرفر: collections/<id>/<uuid>.<ext>
alter table public.collections drop constraint if exists collections_cover_path_format;
alter table public.collections add constraint collections_cover_path_format check (
  cover_object_path is null
  or cover_object_path ~ '^collections/[0-9]+/[0-9a-f-]{36}\.(jpg|png|webp)$'
);

-- ---------------------------------------------------------------------
-- (3) سبب التنظيف الجديد
-- ---------------------------------------------------------------------
alter table public.storage_orphans drop constraint if exists storage_orphans_reason_check;
alter table public.storage_orphans add constraint storage_orphans_reason_check
  check (reason = any (array['insert_failed', 'delete_failed', 'replaced', 'removed']));

-- ---------------------------------------------------------------------
-- (4) إنشاء قسم في أول الترتيب
-- ---------------------------------------------------------------------
create or replace function public.zell_create_collection(
  p_slug         text,
  p_title        text,
  p_subtitle     text,
  p_show_on_home boolean,
  p_show_in_nav  boolean
) returns bigint
language plpgsql
set search_path = ''
as $fn$
declare
  v_id bigint;
begin
  if p_slug is null or p_title is null or p_show_on_home is null or p_show_in_nav is null then
    raise exception 'ZELL_INVALID_COLLECTION';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zell_collections_order', 0)
  );

  if exists (select 1 from public.collections c where c.slug = p_slug) then
    raise exception 'ZELL_COLLECTION_SLUG_TAKEN';
  end if;

  -- كل الأقسام خانة لتحت، والجديد في الخانة صفر.
  -- ⚠️ where صريح: Supabase ممكن يرفض update من غير where (safeupdate).
  update public.collections c set sort_order = c.sort_order + 1 where c.sort_order >= 0;

  begin
    insert into public.collections
      (slug, title_ar, subtitle_ar, is_visible, show_on_home, show_in_nav, sort_order)
    values
      (p_slug, p_title, p_subtitle, p_show_on_home or p_show_in_nav, p_show_on_home, p_show_in_nav, 0)
    returning id into v_id;
  exception when unique_violation then
    -- سباق نادر بعد الفحص فوق. الـ raise بيلغي الزحزحة كمان.
    raise exception 'ZELL_COLLECTION_SLUG_TAKEN';
  end;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- (5) الترتيب — نفس منطق 0010 + قفل الترتيب المشترك
-- ---------------------------------------------------------------------
create or replace function public.zell_reorder_collections(p_ids bigint[])
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  actual_count  integer;
  updated_count integer;
begin
  if p_ids is null or pg_catalog.array_length(p_ids, 1) is null then
    raise exception 'ZELL_INVALID_ORDER';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zell_collections_order', 0)
  );

  if (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_ids) id)
     <> pg_catalog.array_length(p_ids, 1) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;

  select pg_catalog.count(*) into actual_count from public.collections;
  if actual_count <> pg_catalog.array_length(p_ids, 1)
     or exists (select 1 from public.collections c where not (c.id = any(p_ids))) then
    raise exception 'ZELL_INVALID_ORDER';
  end if;

  update public.collections c
  set sort_order = o.ord, updated_at = pg_catalog.now()
  from pg_catalog.unnest(p_ids) with ordinality o(id, ord)
  where c.id = o.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$fn$;

-- ---------------------------------------------------------------------
-- (6) الغلاف: تبديل أو شيل (p_object_path = null)
--
--  بترجّع updated_at الجديد، أو null لو القسم مش موجود.
--  الملف القديم **مابيتمسحش هنا** — بيتسجّل في storage_orphans بنفس
--  نموذج zell_activate_site_image، والحذف الفعلي شغل التنظيف.
-- ---------------------------------------------------------------------
create or replace function public.zell_set_collection_cover(
  p_collection_id bigint,
  p_bucket        text,
  p_object_path   text,
  p_width_px      integer,
  p_height_px     integer
) returns timestamptz
language plpgsql
set search_path = ''
as $fn$
declare
  v_old_bucket text;
  v_old_path   text;
  v_updated    timestamptz;
begin
  if p_collection_id is null then
    raise exception 'ZELL_INVALID_COLLECTION';
  end if;

  select c.cover_bucket, c.cover_object_path
  into v_old_bucket, v_old_path
  from public.collections c
  where c.id = p_collection_id
  for update;

  if not found then
    return null;
  end if;

  if v_old_path is not null and v_old_path is distinct from p_object_path then
    insert into public.storage_orphans (bucket, object_path, reason)
    values (
      v_old_bucket,
      v_old_path,
      case when p_object_path is null then 'removed' else 'replaced' end
    )
    on conflict (bucket, object_path) do nothing;
  end if;

  update public.collections c
  set cover_bucket      = case when p_object_path is null then null else p_bucket end,
      cover_object_path = p_object_path,
      cover_width_px    = case when p_object_path is null then null else p_width_px end,
      cover_height_px   = case when p_object_path is null then null else p_height_px end,
      updated_at        = pg_catalog.now()
  where c.id = p_collection_id
  returning c.updated_at into v_updated;

  return v_updated;
end;
$fn$;

-- ---------------------------------------------------------------------
-- (7) حذف قسم
--
--  'DELETED' | 'CONFLICT' | 'NOT_FOUND'
--  المقارنة بدقة الميلي ثانية — نفس lib/mutations/concurrency.ts.
--  الروابط بتتشال بالـcascade من 0010، والغلاف بيتسجّل للتنظيف.
-- ---------------------------------------------------------------------
create or replace function public.zell_delete_collection(
  p_collection_id       bigint,
  p_expected_updated_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $fn$
declare
  v_updated timestamptz;
  v_bucket  text;
  v_path    text;
begin
  if p_collection_id is null or p_expected_updated_at is null then
    raise exception 'ZELL_INVALID_COLLECTION';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('zell_collections_order', 0)
  );

  select c.updated_at, c.cover_bucket, c.cover_object_path
  into v_updated, v_bucket, v_path
  from public.collections c
  where c.id = p_collection_id
  for update;

  if not found then
    return 'NOT_FOUND';
  end if;

  if pg_catalog.date_trunc('milliseconds', v_updated)
     <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    return 'CONFLICT';
  end if;

  if v_path is not null then
    insert into public.storage_orphans (bucket, object_path, reason)
    values (v_bucket, v_path, 'removed')
    on conflict (bucket, object_path) do nothing;
  end if;

  delete from public.collections c where c.id = p_collection_id;
  return 'DELETED';
end;
$fn$;

-- ---------------------------------------------------------------------
-- (8) الصلاحيات — service_role بس، زي كل دوال المشروع
-- ---------------------------------------------------------------------
revoke all on function public.zell_create_collection(text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.zell_reorder_collections(bigint[])                       from public, anon, authenticated;
revoke all on function public.zell_set_collection_cover(bigint, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.zell_delete_collection(bigint, timestamptz)               from public, anon, authenticated;

grant execute on function public.zell_create_collection(text, text, text, boolean, boolean) to service_role;
grant execute on function public.zell_reorder_collections(bigint[])                       to service_role;
grant execute on function public.zell_set_collection_cover(bigint, text, text, integer, integer) to service_role;
grant execute on function public.zell_delete_collection(bigint, timestamptz)               to service_role;

-- ---------------------------------------------------------------------
-- (9) تحقق ذاتي — أي فشل بيلغي المعاملة كلها
-- ---------------------------------------------------------------------
do $verify$
declare
  v_sig    text;
  v_config text[];
  v_owner  text;
begin
  if exists (select 1 from public.collections where show_on_home is null or show_in_nav is null) then
    raise exception 'ZELL_MIGRATION_0012_NULL_FLAGS';
  end if;

  foreach v_sig in array array[
    'public.zell_create_collection(text, text, text, boolean, boolean)',
    'public.zell_reorder_collections(bigint[])',
    'public.zell_set_collection_cover(bigint, text, text, integer, integer)',
    'public.zell_delete_collection(bigint, timestamptz)'
  ] loop
    select p.proconfig, pg_catalog.pg_get_userbyid(p.proowner)
    into v_config, v_owner
    from pg_catalog.pg_proc p
    where p.oid = v_sig::regprocedure;

    if v_config is null or not ('search_path=""' = any(v_config)) then
      raise exception 'ZELL_MIGRATION_0012_SEARCH_PATH: % %', v_sig, v_config;
    end if;

    if v_owner <> 'postgres' then
      raise exception 'ZELL_MIGRATION_0012_OWNER: % owner=%', v_sig, v_owner;
    end if;

    if pg_catalog.has_function_privilege('anon', v_sig, 'execute')
       or pg_catalog.has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'ZELL_MIGRATION_0012_ANON_EXECUTE: %', v_sig;
    end if;

    if not pg_catalog.has_function_privilege('service_role', v_sig, 'execute') then
      raise exception 'ZELL_MIGRATION_0012_MISSING_EXECUTE: %', v_sig;
    end if;
  end loop;

  if pg_catalog.has_table_privilege('anon', 'public.collections', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.collections', 'select') then
    raise exception 'ZELL_MIGRATION_0012_PUBLIC_SELECT';
  end if;

  -- قيد المسار بيرفض مسار من بره فعلًا
  if '../x.png' ~ '^collections/[0-9]+/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'ZELL_MIGRATION_0012_PATH_REGEX_BROKEN';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- التراجع (للمرجع)
-- =====================================================================
--  begin;
--    drop function if exists public.zell_delete_collection(bigint, timestamptz);
--    drop function if exists public.zell_set_collection_cover(bigint, text, text, integer, integer);
--    drop function if exists public.zell_create_collection(text, text, text, boolean, boolean);
--    -- zell_reorder_collections: أعد تنفيذ قسمها من 0010 (من غير القفل)
--    alter table public.collections drop constraint if exists collections_cover_path_format;
--    alter table public.collections drop constraint if exists collections_cover_complete;
--    alter table public.collections
--      drop column if exists cover_height_px,
--      drop column if exists cover_width_px,
--      drop column if exists cover_object_path,
--      drop column if exists cover_bucket,
--      drop column if exists show_in_nav,
--      drop column if exists show_on_home;
--    -- storage_orphans: رجّع القيد للتلات أسباب بعد ما تتأكد إن مفيش 'removed'
--    notify pgrst, 'reload schema';
--  commit;
--  ⚠️ لو فيه أغلفة مرفوعة، ملفاتها هتفضل في Storage — سجّلها في
--     storage_orphans قبل شيل الأعمدة.
