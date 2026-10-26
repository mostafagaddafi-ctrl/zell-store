# خريطة الداتابيز

كل دور وجدول ودالة في الداتابيز: بيعمل إيه، ومتعرّف في أنهي ملف. الملفات في `backend/db/` (`schema.sql` و`migrations/`).

- **«اتعرّف في»** = أول ملف عمل الحاجة. الملفات اللي غيّرتها بعد كده مكتوبة جنبها.
- **حالة التطبيق على Production:** المرجع `08-HANDOFF-NOW.md` في zell-skills. ⚠ سطور «الحالة» اللي في راس الملفات و`migrations/README.md` اتكتبت وقت كتابة الملف، وفيها حاجات قديمة.
- **برّه الـ migrations:** فيه حاجات اتعملت من لوحة Supabase / SQL Editor ومالهاش ملف هنا. متعلّم عليها **(برّه الملفات)**، ووصفها في `docs/OPERATIONS.md` و`docs/ADMIN-AUTH.md`. الحاجات دي مرسومة دلوقتي في `backend/db/baseline/` للبناء من الصفر في CI بس (`ci/build_from_scratch.list`، عقد BASELINE-OUTSIDE §١٠)، ومابتتطبّقش على Production.
- أي PR بيضيف أو بيغيّر جدول أو دالة أو دور **يحدّث الملف ده في نفس الـ PR.**
- الأقسام وأرقام السطور في الملفات الكبيرة: `docs/maps/big-files.md`.

---

## ١) الأدوار

| الدور | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `anon` · `authenticated` | Supabase | مالهمش أي وصول للجداول (RLS + سحب الصلاحيات في 0002). `authenticated` عنده EXECUTE على ١٢ دالة `zell_erp_*` (0021-P) و٢٣ دالة `zell_inv_session_*` (0020-S PR-1) و١١ دالة `zell_order_*` (0021-A A1) بس. بعد تطبيق 0021-A P1: + ١٠ دوال `zell_payment_*` (§٧-ب، متطبّق 2026-10-11). بعد تطبيق 0021-D2: + `zell_delivery_settings_get` و`zell_delivery_settings_save` (§٧-ج). بعد تطبيق EXPRESS-SHIPPING: + `zell_shipping_options_get` و`zell_shipping_options_save` (§١٠). بعد تطبيق TRACK-ORDER v2: + `zell_shipment_get` / `_save` و`zell_customer_update_list` / `_add` / `_edit` / `_set_hidden` (§١١) |
| `service_role` | Supabase | بيتخطى RLS. اللوحة والمتجر بيقروا بيه من السيرفر بس (حل انتقالي)، وعنده EXECUTE على دوال اللوحة القديمة بس: صفر على أي `zell_inv_*` (من 0020-S PR-3) وعلى جداول 0020. صفر على `erp_*` و`zell_erp_*`. من `zell_order_*`: `zell_order_gate_is_open` بس (trigger الحالة وقت PATCH اللوحة). من `zell_checkout_*`: `zell_checkout_delivery_periods` (0021-D)، و`zell_checkout_confirmation_fee` (P2)، و`zell_checkout_delivery_settings` بعد تطبيق 0021-D2، و`zell_checkout_track_order` بعد تطبيق 0021-TR (§٩). ومن `zell_shipping_*`: `zell_shipping_options_checkout` بس بعد تطبيق EXPRESS-SHIPPING (§١٠). صفر على `zell_payment_*` و`zell_delivery_settings_*` |
| `postgres` | Supabase | مالك الجداول، واللي بيطبّق الـ migrations (الـ preflight بيتأكد) |
| `zell_definer` | `0005c` (مسودة) | دور مسودة `create_order` القديمة |
| `zell_order_writer` | `0006b` | مالك دوال مسار الطلب في الملفات (`zell_create_order` · `zell_get_order_receipt`)، ومن غير صلاحيات جداول مباشرة. **على Production مالك `zell_create_order` = `postgres`** (`08-HANDOFF-NOW.md`)، وCI بتاع P1 بيجرّب الاتنين |
| `zell_inventory_definer` | `0020` | مالك دوال المخزون `zell_inv_*`، ومنها `zell_inv_session_*` و`zell_inv_claims_actor` من 0020-S (NOLOGIN · NOBYPASSRLS). بعد 0022: + الغلاف `zell_inv_product_stock_ref_exists` و EXECUTE على `zell_inv_product_has_stock_refs` (§١٢) |
| `erp_definer` | `0021p_erp_access` | مالك دوال المحرك `erp_*` (NOLOGIN · NOINHERIT · NOBYPASSRLS) |
| `zell_erp_definer` | `0021p_zell_erp_access` | مالك دوال المحوّل والواجهة `erp_actor_status_v1`. مالوش أي صلاحية على `admin_users` |
| `zell_order_definer` | `0021a_a1_order_cycle` | مالك دوال دورة الطلب `zell_order_*` (NOLOGIN · NOINHERIT · NOBYPASSRLS). على `orders`: SELECT + UPDATE لأعمدة الدورة بس. ومالك `zell_checkout_delivery_periods` (0021-D)، وبعد P1/P2: `zell_payment_*` (ماعدا الـ triggers) و`zell_checkout_confirmation_fee` (§٧-ب)، وبعد 0021-D2: `zell_delivery_settings_get` / `_save` و`zell_checkout_delivery_settings` (§٧-ج)، وبعد 0021-TR: `zell_checkout_track_order` و SELECT على ٨ أعمدة من `order_items` بـ policy قراية (§٩)، وبعد EXPRESS-SHIPPING: `zell_shipping_options_get` / `_save` / `_checkout` و SELECT + UPDATE على `zell_shipping_options` و SELECT + INSERT على سجله (§١٠)، وبعد TRACK-ORDER v2: 9 دوال `zell_shipment_*` و`zell_customer_update_*` (ماعدا الـ triggers) و SELECT + INSERT + UPDATE على `zell_order_shipments` و`zell_order_customer_updates` و SELECT + INSERT على سجلاتهم (§١١)، ومفيش صلاحية جديدة على `orders` ولا `order_events` ولا `order_payments` |
| `zell_catalog_definer` | `0022_product_delete` | مالك دوال حذف المنتج (NOLOGIN · NOINHERIT · NOBYPASSRLS، عضوية `postgres` بـ SET بس) — §١٢. صلاحيات أعمدة + 17 policy باسم `zell_catalog_definer_*` بس، ومفيش أي صلاحية على `orders` ولا قراية أسماء أو أسعار المنتجات (متطبّق ومتحقق منه على Production 2026-10-26) |

---

## ٢) الجداول

### المتجر والطلبات

| الجدول | اتعرّف في | بيعمل إيه | اتغيّر في |
| --- | --- | --- | --- |
| `products` | `schema.sql` | المنتجات: سعر المتر والعرض والطول، والقطعة | 0013 `lock_width` · 0014 `compare_at_piastres` · 0016 `sale_unit` `is_listed` `max_quantity` · 0020 trigger بيحمي `sale_unit` · **(برّه الملفات)** أعمدة `brand` · `images` · `before_image` · `after_image` · `short_benefit` · `benefits` (15–20) + `products_benefits_shape` · `products_short_benefit_length`: `baseline/b1_products_columns.sql` |
| `orders` | `schema.sql` | راس الطلب: الزبون والعنوان والإجماليات والحالة | 0005b/0006a idempotency والجلسة والإيصال · 0018 المنطقة والتركيب · 0019 الكوبون والخصم + trigger `orders_cancelled_final` · 0021-A A1: `preparing` و`refused` في قيد الحالة (القديم في تعليق القيد) + `next_follow_up_at` و`delivery_confirmed_date/period/note` + triggers `orders_status_guard` و`orders_created_event` · 0021-D: `preferred_delivery_date/period/note` (لقطة موعد العميل المفضّل) · 0021-A P1: `paid_piastres` (الدفعات − الردود، بتكتبه دوال الدفعات بس) و`confirmation_fee_piastres` (لقطة) + trigger `orders_money_guard` · EXPRESS-SHIPPING W1: `shipping_method` و`shipping_days_min/max` (لقطة الطريقة والمدة، nullable) + قيد `orders_shipping_snapshot_shape` (§١٠) · **(برّه الملفات)** `internal_notes` (الترتيب الحي 16) + `orders_internal_notes_length`: `baseline/b0_orders_internal_notes.sql` |
| `order_payments` | `0021a_p1` | الدفعات والردود (append-only، `command_id` فريد، لقطة اسم الطريقة، FK restrict على الطلب) | RLS لـ `zell_order_definer` بس |
| `zell_payment_methods` | `0021a_p1` | طرق الدفع (كاش · فودافون كاش · إنستاباي · تحويل بنكي، قابلة للإدارة) | الحذف بس لو مااتستخدمتش |
| `zell_payment_settings` | `0021a_p1` | صف واحد: إعداد رسوم التأكيد (مقفول) · الآجل (مقفول) · أرقام الدفع · السياسة · قالب واتساب | الحفظ للمالك بدالة |
| `zell_payment_config_log` | `0021a_p1` | سجل تغييرات الإعدادات وطرق الدفع (append-only) | |
| `zell_payment_commands` | `0021a_p1` | أوامر الدفع (مراجعة #122): أمر لكل `record` / `refund` / `deliver_order` ناجح، ومعاه لقطة النتيجة الأصلية اللي الإعادة بترجّعها (append-only، `command_id` primary key، FK restrict على الطلب) | RLS لـ `zell_order_definer` بس |
| `order_items` | `schema.sql` | سطور الطلب | 0016 `sale_unit` `quantity` · 0021-TR: SELECT لـ `zell_order_definer` على ٨ أعمدة + policy `zell_order_definer_select` (قراية بس، §٩) |
| `settings` | `schema.sql` | إعدادات ومحتوى بمفتاح (hero · sections · faqs · shipping_rates …) | 0007 شال أسرار تليجرام · 0008 مفتاح `announcement` · 0019 مفتاح `coupons_enabled` |
| `product_images` | `0003` | صور معرض المنتج (`bucket` + `object_path`)، والترتيب والرئيسية | · **(برّه الملفات)** `fit` (16) + `product_images_fit_check`: `baseline/b1_products_columns.sql` |
| `site_images` | `0006` | اللوجو وصور الموقع | 0009 نوع `hero` + صورة نشطة واحدة لكل نوع فردي |
| `storage_orphans` | `0006` | ملفات Storage محتاجة تنظيف | 0012 سبب `removed` · 0022 سبب `product_deleted` (متطبّق 2026-10-26) |
| `collections` | `0010` | الأقسام | 0012 `show_on_home` `show_in_nav` والغلاف · 0017 `catalog_layout` |
| `product_collections` | `0010` | ربط المنتجات بالأقسام وترتيبها | |
| `product_widths` | `0015` | عروض الرول الإضافية لكل منتج بسعر المتر بتاعها | |
| `product_addons` | `0016` | الإضافات (منتجات القطعة) لكل فيلم | |
| `coupons` | `0019` | أكواد الخصم | |
| `admin_users` | **(برّه الملفات)** · `baseline/b3_admin_users.sql` (رسم BASELINE-OUTSIDE للبناء من الصفر في CI بس، مابيتطبّقش على Production) · `docs/ADMIN-AUTH.md` | مين يدخل اللوحة: `user_id` (← `auth.users`، on delete cascade) · `role` owner/admin · `is_active`. RLS من غير policies | 0021-P: ٤ triggers (§٥) |

### دورة الطلب (0021-A A1)

كلها مالكها `postgres`، RLS وpolicy لـ `zell_order_definer` بس، وصفر صلاحيات لـ `anon` و`authenticated` و`service_role`.

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `order_status_transitions` | `0021a_a1_order_cycle` | الانتقالات المسموحة (9) وعمود `gate`: `any` · `open` بعد فتح البوابة · `closed` قبلها (`confirmed → shipped`) |
| `order_events` | `0021a_a1_order_cycle` | سجل الطلب append-only (45413). DELETE بس كـ cascade لمسح الطلب. `created` من trigger |
| `order_delivery_periods` | `0021a_a1_order_cycle` | الفترات التلاتة (`morning` · `noon` · `evening`) بتوقيت القاهرة، والمالك بيعدّل الأوقات |
| `zell_order_gate` | `0021a_a1_order_cycle` | البوابة: صف واحد، مقفول افتراضيًا، بيتغيّر بـ `zell_order_set_gate` بس (45414) |
| `zell_order_config_log` | `0021a_a1_order_cycle` | سجل append-only لتغييرات البوابة والفترات (مين · إمتى · من/لـ · الموافقة) |

### موعد التسليم في Checkout (0021-D2 W1 — مش متطبّق لسه)

الاتنين مالكهم `postgres`، RLS وpolicy لـ `zell_order_definer` بس، وصفر صلاحيات لـ `anon` و`authenticated` و`service_role`.

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `zell_delivery_settings` | `0021d2_delivery_settings` | صف واحد: العميل يختار الموعد · إظهار السطر · نص السطر (≤ 300 بعد trim) · `updated_at` · `updated_by`. القيم وقت التطبيق = السلوك الحالي (العميل بيختار، ومفيش سطر). مايتمسحش (45413) |
| `zell_delivery_settings_log` | `0021d2_delivery_settings` | سجل append-only لكل تغيير (الممثل · القديم · الجديد · الوقت). UPDATE وDELETE وTRUNCATE = 45413، والرجوع بيرفض بأي سطر |

### الشحن السريع ومدة الشحن (EXPRESS-SHIPPING W1 — مش متطبّق لسه)

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `zell_shipping_options` | `0021ex_express_shipping` | صف واحد: `express_enabled` (المفتاح العام) · `governorates` (لكل محافظة: مدة العادي الاختيارية · السريع متاح · سعره الكامل · مدته) · `updated_at` · `updated_by`. القيم وقت التطبيق: السريع مقفول و`{}`. مايتمسحش (45413). سعر العادي بيفضل في `settings.shipping_rates` |
| `zell_shipping_options_log` | `0021ex_express_shipping` | سجل append-only لكل تغيير (الممثل · القديم · الجديد · الوقت). UPDATE وDELETE وTRUNCATE = 45413، والرجوع بيرفض بأي سطر |

### الشحنة ورسايل العميل (TRACK-ORDER v2 W1 — مش متطبّق لسه)

كلها مالكها `postgres`، RLS وpolicy `zell_order_definer_all` لـ `zell_order_definer` بس، وصفر صلاحيات لـ `anon` و`authenticated` و`service_role`.

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `zell_order_shipments` | `0021tr2_track_order_v2` | شحنة واحدة لكل طلب (`order_id` المفتاح، FK restrict): الشركة (نص حر) · رقم الشحنة · الرابط (https) · تاريخ الشحن · الوصول المتوقع · `updated_at` (النسخة) · `updated_by`. مابتتمسحش (45413). منفصلة عن حالة الطلب |
| `zell_order_shipments_log` | `0021tr2_track_order_v2` | سجل append-only لكل تغيير في الشحنة (القديم · الجديد · الممثل · الوقت) |
| `zell_order_customer_updates` | `0021tr2_track_order_v2` | رسايل العميل اللي بتظهر في «تتبّع طلبك»: النص (1..300) · مخفية · اتعدّلت · الممثل والأوقات. مابتتمسحش (الإخفاء بدل المسح). منفصلة تمامًا عن `internal_notes` |
| `zell_order_customer_updates_log` | `0021tr2_track_order_v2` | سجل داخلي append-only: add · edit · hide · show (القديم · الجديد · الممثل · الوقت). مابيظهرش للعميل |

### المخزون والمشتريات (0020)

| الجدول | بيعمل إيه |
| --- | --- |
| `inventory_locations` | مواقع المخزون (الافتراضي `MAIN`) |
| `suppliers` | الموردين |
| `purchase_docs` | مستند الشراء: `draft` · `posted` · `voided` · `discarded` |
| `purchase_doc_lines` | سطور مستند الشراء |
| `purchase_doc_charges` | مصاريف الشراء المفصّلة اللي بتتوزّع على السطور |
| `opening_stock_docs` · `opening_stock_lines` | رصيد أول المدة |
| `stock_lots` | الـ lots المترحّلة (رول أو دفعة) بتكلفتها |
| `inventory_commands` | idempotency للأوامر (append-only) |
| `inventory_audit_log` | سجل المخزون (append-only) |

- **Sequences:** `purchase_doc_no_seq` · `opening_doc_no_seq` · `roll_lot_seq` · `batch_lot_seq` (أرقام المستندات والـ lots، والفجوات عادية).
- **الصلاحيات:** RLS + policy واحدة للدور `zell_inventory_definer` بس. `service_role` مالوش أي صلاحية على الجداول دي، والقراية والكتابة من الـ RPCs (§٥). مفيش DELETE/TRUNCATE (triggers).

### الصلاحيات (0021-P)

| الجدول | اتعرّف في | بيعمل إيه |
| --- | --- | --- |
| `erp_capabilities` | المحرك | قائمة الصلاحيات (`key` · `category` · `description`)، ٢٩ صلاحية |
| `erp_presets` · `erp_preset_items` | المحرك | القوالب وبنودها (`zell.admin_today` · `zell.warehouse`) |
| `erp_user_grants` | المحرك | المنح الصريح لكل مستخدم |
| `erp_user_access` | المحرك | نسخة صلاحيات كل مستخدم (`version` للتزامن) |
| `erp_commands` | المحرك | النتيجة النهائية لكل `command_id` (append-only) |
| `erp_access_audit` | المحرك | سجل الإدارة (append-only) |
| `erp_access_shadow_events` | المحرك | أحداث الـ shadow مجمّعة باليوم |
| `zell_erp_owner_guard` | المحوّل | صف واحد: عدد الملاك الشغالين |
| `zell_erp_admin_users_log` | المحوّل | كل تغيير على `admin_users` حتى اليدوي (append-only) |

---

## ٣) دوال المتجر والطلب

| الدالة | اتعرّف في | بتعمل إيه |
| --- | --- | --- |
| `generate_order_number()` | `0005a` (مسودة) | رقم الطلب في المسودة القديمة |
| `create_order(…)` | `0005c` (مسودة) | إنشاء الطلب في المسودة القديمة (اتستبدلت بـ `zell_create_order`) |
| `zell_create_order(…)` | `0006b` | إنشاء الطلب ذرّيًا: التسعير، والـ idempotency، والإيصال. **اتعادت كتابتها في** 0006c (`receipt_expires_at`) · 0015 (العروض) · 0016 (القطعة) · 0018 (التركيب والمنطقة، ١٢ معامل) · 0019 (الكوبون) · 0021-D (الموعد المفضّل، ١٤ معامل: `p_preferred_delivery`) · 0021-A P1 (لقطة `confirmation_fee_piastres`، نفس التوقيع) · EXPRESS-SHIPPING W1 (١٥ معامل: `p_shipping_method`، والقديمة بتتشال — §١٠، مش متطبّق). بيناديها المتجر (`/api/orders`) |
| `zell_get_order_receipt(…)` | `0006b` | الإيصال بالتوكن. اتعدّلت في 0016 · 0018 · 0019 |
| `zell_preview_coupon(…)` | `0019` | معاينة الكوبون قبل الطلب (`/api/coupons/preview`) |
| `zell_checkout_delivery_periods()` | `0021d` | أوقات فترات التسليم للـ Checkout من `order_delivery_periods` (مالكها `zell_order_definer`، `service_role` بس) |
| `zell_payment_*` (24: 10 عامة · 11 داخلية · 3 triggers) | `0021a_p1` | الدفعات ورسوم التأكيد بهوية الجلسة. الجرد الكامل في §٧-ب تحت |
| `zell_checkout_confirmation_fee()` | `0021a_p2` | إعداد رسوم التأكيد والسياسة للـ Checkout (مالكها `zell_order_definer`، `service_role` بس) — §٧-ب |
| `zell_checkout_delivery_settings()` | `0021d2` | إعداد موعد التسليم للـ Checkout و`/api/orders`: `{customer_choice_enabled, note}` (`note` بس لو السطر متفعّل). مالكها `zell_order_definer`، `service_role` بس — §٧-ج (W1، مش متطبّق) |
| `zell_shipping_options_checkout()` | `0021ex` | إعداد الشحن السريع ومدة الشحن للـ Checkout: `{express_enabled, governorates}`. مالكها `zell_order_definer`، `service_role` بس — §١٠ (W1، مش متطبّق) |
| `zell_orders_cancelled_final()` | `0019` | دالة الـ trigger `orders_cancelled_final` (BEFORE UPDATE OF status): الإلغاء نهائي، والطلب الملغي مايرجعش (45080)، علشان استخدام الكوبون مايتعدّاش |

## ٤) دوال اللوحة (الكتابة الذرّية)

| الدالة | اتعرّف في | بتعمل إيه |
| --- | --- | --- |
| `zell_save_content(…)` | **(برّه الملفات)**، واتعادت في `0008` | مفاتيح المحتوى + شريط الإعلان، بفحص نسخة (٨ معاملات) |
| `zell_save_shipping(…)` | **(برّه الملفات)** · `baseline/b2_admin_functions.sql` | مفاتيح الشحن |
| `zell_save_identity(…)` | **(برّه الملفات)** · `baseline/b2_admin_functions.sql` | مفاتيح الهوية (من غير `logo_url`) |
| `zell_reorder_products(…)` | **(برّه الملفات)** · `baseline/b2_admin_functions.sql` | ترتيب المنتجات (من ١) |
| `zell_reorder_product_images(…)` | **(برّه الملفات)** · `baseline/b2_admin_functions.sql` | ترتيب صور المعرض (من ٠) |
| `zell_set_primary_product_image(…)` | **(برّه الملفات)** · `baseline/b2_admin_functions.sql` | الصورة الرئيسية |
| `zell_valid_benefits(…)` | **(برّه الملفات)** · `baseline/b1_products_columns.sql` | فحص شكل `products.benefits` (قيد `products_benefits_shape`) |
| `zell_activate_site_image(…)` | `0009` | تبديل صورة الموقع ذرّيًا (القديمة بتروح `storage_orphans`) |
| `zell_reorder_collections(…)` | `0010`، واتعدّلت في `0012` | ترتيب الأقسام |
| `zell_set_collection_products(…)` | `0010`، واتصلّحت في `0011` | منتجات القسم وترتيبها |
| `zell_create_collection(…)` | `0012` | قسم جديد (أولًا في الترتيب) |
| `zell_set_collection_cover(…)` | `0012` | غلاف القسم |
| `zell_delete_collection(…)` | `0012` | مسح قسم |
| `zell_set_product_widths(…)` | `0015` | عروض الرول للمنتج |
| `zell_set_product_addons(…)` | `0016` | إضافات الفيلم |

- دوال اللوحة دي `security invoker`، والـ EXECUTE عليها لـ `service_role` بس (`docs/OPERATIONS.md`).

## ٥) دوال المخزون (0020، مالكها `zell_inventory_definer`)

- **الحد العام: ٢٣ دالة owner-only** بتاخد `p_actor` وبتتأكد منه في `admin_users` (`zell_inv_assert_owner`).
- ✅ **اتقفل في 0020-S** (PR-1 #109 · PR-2 #110 · PR-3 `0020s_pr3_revoke_service_role.sql`): مفيش `zell_inv_*` لـ `service_role`، والممثل = `sub` الجلسة بس. الفقرة اللي تحت تاريخية.
- ⚠ (تاريخي) **الحماية من السيرفر بس:** الـ ٢٣ (١٤ كتابة · ٩ قراية) EXECUTE لـ `service_role` بس، والممثل `p_actor` بيحدده كود اللوحة
  (غلاف `actionWithAccess` بصلاحية فئة `owner` ← `p_actor = ctx.identity.userId`، عمره ما ييجي من الفورم)، مش جلسة المستخدم. ده نفس نمط
  `p_actor` اللي 0021-P قفلته في دوالها. **القرار (2026-10-08، `10-DECISIONS.md` في zell-skills):** عقد لوحده لنقلها لهوية الجلسة،
  بعد 0021-P ب2 وقبل الإطلاق، ومش مشروط بتشغيل shadow أو enforce ولا بصفحة إدارة الصلاحيات (`docs/contracts/0021-P-code.md` §٨ بند 4).
- **0020-S PR-1 (`0020s_inv_session.sql`، إضافة بس):** ٢٣ دالة `zell_inv_session_<x>` بنفس معاملات `zell_inv_<x>` ناقص `p_actor`
  (أسماء مختلفة، مفيش overload). الممثل = `sub` الجلسة من `zell_inv_claims_actor()` (داخلية، بشرط `role = authenticated`)، وبتنادي الدالة
  القديمة بيه، وفحص المالك زي ما هو (`zell_inv_assert_owner`). EXECUTE لـ `authenticated` بس. الدوال القديمة وصلاحياتها زي ما هي:
  من PR-2 اللوحة بتنادي `zell_inv_session_*` بجلسة المستخدم بس (`apps/admin/lib/inventory/rpc.ts`). من PR-3 (`0020s_pr3_revoke_service_role.sql`)
  القديمة داخلية (EXECUTE لمالكها بس) ومابتتمسحش. العقد: `docs/contracts/0020-S.md`.
  ملفي 0020 القديمين صالحين مع 0020-S: الـ verify بيكتب `0020s=applied`، والـ rollback بيرفض بـ `ZELL_0020_ROLLBACK_0020S_FIRST` لحد rollback 0020-S الأول.

| المجموعة | الدوال |
| --- | --- |
| المواقع | `zell_inv_create_location` · `zell_inv_update_location` · `zell_inv_list_locations` |
| الموردين | `zell_inv_create_supplier` · `zell_inv_update_supplier` · `zell_inv_list_suppliers` |
| الشراء | `zell_inv_create_purchase` · `zell_inv_update_purchase` · `zell_inv_post_purchase` (ترحيل لـ lots) · `zell_inv_discard_purchase` (مسح مسودة) · `zell_inv_void_purchase` (إلغاء مترحّل) · `zell_inv_list_purchases` · `zell_inv_get_purchase` · `zell_inv_preview_purchase` (التوزيع والتكلفة قبل الترحيل) |
| أول المدة | `zell_inv_create_opening` · `zell_inv_update_opening` · `zell_inv_post_opening` · `zell_inv_discard_opening` · `zell_inv_void_opening` · `zell_inv_list_openings` · `zell_inv_get_opening` · `zell_inv_preview_opening` |
| الـ lots | `zell_inv_list_lots` |
| الجلسة (0020-S، EXECUTE لـ `authenticated`) | `zell_inv_session_*` (٢٣، واحدة لكل دالة فوق بنفس الاسم بعد `zell_inv_`) |
| مساعدة داخلية | `zell_inv_claims_actor` (0020-S: `sub` الجلسة أو NULL) · `zell_inv_assert_owner` (المالك الشغال) · `zell_inv_lock_products` · `zell_inv_read_products` · `zell_inv_product_has_stock_refs` · `zell_inv_width_allowed` · `zell_inv_allocate_lr` (توزيع largest remainder) · `zell_inv_normalize_purchase` · `zell_inv_normalize_opening` · `zell_inv_command_check` (idempotency) · `zell_inv_doc_void_blockers` · `zell_inv_unknown_lot_references` · `zell_inv_void_contract_version` |
| دوال الـ triggers (مالكها `postgres`) | `zell_inv_trg_no_delete` · `zell_inv_trg_no_truncate` · `zell_inv_trg_append_only` · `zell_inv_trg_doc_guard` · `zell_inv_trg_child_insert_guard` · `zell_inv_trg_lot_update_guard` · `zell_inv_trg_master_guard` · `zell_inv_trg_products_sale_unit` |

- **Triggers:** `zinv_no_delete` · `zinv_no_truncate` · `zinv_doc_guard` · `zinv_child_insert_guard` · `zinv_append_only` · `zinv_lot_update_guard` · `zinv_master_guard` · `zinv_products_sale_unit` (على `products`).

## ٦) دوال الصلاحيات (0021-P)

التفاصيل والعقد: `docs/contracts/0021-P.md`.

### المحرك (`0021p_erp_access.sql`، مالكها `erp_definer`، كلها داخلية)

| المجموعة | الدوال |
| --- | --- |
| الواجهة | `erp_actor_status_v1(uuid)` (المحوّل بيستبدل جسمها) · `erp_actor_status_contract_version()` · `erp_actor_status(…)` (بتنادي الواجهة وبتتأكد من الشكل، وإلا 45309) |
| الصلاحيات الفعلية | `erp_effective_capabilities` · `erp_has_capability` · `erp_require_capability` |
| الإدارة | `erp_access_grant` · `erp_access_revoke` · `erp_access_apply_preset` · `erp_access_revoke_all` |
| القراءة | `erp_access_snapshot` · `erp_access_audit_page` · `erp_access_shadow_report` |
| الـ shadow | `erp_record_shadow_event` |
| مساعدة داخلية | `erp_access_request_hash` (بصمة الأمر) · `erp_access_command_begin` · `erp_access_command_finish` (idempotency) · `erp_access_lock_user` · `erp_access_user_version` · `erp_access_bump` (النسخة) · `erp_access_user_keys` · `erp_access_preset_keys` · `erp_access_target_check` · `erp_access_denial` · `erp_access_reason` |
| الـ triggers | `erp_trg_immutable` (append-only / no truncate على جداول المحرك) |

### المحوّل (`0021p_zell_erp_access.sql`)

| المجموعة | الدوال |
| --- | --- |
| **الحد العام** (EXECUTE لـ `authenticated`) | `zell_erp_my_access` · `zell_erp_access_grant` · `zell_erp_access_revoke` · `zell_erp_access_apply_preset` · `zell_erp_access_revoke_all` · `zell_erp_set_user_active` · `zell_erp_access_snapshot` · `zell_erp_access_users` · `zell_erp_access_audit_page` · `zell_erp_access_parity` · `zell_erp_access_shadow_report` · `zell_erp_record_shadow_event` |
| الهوية | `zell_erp_trusted_actor()` (`sub` من `request.jwt.claims` بدور `authenticated`) · `zell_erp_require_actor()` (لازم صف في `admin_users`، وإلا 45300) |
| مساعدة على `admin_users` (مالكها `postgres`) | `zell_erp_admin_status` · `zell_erp_admin_set_active` · `zell_erp_admin_list` · `zell_erp_owner_guard_lock` · `zell_erp_owner_guard_read` |
| دوال الـ triggers | `zell_erp_owner_guard_count` · `zell_erp_admin_users_log_change` · `zell_erp_admin_users_user_id_immutable` · `zell_erp_admin_users_no_truncate` · `zell_erp_owner_guard_no_direct` · `zell_erp_trg_immutable` |

### Triggers 0021-P

| الجدول | الـ triggers |
| --- | --- |
| `admin_users` | `zell_erp_admin_users_user_id_immutable` (BEFORE UPDATE، 45310) · `zell_erp_owner_guard_count` (AFTER ROW، 45303) · `zell_erp_admin_users_log_change` (AFTER ROW) · `zell_erp_admin_users_no_truncate` (45311) |
| `zell_erp_owner_guard` | `zell_erp_owner_guard_no_direct` (45312) · `zell_erp_owner_guard_no_truncate` |
| `zell_erp_admin_users_log` | `zell_erp_admin_users_log_immutable` · `zell_erp_admin_users_log_no_truncate` |
| جداول المحرك | `erp_commands_immutable` · `erp_access_audit_immutable` (45315) · `*_no_truncate` على الجداول الـ ٨ |

---

## ٧) دوال دورة الطلب (0021-A A1، مالكها `zell_order_definer`)

التفاصيل: `docs/contracts/0021-A.md` §١٤. الهوية من الجلسة + `admin_users`، من غير `p_actor`. الأكواد 45400..45414.

| المجموعة | الدوال |
| --- | --- |
| عامة (EXECUTE لـ `authenticated` بس) | `zell_order_transition` · `zell_order_record_call` · `zell_order_set_follow_up` · `zell_order_set_confirmed_delivery` · `zell_order_edit_details` · `zell_order_set_internal_note` · `zell_order_events` · `zell_order_delivery_periods` · `zell_order_save_delivery_periods` (المالك) · `zell_order_gate_state` · `zell_order_set_gate` (المالك + موافقة) |
| مساعدة داخلية | `zell_order_claims_actor` · `zell_order_actor` · `zell_order_lock` (قفل + فحص `updated_at`) · `zell_order_text` · `zell_order_apply_transition` (اتعادت كتابتها في 0021-A P1 — §٧-ب) · `zell_order_result` · `zell_order_gate_is_open` (EXECUTE لـ `postgres` و`service_role` علشان الـ trigger) |
| مالكها `postgres` | `zell_order_admin_role` (دور الممثل من `admin_users`) · `zell_order_trg_status_guard` · `zell_order_trg_append_only` · `zell_order_trg_events_immutable` · `zell_order_trg_gate_guard` |
| trigger | `zell_order_trg_created_event` |

- **Triggers:** على `orders`: `orders_status_guard` (البوابة مقفولة: الحالتين الجداد 45406 · مفتوحة: أي تغيير مباشر للحالة 45407) · `orders_created_event`. على السجلات والبوابة: `order_events_immutable` · `order_events_no_truncate` · `zell_order_config_log_immutable` · `zell_order_config_log_no_truncate` · `zell_order_gate_guard` · `zell_order_gate_no_truncate`.

## ٧-ب) دوال الدفعات ورسوم التأكيد (0021-A P1 و P2)

> **متطبّقين على Production (2026-10-11)** — المرجع `08-HANDOFF-NOW.md`.

التفاصيل: `docs/contracts/0021-A.md` §١٧ و§١٨. الهوية من الجلسة (`zell_order_actor` من A1) من غير `p_actor`. الأكواد 45416..45429.
verify P1 بيعدّ **24 دالة `zell_payment_*` بالظبط**، فأي دالة جديدة للمتجر اسمها `zell_checkout_*`.

| المجموعة | الدوال | المالك · EXECUTE |
| --- | --- | --- |
| عامة (10) | `zell_payment_record` (الأدمن والمالك) · `zell_payment_refund` (المالك) · `zell_payment_deliver_order` (تسليم مع التحصيل في نفس المعاملة، أو آجل صريح لو متفعّل) · `zell_payment_order_summary` · `zell_payment_list_methods` · `zell_payment_add_method` / `zell_payment_update_method` / `zell_payment_delete_method` (المالك) · `zell_payment_get_settings` · `zell_payment_save_settings` (المالك) | `zell_order_definer` · `authenticated` بس (`service_role` و`anon` صفر) |
| داخلية (11) | `zell_payment_text` (التطبيع: trim والنص الفاضي NULL والطول) · `zell_payment_cfg_int` · `zell_payment_fee_calc` (= `packages/core/src/confirmationFee.ts` بالحرف) · `zell_payment_validate_fee` · `zell_payment_order_fee` (لـ `zell_create_order`) · `zell_payment_lock` (`FOR UPDATE` على الطلب) · `zell_payment_summary` · `zell_payment_apply` (الكتابة + `paid_piastres` + الحدث) · `zell_payment_entry` (idempotency من `zell_payment_commands`: بعد القفل وقبل النسخة، واللقطة الأصلية، والبصمة بعد التطبيع) · `zell_payment_settings_json` · `zell_payment_methods_json` | `zell_order_definer` · مفيش EXECUTE لحد، ماعدا `fee_calc` و`validate_fee` و`cfg_int` و`order_fee` لـ `postgres`، و`order_fee` لمالك `zell_create_order` لو مش `postgres` (على Production المالك `postgres` وعنده EXECUTE أصلًا) |
| triggers (3) | `zell_payment_trg_append_only` · `zell_payment_trg_settings_guard` · `zell_payment_trg_orders_money` | `postgres` (invoker) |

- **Triggers:** على `orders`: `orders_money_guard` (أي كتابة مباشرة على `paid_piastres` أو `confirmation_fee_piastres` = 45418). على `order_payments`: `order_payments_immutable` · `order_payments_no_truncate` (45427). على `zell_payment_config_log`: `zell_payment_config_log_immutable` · `zell_payment_config_log_no_truncate`. على `zell_payment_commands`: `zell_payment_commands_immutable` · `zell_payment_commands_no_truncate` (45427). على `zell_payment_settings`: `zell_payment_settings_guard` (صف واحد، مفيش insert/delete) · `zell_payment_settings_no_truncate`.
- **الأوامر (مراجعة #122):** `record` و`refund` و`deliver_order` بيسجّلوا أمر في `zell_payment_commands` آخر خطوة في نفس المعاملة (حتى التسليم من غير دفعة). نفس `command_id` بنفس العملية والطلب والممثل والبصمة = اللقطة الأصلية، وأي اختلاف = 45425. الـ rollback بيرفض لو فيه أي أمر.
- **دوال A1 اللي P1 بيعيد كتابتها:** `zell_order_apply_transition(orders, text, uuid, text)` — CREATE OR REPLACE بنفس التوقيع (فالمالك `zell_order_definer` والصلاحيات زي ما هم، والعدد 24 `zell_order_*` زي ما هو). الفرق قاعدتين بس: `confirmed` و`preparing` مرفوضين لو المدفوع أقل من الرسوم (45419)، و`delivered` مرفوض لو فيه باقي (45420) إلا من `zell_payment_deliver_order` بالآجل الصريح. البصمة قبل `aa7cc01c2320cb97d76845d63413886c` وبعد `4d7c514ebe1d12281a81b63991df2324`.
- **`zell_create_order`:** CREATE OR REPLACE بنفس التوقيع (14) من تعريف D (`c131cb51cd86830e9445b139296b0281`)، والفرق عمود `confirmation_fee_piastres` بس (`811d4d573d750db9c7e5164799536aa6`).
- **الكتالوج (0021-P):** `zell.orders.payments_record` (في قالب `zell.admin_today`، وبتتمنح لكل أدمن شغال بسطر سجل مصدره migration) و`zell.orders.payments_admin` (owner): 29/22 ← 31/23.
- **P2:** `zell_checkout_confirmation_fee()` — قراية بس، `security definer`، مالكها `zell_order_definer`، EXECUTE لـ `service_role` بس. بترجّع `{confirmation_fee, fee_policy}` من نفس صف `zell_payment_settings` اللي `zell_create_order` بتاخد منه اللقطة.

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0021a_p1_payments.sql` | P1 كله (الجسم بين `-- >>> 0021A_P1 BODY` و`-- <<<`) |
| `migrations/0021a_p1_payments_ptest.sql` | اختبار قبل التطبيق: الجسم منسوخ بالحرف (CI بيقارن md5) + `zell_create_order` الحالية، والنتيجة صفوف |
| `migrations/0021a_p1_payments_verify.sql` · `_rollback.sql` | التحقق بعد التطبيق (V11 بعد التطبيق مباشرة بس) · الرجوع (بيرجّع الدالتين بالحرف، وبيرفض لو فيه فلوس أو أوامر أو سطر في سجل الإعدادات، أو P2 متطبّق) |
| `migrations/0021a_p2_checkout_fee.sql` + `_ptest` · `_verify` · `_rollback` | P2 (الرجوع بيشيل الدالة بس، وقبل أي رجوع لـ P1) |
| `ci/0021p1_sql_ci.sh` | CI على Postgres 17 مؤقت: S0–S9 لـ P1 و S95–S99 لـ P2 |
| `ci/0021p1_flows.sql` | سيناريوهات الدفع بعد التطبيق (F01–F42، CI بس) |
| `ci/0021p1_fee_parity.mjs` | حالات رسوم التأكيد من `@zell/core` للمقارنة بالداتابيز (S40) |

## ٧-ج) دوال موعد التسليم في Checkout (0021-D2 W1)

> **مش متطبّقة على Production** (المرجع `08-HANDOFF-NOW.md`). التفاصيل: `docs/contracts/0021-D2.md` §٢ و§١٠. الكود الجديد 45430 بس.

| الدالة | المالك · EXECUTE | بتعمل إيه |
| --- | --- | --- |
| `zell_delivery_settings_get()` | `zell_order_definer` · `authenticated` بس | قراية الإعداد للوحة (أي أدمن شغّال، `zell_order_actor(false)`): القيم التلاتة + `updated_at` |
| `zell_delivery_settings_save(timestamptz, boolean, boolean, text)` | `zell_order_definer` · `authenticated` بس | الحفظ (المالك بس): النسخة 45404 · التحقق 45430 بالحقل · سطر في السجل لو فيه تغيير بس · بترجّع القيم + `changed` |
| `zell_checkout_delivery_settings()` | `zell_order_definer` · `service_role` بس | للمتجر: `{customer_choice_enabled, note}` |
| `zell_delivery_settings_trg_append_only()` | `postgres` (invoker) | دالة الـ triggers: `zell_delivery_settings_log_immutable` · `zell_delivery_settings_log_no_truncate` · `zell_delivery_settings_no_delete` · `zell_delivery_settings_no_truncate` (45413) |

- الأسماء برّه عدّادات `zell_order_*` (24) و`zell_payment_*` (24)، ومفيش أي تعديل في `zell_create_order` ولا `zell_checkout_delivery_periods`.

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0021d2_delivery_settings.sql` | W1 كله (الجسم بين `-- >>> 0021D2 BODY` و`-- <<<`)، ومحتاج سطر `zell.approved_by` بعد `begin;` |
| `migrations/0021d2_delivery_settings_ptest.sql` | smoke قبل التطبيق (6 حالات): الجسم منسوخ بالحرف (CI بيقارن md5)، والنتيجة صفوف |
| `migrations/0021d2_delivery_settings_verify.sql` · `_rollback.sql` | التحقق (8 فحوص، في أي وقت بعد التطبيق) · الرجوع (بعد revert كود W2، وبيرفض بأي سطر في السجل) |
| `ci/0021d2_sql_ci.sh` · `ci/0021d2_flows.sql` | CI على Postgres 17 مؤقت فوق شكل Production (S0–S5) · سيناريوهات الإعداد (F01–F32، 24 حالة) |

## ٨) ملفات من غير جداول أو دوال جديدة

| الملف | بيعمل إيه |
| --- | --- |
| `0002_security_rls_grants.sql` | تشغيل RLS، وسحب صلاحيات `anon` و`authenticated`، وbucket الصور |
| `0004_harden_default_privileges.sql` | إلغاء الصلاحيات الافتراضية لأي كائن جديد (ومنها PUBLIC) |
| `0005b_order_idempotency.sql` · `0006a_order_columns.sql` | أعمدة الطلب: idempotency والجلسة والإيصال |
| `0007_cleanup_notify_secrets.sql` | مسح أسرار تليجرام من `settings` (بقت متغيرات بيئة) |
| `0008a_align_announcement_version.sql` | مزامنة طابع `announcement` مع باقي مفاتيح المحتوى |
| `0013` · `0014` · `0017` | أعمدة: `lock_width` · `compare_at_piastres` · `catalog_layout` |

- ملفات `*_ptest.sql` و`*_verify.sql` و`*_rollback.sql` مابتعملش كائنات دايمة. الـ ptest والـ verify بيرجعوا، والـ rollback بيشيل.
- `backend/db/ops/clean_prelaunch*.sql` (تنضيف التجارب قبل الإطلاق — `docs/contracts/CLEAN-prelaunch.md`): تشغيل مرة واحدة، مش migration، ومابيعملش كائنات. بيمسح `orders` و`order_items` و`order_events` بس.

## ٩) تتبّع الطلب للعميل (0021-TR W1)

> **مش متطبّقة على Production** (المرجع `08-HANDOFF-NOW.md`). العقد: `docs/contracts/TRACK-ORDER.md` §٢ و§٦. مفيش أكواد أخطاء جديدة.

| الدالة | المالك · EXECUTE | بتعمل إيه |
| --- | --- | --- |
| `zell_checkout_track_order(text)` | `zell_order_definer` · `service_role` بس (stable · security definer · `search_path` فاضي) | «تتبّع طلبك» بكود الطلب: `order_number` · `status` · `created_at` · `total_piastres` · `items` (زي الإيصال، بترتيب السطور) · `delivery` (المؤكد، وإلا المفضّل، وإلا null). أي شكل غير `^FLM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$` أو طلب مش موجود = null بالظبط. مابترجّعش أي بيانات عميل ولا ملاحظات ولا كوبون ولا hashes ولا دفعات |

- **قراية `order_items`:** `zell_order_definer` مكانش ليه أي صلاحية عليه (A1 أداله `orders` بس)، فـ W1 بيديله SELECT على ٨ أعمدة بس (`id` · `order_id` · `product_name_ar` · `length_cm` · `width_cm` · `quantity` · `sale_unit` · `line_total_piastres`) + policy `zell_order_definer_select` (SELECT، للدور ده بس). RLS على الجدول وصلاحيات باقي الأدوار زي ما هي.
- الاسم برّه عدّادات `zell_order_*` (24) و`zell_payment_*` (24)، و`zell_checkout_*` بتبقى 4. مفيش أي خانة في استعلام الأثر (IMPACT_SQL بتاع P1) بتتغيّر.
- **الرجوع:** بيشيل الدالة والـ policy والصلاحية (مفيش بيانات، فمسموح دايمًا)، بعد revert كود W2 لو اتنشر، و**قبل** أي rollback لـ A1. بيرفض طول ما TRACK-ORDER v2 متطبّق (§١١).
- **TRACK-ORDER v2 (§١١)** بيوسّع رد الدالة (نفس الاسم والتوقيع والصلاحيات)، والـ verify بتاعها بقى بحالتين.

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0021tr_track_order.sql` | W1 كله (الجسم بين `-- >>> 0021TR BODY` و`-- <<<`)، ومحتاج سطر `zell.approved_by` بعد `begin;` (`owner-approval-YYYY-MM-DD-0021tr-track-order`) |
| `migrations/0021tr_track_order_ptest.sql` | smoke قبل التطبيق (6 حالات): الجسم منسوخ بالحرف (CI بيقارن md5)، والنداءات بأكواد غلط أو مش موجودة بس، والنتيجة صفوف |
| `migrations/0021tr_track_order_verify.sql` · `_rollback.sql` | التحقق (7 فحوص، read only بدور `service_role`، وبيقارن رد آخر طلب بيه من غير ما يطلّع بياناته) · الرجوع |
| `ci/0021tr_sql_ci.sh` | CI على Postgres 17 مؤقت فوق شكل Production (A1 · D · P1 · P2 · D2، و RLS على `order_items`): S0–S5 — طلبات بالسبع حالات · الموعد · سطور متر وقطعة · مفيش بيانات عميل · null للشكل الغلط · الصلاحيات · الرجوع · حراس الـ preflight |

## ١٠) الشحن السريع ومدة الشحن (EXPRESS-SHIPPING W1)

> **مش متطبّق على Production** (المرجع `08-HANDOFF-NOW.md`). العقد: `docs/contracts/EXPRESS-SHIPPING.md` (§٢ و§٧-٢). الأكواد الجديدة 45431 (السريع مش متاح) و45432 (طريقة أو إعداد شحن غلط).

| الدالة | المالك · EXECUTE | بتعمل إيه |
| --- | --- | --- |
| `zell_shipping_options_get()` | `zell_order_definer` · `authenticated` بس | قراية الإعداد للوحة (أي أدمن شغّال، `zell_order_actor(false)`): `express_enabled` · `governorates` · `updated_at` |
| `zell_shipping_options_save(timestamptz, boolean, jsonb)` | `zell_order_definer` · `authenticated` بس | الحفظ (المالك بس): النسخة 45404 · التحقق 45432 (الحقل في `detail`، والمحافظة في `hint`) · التطبيع (NFC + trim والمفاتيح الست) · سطر في السجل لو فيه تغيير بس · بترجّع القيم + `changed` |
| `zell_shipping_options_checkout()` | `zell_order_definer` · `service_role` بس | للمتجر: `{express_enabled, governorates}` |
| `zell_shipping_options_trg_append_only()` | `postgres` (invoker) | دالة الـ triggers: `zell_shipping_options_log_immutable` · `zell_shipping_options_log_no_truncate` · `zell_shipping_options_no_delete` · `zell_shipping_options_no_truncate` (45413) |
| `zell_create_order(…)` (15) | `postgres` · `service_role` و`zell_order_writer` (زي ما كانت بالظبط) | معامل جديد `p_shipping_method` (`NULL` أو `standard` = عادي بالحرف · `express` = سعر السريع الكامل من غير حد مجاني، لو متاح للمحافظة، وإلا 45431 · غير كده 45432). لقطة `shipping_method` و`shipping_days_min/max` على كل طلب جديد. الرد والـ replay والمنطقة والفني والكوبون والمقدم زي ما هم. البصمة `62924d0fe9b1563e76c54bbddfb628b4`، والقديمة (14) بتتشال |

- الأسماء برّه عدّادات `zell_order_*` (24) و`zell_payment_*` (24) و`zell_checkout_*` (4).
- **فحوص التحقق اللي بتعتمد على `zell_create_order`:** `0021d_preferred_delivery_verify.sql` V02 و`0021a_p1_payments_verify.sql` V06 بحالتين بس (قبل EXPRESS: 14 و`811d…` · بعده: 15 والبصمة الجديدة)، وأي خليط أو overload أو بصمة تانية = FAIL. في استعلام الأثر الخانة 4 بس بتتغيّر.
- **الرجوع:** بعد revert كود W2، وبيرفض بأي سطر في السجل أو أي طلب `shipping_method` مش `NULL` (forward-fix بس). بيرجّع `zell_create_order` (14) بالحرف (بصمات R1 التلاتة) بنفس المالك والصلاحيات. وبيرفض كمان طول ما TRACK-ORDER v2 متطبّق (§١١).

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0021ex_express_shipping.sql` | W1 كله (الجسم بين `-- >>> 0021EX BODY` و`-- <<<`)، ومحتاج سطر `zell.approved_by` بعد `begin;` (`owner-approval-YYYY-MM-DD-express-shipping`) |
| `migrations/0021ex_express_shipping_ptest.sql` | smoke قبل التطبيق (8 حالات؛ على Production 7 + skip T07): الجسم منسوخ بالحرف (CI بيقارن md5)، وقديم = جديد على نداءات الرفض، والنتيجة صفوف |
| `migrations/0021ex_express_shipping_verify.sql` · `_rollback.sql` | التحقق (10 فحوص، في أي وقت بعد التطبيق) · الرجوع (محتاج سطر موافقة) |
| `ci/0021ex_sql_ci.sh` · `ci/0021ex_flows.sql` | CI على Postgres 17 مؤقت فوق شكل Production (A1 · D · P1 · P2 · D2 · TR): S0–S6 — مقارنة قديم/جديد 520 حالة × 4 نداءات · فحوص التحقق بالحالتين · الرجوع ببصمات R1 · حراس الـ preflight · سيناريوهات الإعداد والطلب (F01–F42، 38 حالة) |

## ١١) التتبّع الكامل: الشحنة ورسايل العميل (TRACK-ORDER v2 W1)

> **مش متطبّق على Production** (المرجع `08-HANDOFF-NOW.md`). العقد: `docs/contracts/TRACK-ORDER-v2.md` (§٢ · §٥ · §٦ · §١٦). الأكواد الجديدة 45433 (تحقق الشحنة) و45434 (تحقق الرسايل)، والحقل في `detail`.

| الدالة | المالك · EXECUTE | بتعمل إيه |
| --- | --- | --- |
| `zell_shipment_get(text)` | `zell_order_definer` · `authenticated` بس | للوحة (أي أدمن شغّال أو المالك): الحالة · `editable` · الشحنة بنسختها أو null. الطلب مش موجود = 45403 |
| `zell_shipment_save(text, timestamptz, text, text, text, date, date)` | `zell_order_definer` · `authenticated` بس | الحفظ: أول مرة بنسخة null، وبعدها `updated_at` الشحنة (45404) · confirmed / preparing / shipped / delivered بس (45410) · التحقق 45433 · سطر سجل لو فيه تغيير بس · مابيلمسش حالة الطلب ولا `updated_at` بتاعه |
| `zell_customer_update_list(text)` | `zell_order_definer` · `authenticated` بس | كل رسايل الطلب (الظاهرة والمخفية) بنسخها، الأحدث الأول، و `last_id` |
| `zell_customer_update_add(text, bigint, text)` | `zell_order_definer` · `authenticated` بس | إضافة في أي حالة بنسخة `last_id` (45404، فإعادة المحاولة مابتكرّرش) · أقصى 50 للطلب · سطر `add` |
| `zell_customer_update_edit(text, bigint, timestamptz, text)` | `zell_order_definer` · `authenticated` بس | تعديل النص (النسخة 45404 · `edited`) + سطر `edit` |
| `zell_customer_update_set_hidden(text, bigint, timestamptz, boolean)` | `zell_order_definer` · `authenticated` بس | إخفاء / إظهار + سطر `hide` / `show` |
| `zell_shipment_result(integer)` · `zell_customer_update_result(integer)` · `zell_customer_update_text(text)` | `zell_order_definer` · مفيش | داخلية: نتيجة اللوحة · تطبيع النص (NFC · CRLF ← LF · trim) والتحقق منه |
| `zell_shipment_trg_append_only()` · `zell_customer_update_trg_append_only()` | `postgres` (invoker) | 8 triggers (45413): السجلين مابيتعدّلوش ولا بيتمسحوا ولا بيتعملهم truncate، والشحنة والرسالة مابيتمسحوش · تفريغ جدول الرسايل لوحده بيترفضه الـ FK بتاع السجل قبلها (`0A000`) |
| `zell_checkout_track_order(text)` (v2) | `zell_order_definer` · `service_role` بس (زي T1) | `CREATE OR REPLACE`: حقول v1 بالحرف + `customer` · `history` · `money` · `shipping` · `confirmed_delivery` · `shipment` · `updates` (§٩ والعقد §٢). البصمة `14dad4721c48b73ee5e040bf7436bfc5` |

- مفيش صلاحية جديدة على `orders` ولا `order_events` ولا `order_payments` (قراءة T3)، ومفيش أي خانة في استعلام الأثر بتتغيّر.
- **فحوص التحقق:** `0021tr_track_order_verify.sql` بحالتين بس (قبل v2: 6 مفاتيح · بعده: 13 وقيم `customer` و`money`، ومفيش بيانات ممنوعة)، وأي خليط = FAIL.
- **الرجوع:** بعد revert كود W2، وبيرفض بأي صف في الجداول الأربعة (forward-fix بس). بيرجّع دالة التتبّع بجسم T1 بالحرف (بصمات T1 التلاتة) بنفس المالك والصلاحيات. رجوع TR ورجوع EXPRESS بيرفضوا طول ما v2 متطبّق.

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0021tr2_track_order_v2.sql` | W1 كله (الجسم بين `-- >>> 0021TR2 BODY` و`-- <<<`)، ومحتاج سطر `zell.approved_by` بعد `begin;` (`owner-approval-YYYY-MM-DD-0021tr2-track-order-v2`) |
| `migrations/0021tr2_track_order_v2_ptest.sql` | smoke قبل التطبيق (9 حالات؛ على Production 8 + skip T09): الجسم منسوخ بالحرف، ورد v1 لآخر طلب = مفاتيح v1 في رد v2، والصلاحيات والدوال التانية زي ما هي |
| `migrations/0021tr2_track_order_v2_verify.sql` · `_rollback.sql` | التحقق (10 فحوص، في أي وقت بعد التطبيق) · الرجوع (محتاج سطر موافقة) |
| `ci/0021tr2_sql_ci.sh` · `ci/0021tr2_flows.sql` · `ci/0021tr2_v1_guard.mjs` | CI على Postgres 17 مؤقت فوق شكل Production (A1 · D · P1 · P2 · D2 · TR · EXPRESS): S0–S7 — ptest · التطبيق والأثر · verify بالحالتين · السيناريوهات (F00–F49، 36 حالة) · بيانات حقيقية ورفض الرجوع · التزامن بجلستين · الرجوع ببصمات T1 · حراس الـ preflight · توافق حارس v1 مع رد v2 |

## ١٢) حذف المنتج للمالك (PRODUCT-DELETE — 0022)

> **متطبّق ومتحقق منه على Production 2026-10-26** (من main `9f5166b`، بموافقة `owner-approval-2026-10-26-0022-product-delete`، والتفاصيل في وصف #186)، واللوحة منشورة (#186، main `ff73605`). العقد: `docs/contracts/PRODUCT-DELETE.md` (المراجعة 3.2، المراحل في §٧-أ). الأكواد الجديدة 45501..45508. المرحلة C: 0022 في `ci/build_from_scratch.list`، ولقطة BASELINE لـ `order_items` محدّثة، ونداءات الدالتين اتشالوا من `pending` في `call_contract_policy.json`.

| الدالة | المالك · EXECUTE | بتعمل إيه |
| --- | --- | --- |
| `zell_product_delete(integer, timestamptz)` | `zell_catalog_definer` · `authenticated` بس (volatile · definer · `search_path` فاضي · `lock_timeout` 3s) | المالك بس (`zell_order_actor(true)`: 45400 / 45401 / 45402). المنتج لازم مخفي ومن غير طلبات ولا رصيد. الأقفال: قفل القايمة (advisory) ← صف المنتج (بيستنوا لحد 3 ثواني) ← الباقي `nowait`. بتسجّل الصور في `storage_orphans` بسبب `product_deleted` (المستني يفضل زي ما هو)، وبتشيل الـ id من `home_products`، والتوابع بالـ cascade. مابتمسحش ملفات من Storage |
| `zell_product_delete_preview(integer)` | `zell_catalog_definer` · `authenticated` بس (stable) | المالك بس: النسخة · مخفي؟ · طلبات · رصيد · تعارض صور · عدد الصور والمقاسات والإضافات والمجموعات · في الرئيسية؟ · `can_delete`. قراية بس، والحذف بيعيد الفحص |
| `zell_catalog_trg_home_products_guard()` | `zell_catalog_definer` · مفيش | trigger `zell_catalog_home_products_guard` على `settings` (BEFORE INSERT OR UPDATE OF value، صف `home_products` بس): بياخد قفل القايمة، وأي id **جديد** لازم يكون منتج موجود (45507). الـ ids اللي كانت موجودة قبل كده مابتتفحصش |
| `zell_inv_product_stock_ref_exists(integer)` | `zell_inventory_definer` · `zell_catalog_definer` بس | غلاف definer على `zell_inv_product_has_stock_refs` (اللي بقى معاها EXECUTE لـ `zell_inventory_definer`) |

| الكود | المعنى |
| --- | --- |
| 45501 | المنتج مش موجود (أو id فاضي) |
| 45502 | النسخة اتغيّرت (`updated_at` صف المنتج بدقة الميلي ثانية) |
| 45503 | المنتج ظاهر — لازم يتخفى الأول |
| 45504 | عليه طلبات (`order_items`) |
| 45505 | عليه رصيد أو مستند مخزون (أو FK تاني) |
| 45506 | صورة من صوره متعلّمة اتنضفت في `storage_orphans` |
| 45507 | قايمة الرئيسية فيها id جديد لمنتج مش موجود (الـ trigger) |
| 45508 | قفل مشغول (القايمة · المنتج · التوابع) — جرّب تاني |

- **تغيير في جدول موجود:** `storage_orphans_reason_check` بنفس الاسم + سبب `product_deleted`. مفيش أي تعديل في دالة موجودة.
- **ملف تحقق 0020 (`0020_inventory_purchasing_verify.sql`):** بقى صالح قبل 0022 وبعده (زي 0020-S و PR-3): بعد 0022 بيتوقع الغلاف بشكله بالظبط وACL الـ helper = `postgres` + `zell_inventory_definer`، والرسالة بتخلص بـ « 0022=applied». أي خليط أو منحة زيادة = FAIL، وأي دالة مالكها `zell_inventory_definer` باسم برّه `zell_inv_*` = `ZELL_0020_FUNCTION_FOREIGN`. الـ CI بيشغّله إلزامي قبل وبعد ومع محاولات زيادة.
- **الرجوع:** بعد revert كود اللوحة، وبيرفض لو فيه أي صف `product_deleted` (forward-fix بس). المنتجات المحذوفة مابترجعش غير بالـ backup.

| الملف | بيعمل إيه |
| --- | --- |
| `migrations/0022_product_delete.sql` | كله (الجسم بين `-- >>> 0022 BODY` و`-- <<<`)، ومحتاج سطر `zell.approved_by` بعد `begin;` (`owner-approval-YYYY-MM-DD-0022-product-delete`) |
| `migrations/0022_product_delete_ptest.sql` | smoke قبل التطبيق (6 حالات، من غير كتابة بيانات): الجسم منسوخ بالحرف (CI بيقارن md5)، والنتيجة صفوف |
| `migrations/0020_inventory_purchasing_verify_rows.sql` | تحقق 0020 بصيغة صفوف لـ Retool: البلوكات التلاتة من `0020_inventory_purchasing_verify.sql` بالحرف (CI S05) جوه بلوك بيمسك الـ exception، وصف ملخص (`verdict` · `sqlstate` · `message` كما هي · `markers`). PASS بس لرسالة النجاح بالشكل الكامل؛ أي رسالة فشل بتطلع زي ما هي (CI W01–W03) |
| `migrations/0022_product_delete_impact.sql` | استعلام الأثر (قراءة بس، UTC، صف واحد 34 عمود): قبل التطبيق على Production وبعده على طول بنفس النص. كائنات 0022 + أعداد وبصمات محتوى الصفوف للمنتجات وتوابعها والإعدادات وstorage_orphans + المعاملات الخاملة والأقفال المعطّلة في القاعدة الحالية. CI: IMP0–IMP5 |
| `migrations/0022_product_delete_verify.sql` · `_rollback.sql` | التحقق (10 فحوص، منها جدول صلاحيات الدور كله والـ policies بتعبيراتها بالحرف، في أي وقت بعد التطبيق) · الرجوع |
| `ci/0022_sql_ci.sh` · `ci/0022_flows.sql` | CI على Postgres 17 مؤقت والداتابيز مبنية من القايمة الصريحة + 0022: حراس الـ preflight · تحقق 0020 قبل وبعد · ptest · التطبيق · verify بالحرف ومحاولات التوسيع (N01–N05) · الرجوع لنفس حالة الـ catalog · السيناريوهات (F01–F25، بصمات محتوى) · التزامن بجلستين بالدوال الفعلية وبالـ DML (C01–C19 · P01–P08 · H01–H04) · مفيش 40P01 · رفض الرجوع بعد حذف |
