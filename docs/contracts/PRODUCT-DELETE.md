# عقد حذف المنتج (PRODUCT-DELETE)

> **مسودة للمراجعة — ممنوع التنفيذ.** مفيش كود ولا SQL ولا أي تشغيل على Production قبل اعتماد العقد. كل خطوة Production بموافقة صريحة منفصلة من المالك.

| | |
| --- | --- |
| الحالة | مسودة — المراجعة 3 (2026-10-26)، بعد ملاحظات المراجع على `a953116` |
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
| `settings.home_products.ids` | id المنتج بيتشال، والترتيب وباقي الاختيارات زي ما هي، بالبروتوكول في §٥ | الدالة |
| أعمدة الصور القديمة في `products` (`image_url` …) | بتتمسح مع الصف. **ملفاتها مابتتسجّلش** (برّه النطاق، زي IMAGE-CLEANUP) | — |

### أ) تسجيل الصور في `storage_orphans` (مقبول من المراجع في المراجعة 2، من غير تغيير)
- **القيد الحالي** `storage_orphans_reason_check` (`0012`) بيقبل `insert_failed · delete_failed · replaced · removed` بس. الـ migration بتبدّله بنفس الاسم ومعاه `product_deleted` (القيم القديمة زي ما هي). الرجوع بيرجّع القيد القديم بالحرف، وبيرفض لو فيه أي صف `product_deleted`.
- لكل `(bucket, object_path)` من صور المنتج، بعد قفل صفوف `storage_orphans` الموجودة للمسارات دي (`for update nowait`، §٥):
  - **مفيش صف:** `insert` بـ `reason = 'product_deleted'` و`cleaned_at = null`.
  - **صف موجود و`cleaned_at is null`** (مستني تنظيف أصلًا): مفيش تغيير، وبيتعدّ في `images_already_pending`.
  - **صف موجود و`cleaned_at is not null`**: **تعارض → رفض كامل `45506`** من غير أي تغيير، ومن غير «إعادة تفعيل» تلقائية للسجل.
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
| **قفل مشغول:** مهلة انتظار القفل الأول أو صف المنتج خلصت (`55P03`)، أو أي قفل بعدهم مسكه كاتب تاني (`nowait`) | `45508` |

- الأكواد `45501`–`45508` مش مستخدمة (آخر كود مستخدم `45434`). CI بيتأكد إنها فريدة.
- `45508` معناه «فيه تعديل تاني شغّال على المنتج ده أو على القايمة دلوقتي»: مفيش أي تغيير، واللوحة بتقول «يتم تعديل هذا المنتج حاليًا. حاول مرة أخرى بعد لحظات.».
- **قيود الـ FK هي الحارس الأخير:** `order_items.product_id` (NO ACTION) وFKs المخزون (RESTRICT) بيمنعوا الحذف حتى لو الفحص اتخطّى.

## ٤) الدوال والدور والصلاحيات (migration لوحدها: `0022_product_delete.sql`)
### أ) الدوال
| الدالة | النوع | المالك | EXECUTE |
| --- | --- | --- | --- |
| `zell_product_delete(p_product_id integer, p_expected_updated_at timestamptz) returns jsonb` | volatile · security definer · `search_path = ''` · `set lock_timeout = '3s'` | `zell_catalog_definer` | `authenticated` بس |
| `zell_product_delete_preview(p_product_id integer) returns jsonb` | stable · security definer · `search_path = ''` | `zell_catalog_definer` | `authenticated` بس |
| `zell_inv_product_stock_ref_exists(p_product_id integer) returns boolean` | stable · security definer · `search_path = ''` · بتنادي `zell_inv_product_has_stock_refs` | `zell_inventory_definer` | `zell_catalog_definer` بس |
| `zell_catalog_trg_home_products_guard()` (trigger) | security definer · `search_path = ''` | `zell_catalog_definer` | — |

### ب) سلسلة فحص المخزون (تصحيح المراجعة 3)
- `zell_inv_product_has_stock_refs(integer)` (`0020:643`) **security invoker، ومالكها `postgres`**، و`EXECUTE` عليها مسحوب من `public, anon, authenticated, service_role` (`0020:3619`)، و**مفيش منحة لـ `zell_inventory_definer`** في ملفات 0020 أو 0020-S. فالغلاف لوحده مش هيشتغل.
- **الـ migration بتضيف منحة واحدة محددة:** `grant execute on function public.zell_inv_product_has_stock_refs(integer) to zell_inventory_definer`.
  - **الـ preflight** بيتأكد إن المنحة دي **مش موجودة** قبل التطبيق (`has_function_privilege` = false). لو موجودة: وقف (`ZELL_0022_PRE_INV_GRANT_EXISTS`) وتعديل العقد، علشان الرجوع يفضل محسوم.
  - **الرجوع** بيسحبها (`revoke execute … from zell_inventory_definer`)، لأنها اتأكد إنها ماكانتش موجودة.
- **وقت التشغيل:** الغلاف بيشتغل كـ `zell_inventory_definer` ← بينادي الـ helper (invoker) فبيقرا جداول المخزون بصلاحيات `zell_inventory_definer` وبالـ policy بتاعته. CI بيتأكد إن الدور ده عنده `SELECT` على `purchase_doc_lines` و`opening_stock_lines` و`stock_lots` والـ policy عليهم (أي نقص = وقف وتعديل العقد، مش منحة إضافية ضمنية).
- **تصحيح الشرح:** لو الـ helper اتنادى بدور **مالوش صلاحية على الجداول**، النتيجة **خطأ صلاحية** (`42501`)، مش `false`. أما لو الدور عنده صلاحية الجدول وRLS **بتخفي الصفوف** (مفيش policy ليه)، النتيجة `false` غلط من غير خطأ. الاتنين ممنوعين بالتصميم ده، والحالتين مختبرين.
- **CI بالأدوار الفعلية:** النداء بجلسة `authenticated` لمالك (JWT claims)، من غير `postgres` ولا `BYPASSRLS` ولا `set role` لدور مالك الكائنات: منتج عليه سطر شراء ← `45505` · منتج من غير مراجع ← `false` · سحب المنحة بشكل مصطنع ← خطأ ومفيش حذف.

### ج) الدور `zell_catalog_definer` (NOLOGIN · NOINHERIT · NOBYPASSRLS) — أقل صلاحيات لازمة
| الكائن | المنحة | الـ policy (باسم `zell_catalog_definer_*`) | ليه |
| --- | --- | --- | --- |
| `products` | `SELECT (id, is_active, updated_at)` · `UPDATE (updated_at)` · `DELETE` | select `using (true)` · update `using (true) with check (false)` · delete `using (true)` | قفل `for update` محتاج منحة UPDATE على عمود وpolicy UPDATE بـ `using`؛ `with check (false)` بيمنع أي تعديل فعلي |
| `product_images` | `SELECT (id, product_id, bucket, object_path)` · `UPDATE (product_id)` | select `using (true)` · update `using (true) with check (false)` | تسجيل الصور + قفل الصفوف `for update nowait` (§٥) |
| `product_widths` | `SELECT (product_id)` · `UPDATE (product_id)` | select · update `with check (false)` | عدد المعاينة + القفل |
| `product_addons` | `SELECT (product_id, addon_id)` · `UPDATE (product_id)` | select · update `with check (false)` | عدد المعاينة (الناحيتين) + القفل |
| `product_collections` | `SELECT (product_id)` · `UPDATE (product_id)` | select · update `with check (false)` | عدد المعاينة + القفل |
| `order_items` | `SELECT (product_id)` | select `using (true)` | فحص «اتباع قبل كده» |
| `settings` | `SELECT (key, value, updated_at)` · `UPDATE (value, updated_at)` | select `using (key = 'home_products')` · update `using (key = 'home_products') with check (key = 'home_products')` | قفل وتعديل `home_products` **بس** |
| `storage_orphans` | `SELECT (id, bucket, object_path, cleaned_at)` · `UPDATE (cleaned_at)` · `INSERT (bucket, object_path, reason)` | select `using (true)` · update `using (true) with check (false)` · insert `with check (reason = 'product_deleted' and cleaned_at is null)` | قفل السجلات (من غير تعديل فعلي) + التسجيل بالسبب الجديد بس |
| `storage_orphans_id_seq` | `USAGE` | — | `bigserial` (`0006`) |
| `zell_order_actor(boolean)` · `zell_order_claims_actor()` · `zell_order_admin_role(uuid)` | `EXECUTE` | — | سلسلة الهوية (الأولتين invoker، والتالتة definer و`EXECUTE` بتاعها لـ `zell_order_definer` بس النهارده) |
| `zell_inv_product_stock_ref_exists(integer)` | `EXECUTE` | — | فحص المخزون (§٤-ب) |

- **الـ cascade:** إجراءات الـ FK بتشتغل بصلاحيات مالك الجدول التابع ومن غير RLS، فالدور **مش** محتاج `DELETE` على الجداول التابعة. **لازم يتثبت في CI** (حذف ناجح بالدور ده بس).
- **مفيش أي منحة تانية** (ولا لـ `zell_inventory_definer` غير منحة §٤-ب). CI بيقارن صلاحيات الدورين بالجدول ده بالحرف، وأي زيادة = فشل.

## ٥) بروتوكول الأقفال (تصحيح المراجعة 3)
### أ) القفل المشترك للقايمة: advisory بدل قفل صف الإعداد
- **مفتاح ثابت:** `pg_advisory_xact_lock(hashtextextended('zell_catalog:home_products', 0))` (اسمه M). مستقل عن وجود صف `settings`، فبيغطي **أول إنشاء** لـ `home_products` زي التعديل. CI بيتأكد إن النص ده مش مستخدم كمفتاح في أي ملف تاني (المفاتيح الحالية `zell_inv:` وغيرها مختلفة).
- **مين بياخده:**
  - `zell_product_delete`: **أول خطوة** بعد الهوية.
  - trigger `before insert or update of value on settings for each row when (new.key = 'home_products')`: أول سطر في الدالة. بيشتغل مع أي كتابة على الصف ده، ومنها `PATCH` و`INSERT` بتوع `saveHomeProducts` الحالي ومنها تعديل `zell_product_delete` نفسه (القفل reentrant في نفس الجلسة).
- **الـ trigger مابيقفلش صفوف منتجات خالص** (اتشال `for share` من المراجعة 2). بعد M بيفحص إن كل id في `new.value->'ids'` موجود بقراية عادية، وإلا `45507`. ده كافي لأن أي حذف لازم يمسك M لحد الـ commit: مفيش حذف يقدر يحصل بين فحص الـ trigger وكتابته، وأي حذف خلص قبله بيبان في الفحص.

### ب) ترتيب أقفال `zell_product_delete` (مايستناش غير على قفلين)
| # | القفل | طريقته | لو مش متاح |
| --- | --- | --- | --- |
| 1 | M | `pg_advisory_xact_lock` (بيستنى لحد `lock_timeout = '3s'`) | `45508` |
| 2 | صف المنتج | `for update` (بيستنى لحد `lock_timeout`) | `45508` |
| 3 | صف `settings` بتاع `home_products` (لو موجود) | `for update nowait` | `45508` فورًا |
| 4 | صفوف `product_images` · `product_widths` · `product_collections` · `product_addons` (`product_id = id` أو `addon_id = id`) | `for update nowait` | `45508` فورًا |
| 5 | صفوف `storage_orphans` لمسارات الصور | `for update nowait` | `45508` فورًا |

- **القاعدة:** الدالة **مابتستناش أي قفل وهي ماسكة صف المنتج** غير اللي اتاخدوا بالترتيب ده بـ `nowait`. يعني ماتقدرش تكون جزء من حلقة انتظار بعد الخطوة 2.
- **ليه مفيش حلقة مع الخطوتين 1 و2:**
  - اللي ماسك M (حذف تاني أو كتابة للقايمة) مابيستناش صف منتج ماسكه الحذف: الحذف التاني بياخد M الأول، والـ trigger مابيقفلش منتجات.
  - اللي ماسك صف المنتج (تعديل منتج · عروض · إضافات · صور · مخزون) مابياخدش M ولا صف `settings`.
- **غياب صف `settings`:** الخطوة 3 بتلاقي مفيش صف ومابتستناش. أول `INSERT` للقايمة متسلسل مع الحذف عن طريق M بس (الـ trigger بيمسكه قبل ما الإدراج يكمّل).

### ج) مسارات الكتابة المتداخلة (من غير تعديل فيها)
| المسار | بيقفل إيه النهارده (من الملفات) | التفاعل مع الحذف |
| --- | --- | --- |
| `saveHomeProducts` (`PATCH` أو `INSERT` على `settings`) | صف الإعداد، **ودلوقتي** M من الـ trigger | لو الحذف ماسك M: بيستنى ثم بيفحص (الـ id المحذوف = `45507`). لو هو ماسك الصف وبيستنى M: الحذف في الخطوة 3 بيلاقي الصف مقفول = `45508` فورًا، فالحفظ بيكمّل |
| `zell_set_product_widths` (`0015:42`) · `zell_set_product_addons` (`0016:44`) | صف منتجهم `for update` أولًا | نفس المنتج: بيتسلسلوا على الخطوة 2 (والحذف بعدها بيلاقي `updated_at` اتغيّر = `45502`). منتج تاني فيه المحذوف كإضافة: صفوف `product_addons` بتاعته = الخطوة 4 بـ `nowait`؛ لو الكاتب سبق = `45508`، ولو الحذف سبق الكاتب بيستنى ثم بيفشل بـ FK (المنتج اتمسح) من غير تغيير جزئي |
| `zell_set_collection_products` (advisory خاص بيه، `0011:64`) | صفوف `product_collections` بتاعة القسم | الخطوة 4 بـ `nowait`؛ لو سبق = `45508`، ولو الحذف سبق بيستنى ثم بيفشل بـ FK |
| `zell_reorder_products` (تعديل `sort_order` لصفوف كتير) | صفوف المنتجات | لو ماسك صف المحذوف: الحذف بيستنى (الخطوة 2، `lock_timeout`). لو الحذف سبق: الترتيب بيستنى ثم بيعدّي على صف ممسوح |
| صور المنتج (رفع · ترتيب · رئيسية) | صف المنتج أو صفوف صوره | الخطوة 2 أو 4 |
| المخزون `zell_inv_lock_products` (`0020:610`، `for share` بترتيب id) | صفوف المنتجات `for share` | بيتسلسل على الخطوة 2؛ لو الترحيل سبق، الحذف بيلاقي مراجع = `45505` |
| `zell_create_order` | advisory خاص بيه وقراية المنتجات | المنتج المحذوف لازم يكون مخفي، فمابيتطلبش أصلًا؛ ولو حصل تزامن بيتسلسل على الصف |

- **النطاق:** التغيير الوحيد في مسار موجود هو الـ trigger على صف `home_products` (M + فحص الوجود) وربط `45507` في `saveHomeProducts`. **مفيش تعديل** في أي دالة من الجدول ده ولا في مفاتيح `settings` التانية.
- **لو PostgreSQL اكتشف deadlock** (`40P01`) رغم البروتوكول: المعاملة اللي اتلغت بترجع كاملة، والحذف بيرجّع `45508`، وCI بيعتبره فشل لازم يتشرح ويتصلّح قبل الاعتماد.

## ٦) اللوحة
- في صفحة المنتج: كارت «حذف المنتج نهائيًا» **للمالك بس**، وبيظهر بس لما المنتج مخفي. لو ظاهر: سطر «أخفِ المنتج أولًا لإتاحة الحذف».
- الكارت بيعرض نتيجة `preview`: عدد الصور والعروض والأقسام، و«مستخدم كإضافة في N منتج»، و«موجود في الصفحة الرئيسية». لو فيه طلبات أو مخزون أو تعارض: سبب واضح ومفيش زرار.
- الزرار ← حوار تأكيد واحد بالأعداد ← النداء ← بعد النجاح: تحديث المتجر (`/api/revalidate`) ورجوع لقايمة المنتجات. `45508` = رسالة «حاول مرة أخرى بعد لحظات».
- النداء بجلسة المستخدم (`createAuthClient`)، من Server Action ملفوف بالصلاحية (`lib/access`) بفئة المالك. مفيش `p_actor` تحت `apps/admin`. مفيش capability جديدة في 0021-P.
- **نصوص اللوحة الجديدة بالفصحى المبسّطة الرسمية.**

## ٧) الملفات (PR الكود بعد اعتماد العقد)
- `backend/db/migrations/0022_product_delete.sql` + `_ptest` + `_verify` + `_rollback` (النتيجة صفوف، دروس 0021-P) · job CI جديد على PostgreSQL 17 · `build_from_scratch.list`.
- اللوحة: كارت الحذف · Server Action · قراية الـ preview · ربط `45507` في `saveHomeProducts` · حالات منطق خالص (suite جديدة).
- التوثيق: `docs/maps/db-map.md` (الدور والدوال والـ trigger والمنح والـ policies والأكواد وقيد `storage_orphans` والمنحة على helper المخزون) · `code-map.md` · العقد ده.

## ٨) CI (لازم قبل أي تشغيل)
- **الهوية:** مالك = نجاح · أدمن = 45402 · من غير جلسة أو ممثل مزوّر = رفض · `service_role` و`anon` مالهمش EXECUTE.
- **كل شرط في §٣ بكوده، ومن غير أي تغيير** (بصمة الجداول قبل وبعد).
- **حذف ناجح:** الصف والتوابع الخمسة اتمسحوا · الصور اتسجّلت بـ `product_deleted` · id اتشال من `home_products` والترتيب زي ما هو · منتجات تانية وطلبات وإعدادات تانية بصمتها زي ما هي.
- **سجلات `storage_orphans`:** مستني تنظيف = مفيش صف جديد · متعلّم `cleaned_at` = 45506 ومفيش تغيير · القيد بيقبل `product_deleted` والقديمة زي ما هي · الرجوع بيرفض لو فيه `product_deleted`.
- **أقل صلاحيات:** صلاحيات `zell_catalog_definer` و`zell_inventory_definer` = §٤ بالحرف · محاولة الدور يعدّل منتج أو صف تابع أو `cleaned_at` أو يكتب مفتاح `settings` تاني أو يسجّل بسبب تاني = مرفوضة · الـ cascade بالدور ده بس بينجح.
- **سلسلة المخزون بالأدوار الفعلية (§٤-ب):** من غير `postgres` أو bypass · مراجع = `45505` · مفيش = `false` · سحب المنحة = خطأ ومفيش حذف · الـ preflight بيوقف لو المنحة موجودة قبلها · الرجوع بيسحبها.
- **FK كحارس أخير:** فحص الطلبات أو المخزون اتشال بشكل مصطنع ← الـ FK بيرفض والمعاملة بترجع كلها.
- **التزامن (جلستين فعليتين، كل حالة بالترتيبين في التوقيت):**
  - حذف + تعديل عروض لنفس المنتج (`zell_set_product_widths`) · حذف + تعديل إضافات لمنتج تاني فيه المحذوف كإضافة (`zell_set_product_addons`).
  - حذف + **أول إنشاء** لـ `home_products` (مفيش صف) · حذف + تعديل القايمة (فيها المحذوف · من غيره).
  - حذفين متزامنين لمنتجين في القايمة · حذفين لنفس المنتج.
  - حذف + `zell_set_collection_products` لقسم فيه المنتج · حذف + `zell_reorder_products` فيه المنتج.
  - **المتوقع في كل حالة:** نتيجة واحدة من (نجاح · `45502` · `45507` · `45508` · فشل الكاتب التاني بـ FK) من غير أي تغيير جزئي، والقايمة النهائية = المتوقعة بالظبط (مفيش اختيار ضايع، ومفيش id محذوف رجع)، و**مفيش `40P01`** ولا انتظار أطول من `lock_timeout`.
  - منتج جديد بعد الحذف بياخد id جديد.
- **الـ trigger مايكسرش الموجود:** حفظ الرئيسية العادي (تعديل وأول إنشاء) بينجح · حفظ المحتوى ومفاتيح `settings` التانية مش بتاخد M ولا متأثرة.
- **التعديل في المنتج بين الـ preview والحذف** ← 45502.
- **rollback:** قبل أي حذف بيرجّع الحالة بالظبط (الدور والدوال والـ trigger والـ policies والمنح ومنحة helper المخزون والقيد)؛ وبعد حذف بيرفض بسبب صفوف `product_deleted`، والمنتج المحذوف مايرجعش غير بالـ backup.

## ٩) على Production (كل خطوة بموافقة لوحدها)
- blob sha1 + main + الوقت UTC ← استعلام الأثر (baseline) ← backup ← ptest ← تطبيق ← verify ← استعلام الأثر بعد.
- بعد النشر: **المالك هو اللي بيحذف من اللوحة** بنفسه. مفيش حذف من شات التنفيذ.

## ١٠) ملاحظة مهمة عن منتجات التجارب
- أي منتج تجربة **اتطلب في طلب تجربة** (الطلبات الأربعة الحالية) **مش هيتمسح** (45504) لحد ما طلبات التجارب نفسها تتمسح (CLEAN-launch، مؤجّل). لحد ساعتها يفضل مخفي.

## ١١) برّه النطاق
- مسح ملفات من Storage (IMAGE-CLEANUP) · حذف منتج اتباع أو عليه مخزون · capability جديدة · مسح صورة منفردة أو استبدالها · الطلبات وطلبات التجارب · نسخة لحفظ الرئيسية بين أدمنين · أي تعديل في دوال الكتابة في §٥-ج.

## ١٢) سجل التعديلات
- **2026-10-26 · المراجعة 3 (ملاحظات المراجع على `a953116`، Blocking):** (١) §٤-ب: الـ helper مالكه `postgres` ومفيش منحة لدور المخزون ← منحة `EXECUTE` واحدة محددة، والـ preflight بيتأكد إنها مش موجودة قبلها، والرجوع بيسحبها، واختبار السلسلة بالأدوار الفعلية، وتصحيح الشرح (نقص الصلاحية = خطأ · RLS بتخفي = `false`) · (٢) §٥: بروتوكول أقفال جديد: advisory ثابت للقايمة بيغطي غياب الصف، والـ trigger مابيقفلش منتجات، والحذف بيستنى على M وصف المنتج بس وكل اللي بعدهم `nowait` (`45508`)، وجدول بكل مسارات الكتابة المتداخلة من غير تعديلها، واختبارات بجلستين بالترتيبين (عروض · إضافات · أول إنشاء للقايمة · أقسام · ترتيب) · منح `UPDATE (product_id)` بـ `with check (false)` على الجداول التابعة للقفل بس.
- **2026-10-26 · المراجعة 2 (`a953116`):** `zell_catalog_definer` · سبب `product_deleted` ورفض تعارض `cleaned_at` · جدول أقل صلاحيات · trigger الرئيسية.
- **2026-10-26:** المسودة الأولى، بقرارات المالك في §١.
