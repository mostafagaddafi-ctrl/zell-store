-- =====================================================================
-- 0008 — شريط الإعلان العلوي
--
--  الحالة: ✅ **منفّذة على production بتاريخ 2026-10-01** (مع 0008a)
--  الترتيب: 0006a ← 0006b ← 0006c ← 0007 ← 0008
--
--  بتعمل حاجتين:
--    (1) مفتاح settings جديد اسمه announcement، مقفول افتراضياً.
--    (2) zell_save_content تاخد p_announcement وتحفظ المفتاح ده معاها.
--
--  ✅ **الملف ده idempotent فعلاً** — تشغيله مرة أو عشرة بيوصل لنفس
--     الحالة بالظبط، من غير خطأ ومن غير أثر جانبي:
--       • المفتاح:    insert ... on conflict (key) do nothing
--       • الدالة:     drop للتوقيع القديم (no-op بعد أول مرة)
--                     + create **or replace** للتوقيع الجديد
--       • الصلاحيات:  revoke/grant بيوصلوا لنفس الـACL كل مرة
--       • التحقق:     قراءة بس، مابيكتبش حاجة
--
--  ⚠️ **عدد المعاملات — تفرقة لازم توضح:**
--       الدالة **القديمة = 7 معاملات** (من غير p_announcement)
--       الدالة **الجديدة = 8 معاملات** (بـ p_announcement)
--       وعدد **المفاتيح** اللي بتتكتب = 7.
--     العددين مختلفين ومابينطبقوش على بعض — ماتخلطش بينهم.
--
--  ⚠️ **ليه drop للتوقيع القديم + create or replace للجديد:**
--     create or replace **مابيقدرش يغيّر التوقيع**. زيادة معامل بتعمل
--     دالة تانية overloaded جنب القديمة مش استبدال ليها — فلازم drop
--     صريح للتوقيع القديم (7 أنواع) عشان تتشال.
--
--     وليه `or replace` مش `create` ساده؟ عشان إعادة التشغيل:
--     هوية الدالة في Postgres = الاسم + **قائمة الأنواع كاملة**،
--     والـ default مابيدخلش فيها. يعني drop بـ7 أنواع **مابيطابقش**
--     الدالة الجديدة (8 أنواع) أبداً. ففي التشغيل التاني الـdrop
--     بيبقى no-op، و`or replace` بتستبدل الدالة **في مكانها**.
--     لو كانت create ساده كان التشغيل التاني هيقع بخطأ 42723
--     (دالة بنفس الأنواع موجودة) والـtransaction كلها ترجع.
--
--     والترتيب ده (drop الأول) مقصود: مفيش أي لحظة بيتواجد فيها
--     التوقيعين مع بعض، فمفيش احتمال نداء غامض بين 7 و8 معاملات.
--     وفي إعادة التشغيل الدالة الجديدة **مابتتحذفش خالص** — بتتستبدل
--     في مكانها، فالـOID والمالك والصلاحيات بيتحفظوا.
--
--  ⚠️ **ليه p_announcement ليها DEFAULT null:**
--     عشان نشيل خطر ترتيب النشر. بين تنفيذ الـmigration ودمج الكود،
--     نسخة اللوحة المنشورة لسه بتبعت **7** معاملات. الـdefault بتخلّي
--     النداء ده يفضل شغّال، و null معناها **ماتلمسش الشريط** — فإعدادات
--     الشريط ماتتصفّرش بالغلط في النافذة دي.
--
--  ⚠️ drop بيشيل الصلاحيات، فبيتعاد منحها صريح تحت.
--     و0004_harden_default_privileges **لسه مش منفّذة**، يعني المحرّك
--     ممكن يمنح EXECUTE لـPUBLIC تلقائياً — فالـrevoke مش احتياطي، ضروري.
--
--  ⚠️ **لازم تتنفّذ بدور postgres.** drop+create بينقل ملكية الدالة
--     للدور المنفّذ. المالك الحالي في production هو postgres (زي كل
--     دوال zell_*)، فلو اتنفّذت بدور تاني الملكية هتتغيّر **بصمت**.
--     عشان كده في حارس تحت بيوقف التنفيذ قبل أي تعديل، وتحقق بعد
--     الإنشاء إن المالك فضل postgres.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (0) حارس الدور — قبل أي insert أو drop أو create
-- ---------------------------------------------------------------------
do $guard$
begin
  if current_user <> 'postgres' then
    raise exception
      'ZELL_MIGRATION_0008_WRONG_ROLE: current_user=% — لازم postgres عشان الملكية ماتتغيّرش',
      current_user;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- (1) المفتاح — مقفول، وقابل لإعادة التنفيذ
-- ---------------------------------------------------------------------
-- ⚠️ الطابع الزمني **مش** now().
--    zell_save_content بتقارن max(updated_at) على المفاتيح السبعة.
--    لو المفتاح الجديد بقى الأحدث، نسخة اللوحة اللي بتقرا ستة مفاتيح
--    بس هتبعت طابع أقدم فتاخد تعارض وهمي يمنع كل حفظ للمحتوى.
--    فبندخّله بنفس أحدث طابع موجود — ماكس الستة يفضل هو ماكس السبعة.
--    (production اتنفّذت عليه النسخة الأقدم بـnow()، واتصلّح بـ0008a.)
insert into public.settings (key, value, updated_at)
values (
  'announcement',
  '{"enabled": false, "text": "", "href": "", "ctaLabel": ""}'::jsonb,
  coalesce(
    (select pg_catalog.max(s.updated_at) from public.settings s
     where s.key in ('hero','order_steps','faqs','sections','footer_links','trust_line')),
    pg_catalog.now()
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- (2) الدالة — نفس الجسم + مفتاح سابع
--     drop بيطابق التوقيع القديم (7 أنواع) بس.
-- ---------------------------------------------------------------------
drop function if exists public.zell_save_content(
  timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text);

create or replace function public.zell_save_content(
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

  -- null = سيب الشريط زي ما هو (نداء بـ7 معاملات من نسخة لوحة قديمة).
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
  v_owner  text;
begin
  -- دالة واحدة بالاسم ده — مفيش overload سايبة
  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_save_content';
  if v_count <> 1 then
    raise exception 'ZELL_MIGRATION_0008_OVERLOAD: found % definitions', v_count;
  end if;

  -- ⚠️ Postgres بيخزّن `set search_path to ''` في proconfig بالشكل
  --    search_path="" بعلامتي تنصيص — مش search_path= فاضية.
  select p.proconfig into v_config
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_save_content';
  if v_config is null or not ('search_path=""' = any(v_config)) then
    raise exception 'ZELL_MIGRATION_0008_SEARCH_PATH: %', v_config;
  end if;

  -- الملكية لازم تفضل postgres زي كل دوال zell_*
  select pg_catalog.pg_get_userbyid(p.proowner) into v_owner
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'zell_save_content';
  if v_owner <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0008_OWNER: owner=% (المتوقع postgres)', v_owner;
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

-- ---------------------------------------------------------------------
-- (5) تنبيه PostgREST يعيد تحميل المخطط
--     من غيره النداء بـp_announcement ممكن يرجّع PGRST202 رغم إن
--     الدالة سليمة. NOTIFY بيتسلّم عند الـcommit، فلو التحقق فوق
--     رفع استثناء مش هيتبعت أصلاً.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- التراجع (للمرجع)
-- =====================================================================
--  begin;
--    drop function if exists public.zell_save_content(timestamp with time zone, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb);
--    -- ثم أعد تنفيذ تعريف الدالة بـ7 معاملات من 0008_rollback_reference
--    delete from public.settings where key = 'announcement';
--    notify pgrst, 'reload schema';
--  commit;
--  ⚠️ التراجع لازم يتزامن مع تراجع كود اللوحة — الكود الجديد بيبعت
--     **8** معاملات والدالة القديمة (**7**) مابتعرفهمش.
