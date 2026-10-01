-- =====================================================================
-- 0007 — تنضيف أسرار الإشعار من جدول settings
--
--  الحالة: مسودة للمراجعة — **لم تُنفّذ على أي محرّك**
--  الخطة:  docs/plans/ORDER-FLOW-PLAN.md §7.3 (ب٧ · الخطوة ٤)
--  الترتيب: 0006a ← 0006b ← 0006c ← 0007
--
--  بتحذف صفّين من public.settings وبس:
--      telegram_bot_token
--      telegram_chat_id
--
--  **ليه:** مكان السر ده غلط من الأساس. `settings` جدول بيتعدّل من اللوحة،
--  فتوكن بوت فيه معناه سر في فورم. الأسرار بقت في متغيرات بيئة المتجر على
--  Vercel (§7.3)، والقيمتين دول بقوا **بيانات ميتة**.
--
--  ⚠️ الشرط المسبق **اتحقق**: اللوحة بطّلت تقراهم في PR #25 —
--     telegram_bot_token خرج من OPERATIONAL_KEYS، ومؤشر الجاهزية بقى بيتقاس
--     من نتيجة التسليم في orders مش من الإعداد. فالحذف ده **مش هيكسر أي
--     مؤشر**، لأن محدش بيقرا الصفّين أصلاً.
--
--  ⚠️ نطاق مقفول عن قصد:
--     • **مفيش** drop column ولا drop table.
--     • **مفيش** أي تعديل على صلاحيات أو أدوار أو RLS.
--     • **مفيش** لمس لـnotify_email ولا أي مفتاح تاني — شرط الحذف مساواة
--       صريحة على المفتاح الأساسي، فاستحالة بنيوية يطول غيرهم.
--
--  ⚠️ إعادة التنفيذ آمنة: التشغيلة التانية بتحذف صفر صفوف وبتعدّي عادي.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- (1) الحذف والتحقق — كتلة واحدة عشان نقارن قبل/بعد
--
--  الكتلة واحدة لأن المقارنة محتاجة قيم من قبل الحذف. DO blocks منفصلة
--  ما بتشاركش متغيرات حتى جوه نفس المعاملة.
-- ---------------------------------------------------------------------
do $cleanup$
declare
  c_targets  constant text[] := array['telegram_bot_token', 'telegram_chat_id'];

  v_before_targets integer;
  v_before_total   integer;
  v_after_targets  integer;
  v_after_total    integer;
  v_deleted        integer;
begin
  ------------------------------------------------------------------
  -- قبل
  ------------------------------------------------------------------
  select pg_catalog.count(*) into v_before_targets
  from public.settings where key = any(c_targets);

  select pg_catalog.count(*) into v_before_total from public.settings;

  -- notify_email **مش سر** وليه دور معلن في §7.4. وجوده قبل وبعد هو
  -- الحارس العملي على إن الحذف ما طالش حاجة تانية.
  if not exists (select 1 from public.settings where key = 'notify_email') then
    raise exception 'ZELL_MIGRATION_0007_NOTIFY_EMAIL_MISSING: الجدول مش في الحالة المتوقعة';
  end if;

  raise notice 'ZELL_MIGRATION_0007_BEFORE: targets=% total=%', v_before_targets, v_before_total;

  ------------------------------------------------------------------
  -- الحذف — مساواة صريحة على المفتاح الأساسي، ولا حاجة غيرها
  ------------------------------------------------------------------
  delete from public.settings where key = any(c_targets);
  get diagnostics v_deleted = row_count;

  ------------------------------------------------------------------
  -- بعد
  ------------------------------------------------------------------
  select pg_catalog.count(*) into v_after_targets
  from public.settings where key = any(c_targets);

  select pg_catalog.count(*) into v_after_total from public.settings;

  -- (أ) المفتاحين اختفوا
  if v_after_targets <> 0 then
    raise exception 'ZELL_MIGRATION_0007_TARGETS_REMAIN: still %', v_after_targets;
  end if;

  -- (ب) **ولا صف زيادة اتحذف.** ده الحارس الأهم في الملف:
  --     الإجمالي بعد = الإجمالي قبل ناقص المحذوف بالظبط.
  if v_after_total <> v_before_total - v_deleted then
    raise exception 'ZELL_MIGRATION_0007_COLLATERAL: before=% deleted=% after=%',
      v_before_total, v_deleted, v_after_total;
  end if;

  -- (ج) notify_email لسه مكانه
  if not exists (select 1 from public.settings where key = 'notify_email') then
    raise exception 'ZELL_MIGRATION_0007_NOTIFY_EMAIL_LOST';
  end if;

  raise notice 'ZELL_MIGRATION_0007_AFTER: deleted=% total=%', v_deleted, v_after_total;
end
$cleanup$;

commit;

-- =====================================================================
-- التراجع (للمرجع — مش بيتنفّذ تلقائياً)
-- =====================================================================
--  begin;
--    insert into public.settings (key, value, updated_at) values
--      ('telegram_bot_token', '""'::jsonb, pg_catalog.now()),
--      ('telegram_chat_id',   '""'::jsonb, pg_catalog.now())
--    on conflict (key) do nothing;
--  commit;
--
--  ⚠️ التراجع بيرجّع **قيم فاضية بس**. ممنوع منعاً باتاً حط توكن حقيقي في
--     الجدول ده تاني — ده الخطأ اللي الـmigration دي موجودة عشان تشيله.
--     ومفيش داعي للتراجع أصلاً: مفيش كود بيقرا المفتاحين.
