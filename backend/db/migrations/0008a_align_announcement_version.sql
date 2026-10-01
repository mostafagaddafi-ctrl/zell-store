-- =====================================================================
-- 0008a — مزامنة طابع announcement الزمني مع باقي مفاتيح المحتوى
--
--  الحالة: ✅ **منفّذة على production بتاريخ 2026-10-01**
--  الترتيب: 0008 ← 0008a ← 0009
--
--  ⚠️ **ليه الملف ده موجود أصلًا:**
--     0008 أدخلت مفتاح announcement بـ pg_catalog.now()، فبقى **أحدث**
--     مفتاح محتوى. و zell_save_content بتحسب الإصدار كـ:
--         max(updated_at) على المفاتيح السبعة
--     بينما نسخة اللوحة المنشورة وقتها كانت بتقرا **ستة** مفاتيح بس
--     (CONTENT_KEYS من غير announcement) وبتبعت max عليهم.
--
--     النتيجة: الطابعين مختلفين، فالدالة كانت بترجّع null — تعارض
--     وهمي يمنع أي حفظ محتوى من اللوحة، وتحديث الصفحة **مابيصلحوش**
--     لأن اللوحة القديمة ماكانتش بتشوف المفتاح الجديد أصلًا.
--
--     المقاس اللي كان مفروض يتعمل من الأول: إدخال المفتاح بنفس
--     أحدث طابع للمحتوى بدل now() — وده المطبّق دلوقتي في 0008.
--     الملف ده بيوثّق التصحيح الأحادي اللي اتعمل على production
--     بدل تزوير تاريخ 0008 بأثر رجعي.
--
--  ✅ idempotent: إعادة التنفيذ بتحطّ نفس القيمة.
--  ⚠️ بعد ما نسخة اللوحة الجديدة تتنشر (بتقرا السبعة) الملف ده
--     مابيبقاش له أثر — بيفضل للسجل.
-- =====================================================================

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'ZELL_MIGRATION_0008A_WRONG_ROLE: current_user=%', current_user;
  end if;
end
$guard$;

update public.settings
set updated_at = (
  select pg_catalog.max(s2.updated_at) from public.settings s2
  where s2.key in ('hero','order_steps','faqs','sections','footer_links','trust_line')
)
where key = 'announcement';

do $verify$
declare
  v_six   timestamptz;
  v_seven timestamptz;
begin
  select pg_catalog.max(updated_at) into v_six from public.settings
  where key in ('hero','order_steps','faqs','sections','footer_links','trust_line');

  select pg_catalog.max(updated_at) into v_seven from public.settings
  where key in ('hero','order_steps','faqs','sections','footer_links','trust_line','announcement');

  if pg_catalog.date_trunc('milliseconds', v_six)
     <> pg_catalog.date_trunc('milliseconds', v_seven) then
    raise exception 'ZELL_MIGRATION_0008A_MISMATCH: six=% seven=%', v_six, v_seven;
  end if;
end
$verify$;

commit;
