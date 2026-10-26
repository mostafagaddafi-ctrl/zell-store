# عقد حذف المنتج (PRODUCT-DELETE)

> **مسودة للمراجعة — ممنوع التنفيذ.** مفيش كود ولا SQL ولا أي تشغيل على Production قبل اعتماد العقد. كل خطوة Production بموافقة صريحة منفصلة من المالك.

| | |
| --- | --- |
| الحالة | مسودة — المراجعة 2 (2026-10-26)، بعد ملاحظات المراجع على `b85e39a` |
| المستوى | الأول: مسح بيانات + دوال وtrigger داتابيز جديدة + دور وصلاحيات |
| الأساس | zell-store main `7992d79` · الذاكرة `ccc7c0b` · `04-DB-SAFETY.md` (الهوية من الجلسة، النتيجة صفوف) · نمط `zell_shipping_options_save` (EXPRESS-SHIPPING) |
| علاقته بـ IMAGE-CLEANUP | العقد ده **مابيمسحش ملفات من Storage**. صور المنتج المحذوف بتتسجّل في `storage_orphans`، ومسحها الفعلي من شغل IMAGE-CLEANUP (عقد لوحده بعده) |

## ١) طلب المالك وقراراته (2026-10-26)
- حذف منتجات التجارب، وميزة حذف دايمة للمستقبل (ومنها لما النظام يتباع لمحل تاني).
- **الحذف للمالك بس** (مش للأدمن).
- **لازم المنتج يكون مخفي الأول** (`is_active = false`) علشان الحذف يتاح.
- المنتج اللي **اتباع قبل كده** (ليه سطر في أي طلب) أو **ليه مخزون** مايتمسحش؛ بيفضل «إخفاء».
- **قرار المراجع (2026-10-26):** مالك الدوال دور مستقل `zell_catalog_definer`، مش توسيع دور الطلبات.

## ٢) اللي بيحصل في الحذف (معاملة واحدة)
| الحاجة | اللي بيحصل | المصدر |
| --- | --- | --- |
| صف `products` | بيتمسح | الدالة |
| `product_images` | بتتمسح بالـ cascade الموجود (`0003`) | FK |
| ملفات الصور في Storage | **مابتتمسحش**. بتتسجّل في `storage_orphans` بسبب جديد `product_deleted` (§٢-أ) قبل مسح الصفوف | الدالة |
| `product_widths` | بتتمسح بالـ cascade (`0015`) | FK |
| `product_addons` | بتتمسح بالـ cascade من الناحيتين (`product_id` و`addon_id`، `0016`): المنتج لو كان إضافة لأفلام تانية بيتشال منها | FK |
| `product_collections` | بتتمسح بالـ cascade (`0010`) | FK |
| `settings.home_products.ids` | id المنتج بيتشال، والترتيب وباقي الاختيارات زي ما هي، تحت قفل (§٥) | الدالة |
| أعمدة الصور القديمة في `products` (`image_url` …) | بتتمسح مع الصف. **ملفاتها مابتتسجّلش** (برّه النطاق، زي IMAGE-CLEANUP) | — |

### أ) تسجيل الصور في `storage_orphans`
- **القيد الحالي** `storage_orphans_reason_check` (`0012`) بيقبل `insert_failed · delete_failed · replaced · removed` بس. الـ migration بتبدّله بنفس الاسم ومعاه `product_deleted` (القيم القديمة زي ما هي). الرجوع بيرجّع القيد القديم بالحرف، وبيرفض لو فيه أي صف `product_deleted`.
- لكل `(bucket, object_path)` من صور المنتج، بعد قفل صفوف `storage_orphans` الموجودة للمسارات دي (`for update`):
  - **مفيش صف:** `insert` بـ `reason = 'product_deleted'` و`cleaned_at = null`.
  - **صف موجود و`cleaned_at is null`** (مستني تنظيف أصلًا): مفيش تغيير، وبيتعدّ في `images_already_pending`.
  - **صف موجود و`cleaned_at is not null`** (متعلّم إنه اتنظّف، يعني الملف المفروض اتمسح، وفيه صورة حية لسه بتشاور عليه): **تعارض → رفض كامل `45506`** من غير أي تغيير. مفيش «إعادة تفعيل» تلقائية للسجل؛ ده محتاج تحقيق.
- `insert` من غير `on conflict`: الحالات التلاتة بتتحسم بالقفل قبله، وأي تعارض فريد غير متوقع = خطأ والمعاملة كلها بترجع.

## ٣) بيرفض لو (من غير أي تغيير)
| الشرط | الكود |
| --- | --- |
| مش مالك شغّال (الجلسة + `admin_users`) | `45402` (من `zell_order_actor(true)`) |
| المنتج مش موجود | `45501` |
| النسخة اتغيّرت (`updated_at` ≠ المتوقع) | `45502` |
| المنتج ظاهر (`is_active = true`) | `45503` |
| ليه سطر في `order_items` (أي طلب، حتى ملغي أو تجربة) | `45504` |
| ليه مراجع مخزون، أو FK المخزون رفض (`23503`) | `45505` |
| صورة ليها سجل في `storage_orphans` متعلّم `cleaned_at` (§٢-أ) | `45506` |
| (trigger قايمة الرئيسية) حفظ قايمة فيها id منتج مش موجود | `45507` |

- الأكواد `45501`–`45507` مش مستخدمة (آخر كود مستخدم `45434`). CI بيتأكد إنها فريدة.
- **قيود الـ FK هي الحارس الأخير:** `order_items.product_id` (NO ACTION) وFKs المخزون (RESTRICT) بيمنعوا الحذف حتى لو الفحص اتخطّى.

## ٤) الدوال والدور والصلاحيات (migration لوحدها: `0022_product_delete.sql`)
### أ) الدوال
| الدالة | النوع | المالك | EXECUTE |
| --- | --- | --- | --- |
| `zell_product_delete(p_product_id integer, p_expected_updated_at timestamptz) returns jsonb` | volatile · security definer · `search_path = ''` | `zell_catalog_definer` | `authenticated` بس |
| `zell_product_delete_preview(p_product_id integer) returns jsonb` | stable · security definer · `search_path = ''` | `zell_catalog_definer` | `authenticated` بس |
| `zell_inv_product_stock_ref_exists(p_product_id integer) returns boolean` | stable · security definer · `search_path = ''` · بتنادي `zell_inv_product_has_stock_refs` | `zell_inventory_definer` | `zell_catalog_definer` بس |
| `zell_catalog_trg_home_products_guard()` (trigger) | security definer · `search_path = ''` | `zell_catalog_definer` | — |

- **ليه دالة مخزون جديدة:** `zell_inv_product_has_stock_refs` **security invoker** (`0020:643`)، فلو اتنادت من دور الكتالوج كانت هتقرا جداول المخزون بصلاحياته وRLS بتاعتها (policy لـ `zell_inventory_definer` بس) وترجّع `false` غلط. الغلاف الجديد بيشتغل كـ `zell_inventory_definer` اللي عنده القراية والـ policy أصلًا، فمفيش أي منحة لدور الكتالوج على جداول 0020.
- **`anon` و`service_role` و`PUBLIC`:** صفر على الأربعة. الهوية من JWT الجلسة، من غير `p_actor`.
- **خطوات `zell_product_delete` بالترتيب:** الممثل `zell_order_actor(true)` ← قفل صف `settings` بتاع `home_products` (`for update`، لو موجود) ← قفل صف المنتج (`for update`) ← النسخة (45502) ← الإخفاء (45503) ← الطلبات (45504) ← المخزون (45505) ← قفل وفحص سجلات `storage_orphans` وتسجيل الصور (45506) ← شيل id من `home_products` ← مسح المنتج (`23503` من FK المخزون ← 45505) ← النتيجة `{deleted, product_id, images_registered, images_already_pending, removed_from_home, addon_links, collection_links}`.
- **`zell_product_delete_preview`:** قراية بس: موجود؟ · مخفي؟ · فيه طلبات؟ · فيه مخزون؟ · عدد الصور والعروض وروابط الإضافات (الناحيتين) والأقسام · في الرئيسية؟ · فيه سجل orphan متعارض؟ · `updated_at`.

### ب) الدور `zell_catalog_definer` (NOLOGIN · NOINHERIT · NOBYPASSRLS) — أقل صلاحيات لازمة
| الكائن | المنحة | الـ policy (باسم `zell_catalog_definer_*`) | ليه |
| --- | --- | --- | --- |
| `products` | `SELECT (id, is_active, updated_at)` · `UPDATE (updated_at)` · `DELETE` | select `using (true)` · update `using (true) with check (false)` · delete `using (true)` | `for update` محتاج منحة UPDATE على عمود واحد وpolicy UPDATE بـ `using`؛ `with check (false)` بيمنع أي تعديل فعلي. الدوال مابتعدّلش صف منتج |
| `product_images` | `SELECT (product_id, bucket, object_path)` | select `using (true)` | تسجيل الصور + عدد المعاينة |
| `product_widths` | `SELECT (product_id)` | select `using (true)` | عدد المعاينة |
| `product_addons` | `SELECT (product_id, addon_id)` | select `using (true)` | عدد المعاينة (الناحيتين) |
| `product_collections` | `SELECT (product_id)` | select `using (true)` | عدد المعاينة |
| `order_items` | `SELECT (product_id)` | select `using (true)` | فحص «اتباع قبل كده» |
| `settings` | `SELECT (key, value, updated_at)` · `UPDATE (value, updated_at)` | select `using (key = 'home_products')` · update `using (key = 'home_products') with check (key = 'home_products')` | قفل وتعديل `home_products` **بس**؛ أي مفتاح تاني مش ظاهر للدور أصلًا |
| `storage_orphans` | `SELECT (id, bucket, object_path, cleaned_at)` · `UPDATE (cleaned_at)` · `INSERT (bucket, object_path, reason)` | select `using (true)` · update `using (true) with check (false)` · insert `with check (reason = 'product_deleted' and cleaned_at is null)` | قفل السجلات الموجودة (`for update`، من غير تعديل فعلي) + التسجيل بالسبب الجديد بس |
| `storage_orphans_id_seq` | `USAGE` | — | `bigserial` (`0006`) |
| `zell_order_actor(boolean)` · `zell_order_claims_actor()` · `zell_order_admin_role(uuid)` | `EXECUTE` | — | سلسلة الهوية: الأولتين **security invoker** فبيشتغلوا بصلاحيات المنادي، والتالتة definer (`postgres`) و`EXECUTE` بتاعها لـ `zell_order_definer` بس النهارده |
| `zell_inv_product_stock_ref_exists(integer)` | `EXECUTE` | — | فحص المخزون (§٤-أ) |

- **الـ cascade:** إجراءات الـ FK بتشتغل بصلاحيات مالك الجدول التابع ومن غير RLS، فالدور **مش** محتاج `DELETE` على الجداول التابعة. **لازم يتثبت في CI** (حذف ناجح بالدور ده بس).
- **مفيش أي منحة تانية.** CI بيقارن صلاحيات الدور بالجدول ده بالحرف (منح الأعمدة والجداول والـ policies والـ EXECUTE)، وأي زيادة = فشل.

## ٥) التزامن مع حفظ قايمة الرئيسية
- **النهارده:** `saveHomeProducts` (`apps/admin/lib/mutations/homeProducts.ts`) بيفحص إن الـ ids موجودة بقراية لوحدها، وبعدين `PATCH` كامل للقيمة من غير نسخة. ده يسيب نافذة: فحص قبل الحذف و`PATCH` بعده = id محذوف يرجع للقايمة.
- **الحل:** trigger `before insert or update of value on settings for each row when (new.key = 'home_products')` بدالة `zell_catalog_trg_home_products_guard`: بيقفل صفوف المنتجات اللي في `new.value->ids` (`for share`) وبيرفض بـ `45507` لو أي id مش موجود. كده الفحص والكتابة في نفس المعاملة، وأي حذف متزامن لمنتج في القايمة بيستنى أو بيكون اتعمل خلاص.
- **ترتيب الأقفال واحد في الاتنين (مفيش deadlock):** حفظ الرئيسية: صف `settings` (بالـ `PATCH`) ← صفوف المنتجات (`for share` في الـ trigger). الحذف: صف `settings` (`for update`) ← صف المنتج (`for update`).
- **النتيجة:**
  - حفظ قبل الحذف: الحذف بيقرا القيمة الجديدة بعد القفل، وبيشيل id المحذوف بس. **مفيش اختيار بيضيع.**
  - حذف قبل حفظ بنموذج قديم فيه id المحذوف: الـ trigger بيرفض (`45507`) من غير كتابة، واللوحة بتقول «في منتج اتحذف. حدّث الصفحة.». **الـ id مابيرجعش.**
  - حذفين متزامنين: بيتسلسلوا على قفل `settings`، والقايمة النهائية = الأصلية ناقص الاتنين بنفس الترتيب.
  - أرقام المنتجات `serial` ومابتتعادش، فـ id محذوف عمره ما يشاور على منتج تاني.
- **برّه النطاق:** حفظين للرئيسية من أدمنين في نفس الوقت (آخر واحد بيكسب) — سلوك موجود قبل العقد ده.
- **تعديل صغير في اللوحة:** `saveHomeProducts` بيربط الكود `45507` برسالة VALIDATION بدل خطأ داخلي.

## ٦) اللوحة
- في صفحة المنتج: كارت «حذف المنتج نهائيًا» **للمالك بس**، وبيظهر بس لما المنتج مخفي. لو ظاهر: سطر «أخفِ المنتج أولًا لإتاحة الحذف».
- الكارت بيعرض نتيجة `preview`: عدد الصور والعروض والأقسام، و«مستخدم كإضافة في N منتج»، و«موجود في الصفحة الرئيسية». لو فيه طلبات أو مخزون أو تعارض: سبب واضح ومفيش زرار.
- الزرار ← حوار تأكيد واحد بالأعداد ← النداء ← بعد النجاح: تحديث المتجر (`/api/revalidate`) ورجوع لقايمة المنتجات.
- النداء بجلسة المستخدم (`createAuthClient`)، من Server Action ملفوف بالصلاحية (`lib/access`) بفئة المالك. مفيش `p_actor` تحت `apps/admin`. مفيش capability جديدة في 0021-P.
- **نصوص اللوحة الجديدة بالفصحى المبسّطة الرسمية.**

## ٧) الملفات (PR الكود بعد اعتماد العقد)
- `backend/db/migrations/0022_product_delete.sql` + `_ptest` + `_verify` + `_rollback` (النتيجة صفوف، دروس 0021-P) · job CI جديد على PostgreSQL 17 · `build_from_scratch.list`.
- اللوحة: كارت الحذف · Server Action · قراية الـ preview · ربط `45507` في `saveHomeProducts` · حالات منطق خالص (suite جديدة).
- التوثيق: `docs/maps/db-map.md` (الدور والدوال والـ trigger والمنح والـ policies والأكواد وقيد `storage_orphans`) · `code-map.md` · العقد ده.

## ٨) CI (لازم قبل أي تشغيل)
- **الهوية:** مالك = نجاح · أدمن = 45402 · من غير جلسة أو ممثل مزوّر = رفض · `service_role` و`anon` مالهمش EXECUTE.
- **كل شرط في §٣ بكوده، ومن غير أي تغيير** (بصمة الجداول قبل وبعد).
- **حذف ناجح:** الصف والتوابع الخمسة اتمسحوا · الصور اتسجّلت بـ `product_deleted` · id اتشال من `home_products` والترتيب زي ما هو · منتجات تانية وطلبات وإعدادات تانية بصمتها زي ما هي.
- **سجلات `storage_orphans`:** مسار مستني تنظيف = مفيش صف جديد (`images_already_pending`) · مسار متعلّم `cleaned_at` = 45506 ومفيش تغيير · القيد الجديد بيقبل `product_deleted` والقديمة زي ما هي · الرجوع بيرفض لو فيه `product_deleted`.
- **أقل صلاحيات:** صلاحيات `zell_catalog_definer` = جدول §٤-ب بالحرف · محاولة الدور يعدّل منتج أو `cleaned_at` أو يكتب مفتاح `settings` تاني أو يسجّل بسبب تاني = مرفوضة · الـ cascade بالدور ده بس بينجح.
- **المخزون:** منتج عليه مراجع مخزون ← 45505 من الغلاف (مش `false` غلط) · الغلاف بيتنادى من دور الكتالوج بس.
- **FK كحارس أخير:** فحص الطلبات أو المخزون اتشال بشكل مصطنع ← الـ FK بيرفض والمعاملة بترجع كلها.
- **التزامن (جلستين فعليتين):**
  - حذفين متزامنين لمنتجين في القايمة ← الاتنين ينجحوا، والقايمة = الأصلية ناقص الاتنين بنفس الترتيب.
  - حذفين لنفس المنتج ← واحد ينجح والتاني 45501 بعد ما يستنى.
  - حفظ الرئيسية ثم حذف (بالترتيبين في التوقيت) ← مفيش اختيار ضايع، والـ id المحذوف بس اتشال.
  - حذف ثم حفظ بنموذج قديم فيه الـ id ← 45507 ومفيش كتابة · حفظ قديم من غير الـ id ← بينجح.
  - مفيش deadlock في أي ترتيب (lock_timeout قصير ويتسجّل لو حصل).
  - منتج جديد بعد الحذف بياخد id جديد.
- **الـ trigger مايكسرش الموجود:** حفظ الرئيسية العادي بينجح · حفظ المحتوى ومفاتيح `settings` التانية مش متأثرة.
- **التعديل في المنتج بين الـ preview والحذف** ← 45502.
- **rollback:** قبل أي حذف بيرجّع الحالة بالظبط (الدور والدوال والـ trigger والـ policies والمنح والقيد)؛ وبعد حذف بيرفض بسبب صفوف `product_deleted`، والمنتج المحذوف مايرجعش غير بالـ backup.

## ٩) على Production (كل خطوة بموافقة لوحدها)
- blob sha1 + main + الوقت UTC ← استعلام الأثر (baseline) ← backup ← ptest ← تطبيق ← verify ← استعلام الأثر بعد.
- بعد النشر: **المالك هو اللي بيحذف من اللوحة** بنفسه. مفيش حذف من شات التنفيذ.

## ١٠) ملاحظة مهمة عن منتجات التجارب
- أي منتج تجربة **اتطلب في طلب تجربة** (الطلبات الأربعة الحالية) **مش هيتمسح** (45504) لحد ما طلبات التجارب نفسها تتمسح (CLEAN-launch، مؤجّل). لحد ساعتها يفضل مخفي.

## ١١) برّه النطاق
- مسح ملفات من Storage (IMAGE-CLEANUP) · حذف منتج اتباع أو عليه مخزون · capability جديدة · مسح صورة منفردة أو استبدالها · الطلبات وطلبات التجارب · نسخة لحفظ الرئيسية بين أدمنين.

## ١٢) سجل التعديلات
- **2026-10-26 · المراجعة 2 (ملاحظات المراجع على `b85e39a`، Blocking):** قرار المراجع: `zell_catalog_definer` · (١) §٢-أ: سبب `product_deleted` بتوسيع القيد الحالي بنفس الاسم (والرجوع بيرجّعه)، والسجل الموجود: مستني = مفيش تغيير، متعلّم `cleaned_at` = رفض 45506 · (٢) §٤: جدول أقل صلاحيات بالأعمدة والـ policies (قفل المنتج بـ `UPDATE (updated_at)` و`with check (false)` · قراءات المعاينة · `USAGE` على تسلسل `storage_orphans` · سلسلة الهوية التلاتة · غلاف مخزون definer جديد لأن الدالة الحالية invoker · `settings` مقصورة على `home_products` بالـ policy) · (٣) §٥: trigger على `home_products` بيقفل المنتجات `for share` ويرفض id مش موجود، وترتيب أقفال واحد، واختبارات التزامن.
- **2026-10-26:** المسودة الأولى، بقرارات المالك في §١.
