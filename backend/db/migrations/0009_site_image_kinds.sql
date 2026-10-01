-- =====================================================================
-- 0009 — صور الموقع: نوع hero + تفعيل ذرّي
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الترتيب: 0006 ← 0006a ← 0006b ← 0006c ← 0007 ← 0008 ← 0008a ← 0009
--
--  بتعمل تلات حاجات:
--    (1) توسيع قيد kind في site_images ليشمل 'hero'.
--    (2) فهرس فريد: صورة نشطة **واحدة** لكل نوع فردي (logo/hero).
--    (3) zell_activate_site_image — تبديل ذرّي للصورة النشطة.
--
--  ✅ **idempotent**: القيد بيتشال ويترجع، الفهرس if not exists،
--     والدالة create or replace (توقيع جديد، مفيش قديم يتشال).
--
--  ⚠️ **لازم تتنفّذ بدور postgres** — زي 0008، عشان ملكية الدالة.
--
--  ⚠️ **ليه بنمسح صف site_images القديم بدل ما نسيبه غير نشط:**
--     المطلوب هو عدم حذف **الملف** مباشرة، وده محقَّق — الدالة دي
--     مابتلمسش Storage خالص. لكن لو سبنا الصف القديم موجود وسجّلنا
--     ملفه في storage_orphans، أي تنظيف جاي هيمسح الملف ويسيب صف
--     بيشاور على ملف مش موجود. فالثابت اللي بنحافظ عليه:
--       **كل صف في site_images بيشاور على ملف حيّ**،
--       و storage_orphans هو المرجع الوحيد للملفات المستحقة للحذف.
--     نفس المنطق المكتوب في imageUpload.ts للمنتجات.
--
--  ⚠️ reason = 'replaced' موجودة أصلًا في قيد storage_orphans من
--     تصميم 0006 — مش قيمة جديدة، دي بالظبط حالتها.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (0) حارس الدور — قبل أي تعديل
-- ---------------------------------------------------------------------
do $guard$
begin
  if current_user <> 'postgres' then
    raise exception
      'ZELL_MIGRATION_0009_WRONG_ROLE: current_user=% — لازم postgres عشان الملكية ماتتغيّرش',
      current_user;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- (1) شرط مسبق — مايصحّش يبقى في أكتر من صورة نشطة لنوع فردي
--     لو الشرط ده مكسور، الفهرس تحت هيفشل برسالة غامضة. بنفشل بوضوح.
-- ---------------------------------------------------------------------
do $pre$
declare
  v_bad text;
begin
  select pg_catalog.string_agg(kind || '=' || cnt::text, ', ')
  into v_bad
  from (
    select kind, pg_catalog.count(*) as cnt
    from public.site_images
    where is_active and kind in ('logo','hero')
    group by kind having pg_catalog.count(*) > 1
  ) t;

  if v_bad is not null then
    raise exception 'ZELL_MIGRATION_0009_MULTIPLE_ACTIVE: %', v_bad;
  end if;
end
$pre$;

-- ---------------------------------------------------------------------
-- (2) توسيع kind ليشمل hero
-- ---------------------------------------------------------------------
alter table public.site_images drop constraint if exists site_images_kind_check;
alter table public.site_images add constraint site_images_kind_check
  check (kind = any (array['logo'::text, 'hero'::text, 'gallery'::text, 'material'::text]));

-- ---------------------------------------------------------------------
-- (3) صورة نشطة واحدة بالظبط لكل نوع فردي
--     gallery و material مستثنيين — دول متعددين بطبيعتهم.
-- ---------------------------------------------------------------------
create unique index if not exists site_images_one_active_singleton
  on public.site_images (kind)
  where is_active and kind in ('logo', 'hero');

-- ---------------------------------------------------------------------
-- (4) التبديل الذرّي
--     بترجّع id الصورة اللي بقت نشطة، أو null لو الهدف مش موجود.
-- ---------------------------------------------------------------------
create or replace function public.zell_activate_site_image(
  p_kind     text,
  p_image_id bigint
) returns bigint
language plpgsql
set search_path to ''
as $function$
begin
  if p_kind is null or p_kind not in ('logo', 'hero') then
    raise exception 'ZELL_SITE_IMAGE_KIND_INVALID';
  end if;

  -- قفل كل صفوف النوع — يمنع رفعتين متزامنتين من التداخل
  perform 1 from public.site_images where kind = p_kind for update;

  if not exists (
    select 1 from public.site_images where id = p_image_id and kind = p_kind
  ) then
    return null;
  end if;

  -- القديم: ملفه يتسجّل للتنظيف، وصفّه يتشال. Storage مابيتلمسش هنا.
  insert into public.storage_orphans (bucket, object_path, reason)
  select s.bucket, s.object_path, 'replaced'
  from public.site_images s
  where s.kind = p_kind and s.id <> p_image_id
  on conflict (bucket, object_path) do nothing;

  delete from public.site_images where kind = p_kind and id <> p_image_id;

  -- دلوقتي بس — مفيش نشط تاني من النوع ده، فالفهرس الفريد مرتاح
  update public.site_images
  set is_active = true, updated_at = now()
  where id = p_image_id;

  return p_image_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- (5) الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function public.zell_activate_site_image(text, bigint)
  from public, anon, authenticated;

grant execute on function public.zell_activate_site_image(text, bigint)
  to service_role;

-- ---------------------------------------------------------------------
-- (6) تحقق ذاتي
-- ---------------------------------------------------------------------
do $verify$
declare
  v_count  integer;
  v_config text[];
  v_owner  text;
begin
  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_activate_site_image';
  if v_count <> 1 then
    raise exception 'ZELL_MIGRATION_0009_OVERLOAD: found % definitions', v_count;
  end if;

  -- Postgres بيخزّنها search_path="" بعلامتين — زي ما اتأكد في 0008
  select p.proconfig into v_config
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_activate_site_image';
  if v_config is null or not ('search_path=""' = any(v_config)) then
    raise exception 'ZELL_MIGRATION_0009_SEARCH_PATH: %', v_config;
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner) into v_owner
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_activate_site_image';
  if v_owner <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0009_OWNER: owner=%', v_owner;
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.zell_activate_site_image(text, bigint)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.zell_activate_site_image(text, bigint)', 'execute') then
    raise exception 'ZELL_MIGRATION_0009_ANON_EXECUTE';
  end if;

  if not pg_catalog.has_function_privilege('service_role', 'public.zell_activate_site_image(text, bigint)', 'execute') then
    raise exception 'ZELL_MIGRATION_0009_MISSING_EXECUTE';
  end if;

  -- hero مقبولة فعلًا في القيد
  if not exists (
    select 1 from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'site_images'
      and con.conname = 'site_images_kind_check'
      and pg_catalog.pg_get_constraintdef(con.oid) like '%hero%'
  ) then
    raise exception 'ZELL_MIGRATION_0009_KIND_CHECK_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'site_images'
      and indexname = 'site_images_one_active_singleton'
  ) then
    raise exception 'ZELL_MIGRATION_0009_INDEX_MISSING';
  end if;
end
$verify$;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- التراجع (للمرجع)
-- =====================================================================
--  begin;
--    drop function if exists public.zell_activate_site_image(text, bigint);
--    drop index if exists public.site_images_one_active_singleton;
--    delete from public.site_images where kind = 'hero';
--    alter table public.site_images drop constraint if exists site_images_kind_check;
--    alter table public.site_images add constraint site_images_kind_check
--      check (kind = any (array['logo'::text, 'gallery'::text, 'material'::text]));
--    notify pgrst, 'reload schema';
--  commit;
--  ⚠️ حذف صفوف hero مابيمسحش ملفاتها — سجّلها في storage_orphans الأول.
