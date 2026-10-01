-- =====================================================================
-- 0008 — شريط الإعلان العلوي
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الترتيب: 0006a ← 0006b ← 0006c ← 0007 ← 0008
--
--  بتعمل حاجتين:
--    (1) مفتاح settings جديد اسمه announcement، مقفول افتراضياً.
--    (2) zell_save_content تاخد p_announcement وتحفظ المفتاح ده معاها.
--
--  ⚠️ **ليه drop ثم create مش create or replace:**
--     create or replace **مابيقدرش يغيّر التوقيع**. إضافة معامل بتعمل
--     دالة ثانية overloaded جنب القديمة، مش استبدال — وبعدها أي نداء
--     بستة معاملات يبقى غامض بين الاتنين. فالصح: drop للتوقيع القديم
--     بالظبط، ثم create للجديد.
--
--  ⚠️ **ليه p_announcement ليها DEFAULT null:**
--     عشان نشيل خطر ترتيب النشر. بين تنفيذ الـmigration ودمج الكود،
--     نسخة اللوحة المنشورة لسه بتبعت **ستة** معاملات. الـdefault بتخلّي
--     النداء ده يفضل شغّال، و null معناها **ماتلمسش الشريط** — فإعدادات
--     الشريط ماتتمسحش بالغلط. من غير ده، حفظ المحتوى كان هيقع في النافذة
--     دي، أو إعدادات الشريط كانت هتتصفّر.
--
--  ⚠️ drop بيشيل الصلاحيات، فبيتعاد منحها صريح تحت.
--     و0004_harden_default_privileges **لسه مش منفّذة**، يعني المحرّك
--     ممكن يمنح EXECUTE لـPUBLIC تلقائياً — فالـrevoke مش احتياطي، ضروري.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) المفتاح — مقفول، وقابل لإعادة التنفيذ
-- ---------------------------------------------------------------------
insert into public.settings (key, value, updated_at)
values (
  'announcement',
  '{"enabled": false, "text": "", "href": "", "ctaLabel": ""}'::jsonb,
  pg_catalog.now()
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- (2) الدالة — نفس الجسم + مفتاح سابع
-- ---------------------------------------------------------------------
drop function if exists public.zell_save_content(
  timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text);

create function public.zell_save_content(
  p_expected_updated_at timestamp with time zone,
  p_hero                jsonb,
  p_order_steps         jsonb,
  p_faqs                jsonb,
  p_sections            jsonb,
  p_footer_links        jsonb,
  p_trust_line          text,
  p_announcement        jsonb default null
) returns timestamp with time zone
language plpgsql
set search_path to ''
as $function$
declare
  current_version timestamptz;
  new_version     timestamptz := now();
  updated_count   integer;
  v_announcement  jsonb;
begin
  with locked as (
    select updated_at from public.settings
    where key in ('hero','order_steps','faqs','sections','footer_links','trust_line','announcement')
    for update
  ) select max(updated_at) into current_version from locked;

  if current_version is null
     or pg_catalog.date_trunc('milliseconds', current_version)
        <> pg_catalog.date_trunc('milliseconds', p_expected_updated_at) then
    return null;
  end if;

  -- null = سيب الشريط زي ما هو (نداء بستة معاملات من نسخة قديمة).
  select coalesce(p_announcement, s.value) into v_announcement
  from public.settings s where s.key = 'announcement';

  update public.settings s set value = v.value, updated_at = new_version
  from (values
    ('hero'::text, p_hero),
    ('order_steps', p_order_steps),
    ('faqs', p_faqs),
    ('sections', p_sections),
    ('footer_links', p_footer_links),
    ('trust_line', pg_catalog.to_jsonb(pg_catalog.btrim(p_trust_line))),
    ('announcement', v_announcement)
  ) v(key, value) where s.key = v.key;

  get diagnostics updated_count = row_count;
  if updated_count <> 7 then raise exception 'ZELL_CONTENT_KEYS_MISSING'; end if;
  return new_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- (3) الصلاحيات — drop شالها، والمنح الافتراضي لـPUBLIC لسه ممكن
-- ---------------------------------------------------------------------
revoke all on function public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------
-- (4) تحقق ذاتي
-- ---------------------------------------------------------------------
do $verify$
declare
  v_count  integer;
  v_config text[];
begin
  -- دالة واحدة بالاسم ده — مفيش overload سايبة
  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_save_content';
  if v_count <> 1 then
    raise exception 'ZELL_MIGRATION_0008_OVERLOAD: found % definitions', v_count;
  end if;

  select p.proconfig into v_config
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_save_content';
  if v_config is null or not ('search_path=' = any(v_config)) then
    raise exception 'ZELL_MIGRATION_0008_SEARCH_PATH: %', v_config;
  end if;

  if not exists (select 1 from public.settings where key = 'announcement') then
    raise exception 'ZELL_MIGRATION_0008_KEY_MISSING';
  end if;

  if pg_catalog.has_function_privilege('anon',
       'public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb)', 'execute')
     or pg_catalog.has_function_privilege('authenticated',
       'public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb)', 'execute') then
    raise exception 'ZELL_MIGRATION_0008_ANON_EXECUTE';
  end if;

  if not pg_catalog.has_function_privilege('service_role',
       'public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb)', 'execute') then
    raise exception 'ZELL_MIGRATION_0008_MISSING_EXECUTE';
  end if;
end
$verify$;

commit;

-- =====================================================================
-- التراجع (للمرجع)
-- =====================================================================
--  begin;
--    drop function if exists public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb);
--    -- ثم أعد تنفيذ تعريف الدالة بستة معاملات من 0008_rollback_reference
--    delete from public.settings where key = 'announcement';
--  commit;
--  ⚠️ التراجع لازم يتزامن مع تراجع كود اللوحة — الكود الجديد بيبعت
--     سبعة معاملات والدالة القديمة مابتعرفهمش.
