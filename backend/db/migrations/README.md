# Migrations — قاعدة بيانات ZELL

ترقيم تسلسلي، كل ملف يتنفّذ مرة واحدة وبالترتيب. كل migration مكتوبة بحيث تعيد التنفيذ
بأمان (idempotent) قدر الإمكان، ومعاها قسم rollback للتراجع اليدوي.

> **حالة التطبيق على Production:** المصدر الوحيد هو [`08-HANDOFF-NOW.md`](https://github.com/mostafagaddafi-ctrl/zell-skills/blob/main/08-HANDOFF-NOW.md) في `zell-skills`. الملف ده مابيقولش إيه اللي اتطبّق.
>
> **سطور «الحالة» في راس ملفات الـ migration تاريخية:** اتكتبت وقت كتابة الملف ومابتتحدّثش، فممكن تكون قديمة. ماتعتمدش عليها.
>
> **الجدول تحت مش كامل.** الخريطة الكاملة (كل دور وجدول ودالة، ومتعرّف في أنهي ملف): `docs/maps/db-map.md`.

| الملف | الوصف |
| --- | --- |
| `../schema.sql` | الأساس (baseline): `products`, `orders`, `order_items`, `settings` + الفهارس والبيانات المبدئية |
| `0002_security_rls_grants.sql` | تشغيل RLS، سحب صلاحيات `anon`/`authenticated`، إنشاء bucket الصور |
| `0002_verification.md` | مقارنة 0002 بالحالة الفعلية — **مطابق لكن ناقص**، وفيه الفجوات المكتشفة |
| `0003_product_images.sql` | `product_images` + قيود: `sort_order >= 0`، الرئيسية لازم `kind='gallery'`، صيغة `checksum` sha256 hex |
| `0004_harden_default_privileges.sql` | إلغاء الصلاحيات الافتراضية لأي كائن جديد **بما فيها الدور الوهمي PUBLIC** + تنظيف الـ sequences والدوال |
| `0004_review_notes.md` | المالك الفعلي، تأثير 0004 على `service_role`، والـ default EXECUTE |
| `0005a_generate_order_number.sql` | `generate_order_number()` (كانت اعتمادية مفقودة) |
| `0005b_order_idempotency.sql` | أعمدة `idempotency_key` و`request_hash` + قيود الصيغة + الفهرس الفريد |
| `0005c_create_order_function.sql` | `create_order` بـ `search_path = ''`، تحقق JSON آمن، إعادة محاولة عند تصادم الرقم |
| `0005_role_model.md` | نموذج الأدوار وحدود حماية `zell_definer` |
| `0006_site_images.sql` | `site_images` (logo/gallery/material) + `storage_orphans` + قيود الترتيب والتفرّد |
| `0006a_order_columns.sql` | أعمدة الطلب الستة (idempotency · الجلسة · الإيصال) + الفهرس الفريد الجزئي + تحقق ذاتي |
| `0006b_order_functions.sql` | `zell_order_writer` (صفر صلاحيات جداول) + `zell_create_order` + `zell_get_order_receipt` + تحقق ذاتي |
| `0006c_order_receipt_expiry.sql` | `create or replace` لـ`zell_create_order` ترجّع `receipt_expires_at` في الإسقاط (إنشاء و replay) بدون أي تمديد — عشان الراوت يحسب `Max-Age` الحقيقي لكوكي الإيصال |
| `0007_cleanup_notify_secrets.sql` | حذف صفّي `telegram_bot_token` و`telegram_chat_id` من `settings` — الأسرار بقت في متغيرات بيئة المتجر |
| `0008_announcement_bar.sql` | مفتاح `announcement` + `zell_save_content` بتاخد معامل تامن `p_announcement` (القديمة 7 معاملات، الجديدة 8). **drop للتوقيع القديم + create or replace للجديد** — `create or replace` لوحده مابيغيّرش التوقيع، والـdrop لوحده بيخلّي التشغيل التاني يقع بخطأ 42723. **idempotent**: الـdrop بيطابق 7 أنواع بس فمابيلمسش الدالة الجديدة أبداً. لازم تتنفّذ بدور `postgres` (في حارس بيوقفها قبل أي تعديل لو الدور غلط) |
| `0008a_align_announcement_version.sql` | إرجاع `announcement.updated_at` لأحدث طابع محتوى. من غيرها `max` على السبعة ≠ `max` على الستة، فاللوحة المنشورة وقتها كانت بتاخد تعارض وهمي يمنع كل حفظ محتوى |
| `0009_site_image_kinds.sql` | `kind='hero'` في `site_images` + فهرس فريد لصورة نشطة واحدة لكل نوع فردي + `zell_activate_site_image` للتبديل الذرّي (بتسجّل القديم في `storage_orphans` بـ`replaced` وبتشيل صفّه، من غير ما تلمس Storage) |
| `0012_collections_placement_cover.sql` | الأقسام: `show_on_home` و`show_in_nav` (قيمتهم الأولى من `is_visible`) + أعمدة الغلاف + سبب `removed` في `storage_orphans` + `zell_create_collection` (القسم الجديد أولًا) + `zell_set_collection_cover` + `zell_delete_collection` + قفل ترتيب مشترك. **إضافة بس** — لازم تتنفّذ **قبل** دمج كود الأقسام |
| `0013_products_lock_width.sql` | `products.lock_width` (boolean · not null · default false) — تثبيت العرض في صفحة المنتج. عرض بس، `zell_create_order` مابتتلمسش |
| `0018_installation_fee.sql` (+ `_rollback` + `_ptest`) | فني التركيب: أعمدة التركيب والمنطقة على `orders` + قيد الإجمالي، `zell_create_order` بـ12 معامل (`p_area` · `p_installation`)، والإيصال. `lock_timeout` 5s. الرجوع بعد رجوع ونشر المتجر واللوحة |
| `0020_inventory_purchasing.sql` (+ `_rollback` + `_ptest` + `_verify`) | المخزون والمشتريات (المرحلة الأولى): مواقع (MAIN) · موردين · مستندات شراء بمصاريف مفصلة وخصم مورد · ترحيل كامل لـlots (رول/دفعة) · رصيد أول المدة · audit و commands append-only · 23 RPC owner-only مملوكة لـ `zell_inventory_definer` · حماية `products.sale_unit`. مفيش دفعات ولا آجل ولا ضرايب. `lock_timeout` 5s |
| `0021a_a1_order_cycle.sql` (+ `_ptest` + `_verify` + `_rollback`) | 0021-A A1 دورة الطلب: الحالتين `preparing`/`refused` ورا بوابة مقفولة افتراضيًا (`zell_order_gate`) · جدول الانتقالات · `order_events` append-only · الفترات · 11 دالة بهوية الجلسة (`authenticated` بس) · قفل PATCH الحالة بيشتغل بفتح البوابة. الطلبات القديمة ماتتلمسش. CI: `backend/db/ci/0021a_sql_ci.sh`. **الرجوع عنها قبل أي rollback لـ 0020.** `lock_timeout` 5s |
| `0021d_preferred_delivery.sql` (+ `_ptest` + `_verify` + `_rollback`) | 0021-D موعد التسليم المفضّل: أعمدة اللقطة على `orders` · `zell_create_order` بـ 14 معامل (`p_preferred_delivery`، 45415) بنفس المالك والصلاحيات · الإيصال · `zell_checkout_delivery_periods`. **قبل** نشر كود D. CI: `backend/db/ci/0021d_sql_ci.sh` (مقارنة قديم/جديد 480 حالة) |
| `0021a_p1_payments.sql` (+ `_ptest` + `_verify` + `_rollback`) | 0021-A P1 الدفعات ورسوم التأكيد: `orders.paid_piastres` (= الدفعات − الردود، بتكتبه الدوال بس) و`confirmation_fee_piastres` (لقطة) · `order_payments` append-only بـ idempotency · طرق الدفع الأربعة · إعدادات الرسوم (مقفولة ومن غير أرقام) والآجل (مقفول) · 24 دالة `zell_payment_*` (10 لـ authenticated) · قاعدتا المقدم والتسليم في دالة الانتقال (45419/45420) · `zell_create_order` (نفس التوقيع والمالك والصلاحيات، والفرق عمود الرسوم) · صلاحيتين في كتالوج 0021-P. محتاج سطر `zell.approved_by` بعد `begin;`. CI: `backend/db/ci/0021p1_sql_ci.sh` (مقارنة 520 حالة + حساب الرسوم DB = core + سيناريوهات الدفع) |
| `0021a_p2_checkout_fee.sql` (+ `_ptest` + `_verify` + `_rollback`) | 0021-A P2: دالة قراية واحدة `zell_checkout_confirmation_fee()` لـ `service_role` (إعداد رسوم التأكيد والسياسة للـ Checkout). بعد P1 وقبل نشر كود P2، والرجوع قبل أي رجوع لـ P1. CI: `backend/db/ci/0021p1_sql_ci.sh` (S95–S99) |
| `0021d2_delivery_settings.sql` (+ `_ptest` + `_verify` + `_rollback`) | 0021-D2 W1 تحكم المالك في موعد التسليم: صف إعداد `zell_delivery_settings` (القيم = السلوك الحالي) + سجل append-only + `zell_delivery_settings_get` / `_save` (`authenticated`، الحفظ للمالك، 45430) و`zell_checkout_delivery_settings` (`service_role`). مفيش تعديل في `zell_create_order`. بعد P2 وقبل نشر كود W2، والرجوع بعد revert W2 وبيرفض بأي سطر سجل. محتاج سطر `zell.approved_by` بعد `begin;`. CI: `backend/db/ci/0021d2_sql_ci.sh` |

> **ترتيب ملزم لمسار الطلب:** 0006a ← 0006b ← 0006c. و`0005a/0005b/0005c` **مرفوضة للتنفيذ** واستُبدلت بيهم (الخطة §2.1). ترتيبهم القديم كان 0004 ← 0005a ← 0005b ← 0005c.
>
> الراوت بيتوقّع `receipt_expires_at` في الإسقاط، وده جاي من `0006c`.
>
> **0007 — حارس الحالة الجزئية:** عدد المفتاحين قبل الحذف لازم يكون **0 أو 2** بالظبط.
> `2` = أول تنفيذ · `0` = إعادة تنفيذ آمنة · **`1` = المعاملة بتقف** بـ
> `ZELL_MIGRATION_0007_PARTIAL_STATE`، لأن ده معناه إن الجدول اتلمس بره
> الـmigrations والمفروض نفهم السبب مش نخفيه.
>
> `0006_site_images.sql` ميزة **مستقلة تماماً** — تشابه الرقم تنظيمي بحت، مش تسلسل، ومش شرط مسبق ولا لاحق.
> بدون 0004 الدوال الجديدة قابلة للتنفيذ من `PUBLIC` (كل الأدوار) تلقائياً.
> **0002 مش مصدر الحقيقة الوحيد**: هو توثيق لتعديل نُفّذ قبل كتابته.
> المرجع هو ناتج استعلامات التحقق في `0002_verification.md` — تتعاد قبل أي إطلاق.

## المؤجّل بوعي

- **تحديد المعدل المتقدم** (بصمة HMAC + نافذة): **مش في الداتابيز**. أي `raise exception`
  بيعمل rollback فبيلغي تحديث العدّاد، يعني المحاولات المرفوضة مش بتتعد. مكانه الصح
  الباك إند/الحافة، خارج الـ transaction. (كان في مسودة 0005 القديمة واتشال.)
- **حساب الهاش في الداتابيز**: اتشال. `pg_catalog.sha256` مش مضمونة، وpgcrypto في
  schema `extensions` — الباك إند بيحسب SHA-256 ويمرره، والداتابيز تتحقق من الصيغة.

## طريقة التنفيذ

Supabase Dashboard ← SQL Editor ← الصق محتوى الملف ← Run.
(أو `psql "$DATABASE_URL" -f backend/db/migrations/0003_product_images.sql`)

## قواعد متفق عليها

- **ممنوع** تنفيذ أي تغيير على production من غير migration مكتوبة ومراجَعة.
- **ممنوع** حذف أعمدة أو بيانات في نفس الـ migration اللي بتضيف البديل.
- كل منح صلاحيات لازم يسبقه `revoke ... from public` — المحرّك بيمنح لـ PUBLIC تلقائياً.
- `service_role` و`postgres` يفضلوا في مورد Retool/الباك إند فقط.
